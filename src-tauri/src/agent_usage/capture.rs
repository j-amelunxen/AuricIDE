//! One agent's usage capture, from spawn to the row: what is known at launch,
//! what is read after the run ended, and the write.
//!
//! Everything here is plain functions over paths and a database so it can be
//! tested against a temp home directory and a temp project; the Tauri wiring
//! (`recorded_event`, the exit and kill hooks) stays in `agents/manager.rs`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Local, Utc};
use serde::Serialize;
use uuid::Uuid;

use super::claude::{find_session_files, session_tokens, CliResult};
use super::codex::{
    find_rollout_by_session, find_rollout_heuristic, parse_rollout, RolloutClaims, SessionIdSniffer,
};
use super::record::{
    build_record, Evidence, MatchKind, Outcome, PriceLists, RunEnd, RunFacts, RunKind, RunSource,
    UsageRecord,
};
use super::store;
use crate::cc_usage::manifest::UsagePlugin;
use crate::providers::{SessionIdFrom, TranscriptFormat, UsageConfig};

const CLAUDE_PROJECTS_DIR: &str = ".claude/projects";
const CODEX_SESSIONS_DIR: &str = ".codex/sessions";

/// The Codex price list, compiled in. `None` only if the shipped file and the
/// manifest types disagree, which `the_codex_price_list_parses` catches first.
pub fn codex_price_list() -> Option<&'static UsagePlugin> {
    static LIST: OnceLock<Option<UsagePlugin>> = OnceLock::new();
    LIST.get_or_init(|| match serde_json::from_str(super::CODEX_PRICING) {
        Ok(plugin) => Some(plugin),
        Err(error) => {
            eprintln!("Agent usage: the Codex price list is unreadable: {error}");
            None
        }
    })
    .as_ref()
}

/// Sent to the frontend after a row was written, so the open project's slice
/// can append it without a reload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRecordedEvent {
    pub project_path: String,
    pub row: UsageRecord,
}

/// How long to wait, once a run has ended, for its evidence to be on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvidenceWait {
    /// Read once and take what is there.
    Now,
    /// Read again until it is complete or the budget is spent.
    Poll(Duration),
    /// Read nothing: book the run with its duration and outcome only.
    Skip,
}

/// The CLI flushes its transcript around when it exits, not before.
pub const EXIT_EVIDENCE_WAIT: Duration = Duration::from_secs(3);
const POLL_INTERVAL: Duration = Duration::from_millis(200);

pub const USAGE_RECORDED_EVENT: &str = "agent-usage-recorded";

struct Inner {
    facts: RunFacts,
    project_path: PathBuf,
    /// The project path as the agent was started with; the frontend keys by it.
    event_project_path: String,
    /// Codex rollout matched by guessing, kept so a second read finds the same one.
    matched_rollout: Mutex<Option<PathBuf>>,
    cwd: Option<String>,
    usage: Option<UsageConfig>,
    sniffer: Mutex<SessionIdSniffer>,
    /// A run is booked once, whether its exit or its kill got there first.
    booked: AtomicBool,
}

/// Cheap to clone: the output pump, the exit hook and the kill path all hold one.
#[derive(Clone)]
pub struct UsageCapture {
    inner: Arc<Inner>,
}

impl UsageCapture {
    pub fn new(
        facts: RunFacts,
        project_path: PathBuf,
        cwd: Option<String>,
        usage: Option<UsageConfig>,
    ) -> Self {
        let event_project_path = project_path.to_string_lossy().into_owned();
        Self::with_event_path(facts, project_path, event_project_path, cwd, usage)
    }

    fn with_event_path(
        facts: RunFacts,
        project_path: PathBuf,
        event_project_path: String,
        cwd: Option<String>,
        usage: Option<UsageConfig>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                facts,
                project_path,
                event_project_path,
                matched_rollout: Mutex::new(None),
                cwd,
                usage,
                sniffer: Mutex::new(SessionIdSniffer::default()),
                booked: AtomicBool::new(false),
            }),
        }
    }

    /// The capture for one spawn: `Ok(None)` when the project has no database
    /// to book into, `Err` when it has one that cannot be read. Blocking
    /// (opens the database), so callers keep it off the async runtime. The
    /// agent id does not exist yet at that point: see [`Self::with_agent_id`].
    /// Reads the ticket's status now, because by the end of the run it will
    /// have moved.
    pub fn for_spawn(
        config: &crate::agents::AgentConfig,
        project_root: &Path,
        provider_id: &str,
        usage: Option<UsageConfig>,
        session_id: Option<String>,
        started_at_ms: u64,
    ) -> Result<Option<Self>, String> {
        let Some(conn) = store::open_existing(project_root)? else {
            return Ok(None);
        };
        let Some(started_at) = DateTime::from_timestamp_millis(started_at_ms as i64) else {
            return Ok(None);
        };
        let ticket_id = config
            .spawned_by_ticket_id
            .clone()
            .or_else(|| config.review_of_ticket_id.clone());
        let facts = RunFacts {
            agent_id: String::new(),
            provider: provider_id.to_string(),
            requested_model: config.model.clone(),
            headless: config.headless.unwrap_or(false),
            ticket_status_at_start: ticket_id
                .as_deref()
                .and_then(|id| store::ticket_status(&conn, id)),
            run_kind: RunKind::resolve(
                config.run_kind.as_deref(),
                config.review_of_ticket_id.as_deref(),
                ticket_id.as_deref(),
                config.spawned_by_goal_id.as_deref(),
            ),
            run_source: RunSource::resolve(config.run_source.as_deref()),
            ticket_id,
            goal_id: config.spawned_by_goal_id.clone(),
            session_id,
            started_at,
        };
        let event_path = config
            .project_path
            .clone()
            .unwrap_or_else(|| project_root.to_string_lossy().into_owned());
        Ok(Some(Self::with_event_path(
            facts,
            project_root.to_path_buf(),
            event_path,
            config.cwd.clone(),
            usage,
        )))
    }

    /// Sets the agent id, once it has been allocated. Only before the capture
    /// is shared.
    pub fn with_agent_id(mut self, agent_id: &str) -> Self {
        if let Some(inner) = Arc::get_mut(&mut self.inner) {
            inner.facts.agent_id = agent_id.to_string();
        }
        self
    }

    pub fn event_project_path(&self) -> &str {
        &self.inner.event_project_path
    }

    pub fn project_path(&self) -> &Path {
        &self.inner.project_path
    }

    /// Whether the provider prints its session id and we have to read it.
    pub fn sniffs_output(&self) -> bool {
        self.transcript_config()
            .is_some_and(|t| t.session_id_from == Some(SessionIdFrom::Output))
    }

    pub fn sniff(&self, chunk: &str) {
        if let Ok(mut sniffer) = self.inner.sniffer.lock() {
            sniffer.push(chunk);
        }
    }

    /// Whether the provider's headless output ends in a result object that has
    /// to be held back from the console.
    pub fn holds_back_result(&self) -> bool {
        self.inner.facts.headless
            && self
                .inner
                .usage
                .as_ref()
                .is_some_and(|usage| usage.result.is_some())
    }

    fn transcript_config(&self) -> Option<&crate::providers::TranscriptUsageConfig> {
        self.inner.usage.as_ref()?.transcript.as_ref()
    }

    fn is_booked(&self) -> bool {
        self.inner.booked.load(Ordering::SeqCst)
    }

    /// Claims the right to book this run; false when it was booked already.
    fn claim(&self) -> bool {
        !self.inner.booked.swap(true, Ordering::SeqCst)
    }

    fn sniffed_session_id(&self) -> Option<String> {
        self.inner
            .sniffer
            .lock()
            .ok()
            .and_then(|sniffer| sniffer.session_id().map(str::to_string))
    }

    /// Reads whatever the run left behind. `home` holds `~/.claude` and `~/.codex`.
    pub fn gather_evidence(&self, home: &Path, cli_result: Option<CliResult>) -> Evidence {
        let mut evidence = Evidence {
            sniffed_session_id: self.sniffed_session_id(),
            ..Default::default()
        };
        let facts = &self.inner.facts;
        match self.transcript_config().map(|t| t.format) {
            Some(TranscriptFormat::ClaudeJsonl) => {
                let session_id = facts
                    .session_id
                    .clone()
                    .or_else(|| cli_result.as_ref().and_then(|r| r.session_id.clone()));
                let files = session_id
                    .map(|id| find_session_files(&home.join(CLAUDE_PROJECTS_DIR), &id))
                    .unwrap_or_default();
                if !files.is_empty() {
                    evidence.claude_transcript =
                        Some(session_tokens(&files, facts.started_at.timestamp()));
                }
            }
            Some(TranscriptFormat::CodexRollout) => {
                let root = home.join(CODEX_SESSIONS_DIR);
                let start_day = facts.started_at.with_timezone(&Local).date_naive();
                let by_id = facts
                    .session_id
                    .clone()
                    .or_else(|| evidence.sniffed_session_id.clone())
                    .map(|id| find_rollout_by_session(&root, &id, start_day));
                let cached = self
                    .inner
                    .matched_rollout
                    .lock()
                    .ok()
                    .and_then(|m| m.clone());
                let (path, kind) = match (cached, by_id, self.inner.cwd.as_deref()) {
                    (Some(path), _, _) => (Some(path), MatchKind::Heuristic),
                    (None, Some(found), _) => {
                        if let Some(path) = &found {
                            RolloutClaims::global().claim(path);
                        }
                        (found, MatchKind::Exact)
                    }
                    (None, None, Some(cwd)) => {
                        let found = find_rollout_heuristic(
                            &root,
                            cwd,
                            facts.started_at,
                            start_day,
                            RolloutClaims::global(),
                        );
                        if let Ok(mut matched) = self.inner.matched_rollout.lock() {
                            *matched = found.clone();
                        }
                        (found, MatchKind::Heuristic)
                    }
                    (None, None, None) => (None, MatchKind::Heuristic),
                };
                if let Some(usage) = path
                    .and_then(|path| std::fs::read_to_string(path).ok())
                    .and_then(|text| parse_rollout(&text))
                {
                    evidence.rollout = Some(usage);
                    evidence.rollout_match = Some(kind);
                }
            }
            None => {}
        }
        evidence.cli_result = cli_result;
        evidence
    }

    /// Whether what was read is all there is to read.
    fn evidence_is_complete(&self, evidence: &Evidence) -> bool {
        match self.transcript_config().map(|t| t.format) {
            None => true,
            Some(TranscriptFormat::ClaudeJsonl) => {
                match (&evidence.claude_transcript, &evidence.cli_result) {
                    (None, _) => false,
                    (Some(_), None) => true,
                    // The CLI's own total says how much output the file must hold.
                    (Some(by_model), Some(result)) => {
                        let written: u64 = by_model.values().map(|c| c.output).sum();
                        written >= result.total_counts().output
                    }
                }
            }
            Some(TranscriptFormat::CodexRollout) => evidence.rollout.is_some(),
        }
    }

    fn read_evidence(
        &self,
        home: &Path,
        cli_result: Option<CliResult>,
        wait: EvidenceWait,
    ) -> Evidence {
        let budget = match wait {
            EvidenceWait::Skip => {
                return Evidence {
                    cli_result,
                    ..Default::default()
                }
            }
            EvidenceWait::Now => Duration::ZERO,
            EvidenceWait::Poll(budget) => budget,
        };
        let deadline = Instant::now() + budget;
        loop {
            let evidence = self.gather_evidence(home, cli_result.clone());
            if self.evidence_is_complete(&evidence) || Instant::now() >= deadline {
                return evidence;
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    }

    /// Reads the evidence, builds the row and appends it to the project's
    /// database. `Ok(None)` when the run was already booked, or the project has
    /// no database. Whoever gets to the insert first books the run: a slow read
    /// that loses to a quicker one is dropped.
    pub fn book(
        &self,
        home: &Path,
        claude_prices: Option<&UsagePlugin>,
        outcome: Outcome,
        cli_result: Option<CliResult>,
        finished_at: DateTime<Utc>,
        wait: EvidenceWait,
    ) -> Result<Option<UsageRecord>, String> {
        if self.is_booked() {
            return Ok(None);
        }
        let Some(conn) = store::open_existing(&self.inner.project_path)? else {
            return Ok(None);
        };
        let evidence = self.read_evidence(home, cli_result, wait);
        let row = build_record(
            Uuid::new_v4().to_string(),
            &self.inner.facts,
            &RunEnd {
                finished_at,
                outcome,
            },
            &evidence,
            &PriceLists {
                claude: claude_prices,
                codex: codex_price_list(),
            },
        );
        if !self.claim() {
            return Ok(None);
        }
        store::insert(&conn, &row)?;
        Ok(Some(row))
    }
}

#[cfg(test)]
#[path = "capture_tests.rs"]
mod tests;
