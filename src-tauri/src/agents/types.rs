use portable_pty::Child as PtyChild;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Deserialize, Clone)]
#[cfg_attr(test, derive(PartialEq))]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub name: String,
    pub model: String,
    pub task: String,
    pub cwd: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
    pub permission_mode: Option<String>,
    pub dangerously_ignore_permissions: Option<bool>,
    pub auto_accept_edits: Option<bool>,
    pub provider: Option<String>,
    pub headless: Option<bool>,
    #[serde(default)]
    pub spawned_by_ticket_id: Option<String>,
    #[serde(default)]
    pub spawned_by_goal_id: Option<String>,
    /// The MCP launch request this spawn answers. When set, the spawn is
    /// refused unless `cwd` is where that request may run
    /// (`agents/launch_dir.rs`).
    #[serde(default)]
    pub launch_request_uid: Option<String>,
    /// An agent-written notification whose Start button this spawn answers
    /// (`notify`, an agent's schedule). When set, the spawn is refused unless
    /// `cwd` is the folder the MCP server stamped on that action
    /// (`agents/launch_dir.rs`, `check_agent_notification_directory`).
    #[serde(default)]
    pub agent_notification_uid: Option<String>,
    /// The action on `agent_notification_uid` that was clicked.
    #[serde(default)]
    pub agent_notification_action_id: Option<String>,
    /// Who started this run (`ui`, `conductor`, `schedule`, `mcp`); usage
    /// attribution only.
    #[serde(default)]
    pub run_source: Option<String>,
    /// What the run is for (`ticket`, `goal`, `review`, `other`); derived from
    /// the ids below when absent.
    #[serde(default)]
    pub run_kind: Option<String>,
    /// The ticket a review run judges; its cost is booked on that ticket.
    #[serde(default)]
    pub review_of_ticket_id: Option<String>,
    /// `supervisor` starts the one agent the control socket admits
    /// (ADR 0004); absent is a worker.
    #[serde(default)]
    pub role: Option<AgentRole>,
    /// The supervisor that started this agent. Set by the control-socket
    /// dispatcher; `spawn_agent_impl` checks the supervisor policy again for
    /// any spawn that carries it.
    #[serde(default)]
    pub spawned_by_agent_id: Option<String>,
    /// A supervisor only: the folder of an earlier run to work in again
    /// instead of a new one. Rust checks it is one run folder under
    /// `~/.auric/supervisors/` (`supervisor::runs::resolve_run_dir`).
    #[serde(default)]
    pub resume_run_dir: Option<String>,
    /// A supervisor only: the address a client gave it
    /// (`supervisor::several`). Unique among live supervisors; `admit_spawn`
    /// checks it, and a resume without one takes the run folder's.
    #[serde(default)]
    pub supervisor_key: Option<String>,
    /// Set by Rust after admission, never by a caller: the run folder a
    /// supervisor resumed. Its earlier supervisors' children follow it.
    #[serde(skip)]
    pub resumed_run_dir: Option<String>,
    /// Set by `resumed_config` for a supervisor restored after a restart: the
    /// id it had before, which no store may remember any more.
    #[serde(skip)]
    pub replaces_agent_id: Option<String>,
    /// Set by `admit_supervisor` for a fresh Project Manager launch: booked in
    /// the registry once the process runs, not before.
    #[serde(skip)]
    pub launch_to_book: Option<crate::supervisor::launch::LaunchToBook>,
}

impl AgentConfig {
    pub fn role(&self) -> AgentRole {
        self.role.unwrap_or_default()
    }
}

/// What an agent may do on the control socket (`docs/design-agent-control.md`,
/// "Supervisor scope").
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentRole {
    #[default]
    Worker,
    Supervisor,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Running,
    Idle,
    Queued,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub model: String,
    pub provider: String,
    pub status: AgentStatus,
    pub current_task: Option<String>,
    pub started_at: u64,
    pub last_activity_at: Option<u64>,
    pub project_path: Option<String>,
    pub repo_path: Option<String>,
    pub spawned_by_ticket_id: Option<String>,
    pub spawned_by_goal_id: Option<String>,
    /// Runs unattended (`claude -p`, `codex exec`). Such a CLI may print nothing
    /// until it ends, so the frontend does not read its silence as a stall.
    pub headless: bool,
    pub role: AgentRole,
    /// The supervisor that started this agent, else `None`.
    pub spawned_by_agent_id: Option<String>,
    /// A supervisor's address (`AgentConfig::supervisor_key`), else `None`.
    pub supervisor_key: Option<String>,
    /// Names of the project's extra MCP servers (`.mcp.json`) this agent
    /// started with, besides the built-in ones. Names only, never definitions.
    /// Left out when empty, so the control-socket contract is unchanged for
    /// every agent that has none.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub extra_mcp_servers: Vec<String>,
}

/// Every agent's console output, broadcast to every window. Pinned by
/// `agentWindow.fixtures.json` (`rustEvents.agentOutput`).
pub const AGENT_OUTPUT_EVENT: &str = "agent-output";
/// An agent ended (exit, kill, quit). Pinned by `backendNames.fixtures.json`.
pub const AGENT_STATUS_EVENT: &str = "agent-status";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOutputEvent {
    pub agent_id: String,
    pub stream: String,
    pub line: String,
    pub timestamp: u64,
    pub repo_path: Option<String>,
    /// Raw UTF-8 bytes this agent has emitted up to and including this batch.
    /// A window that opens late uses it to join a snapshot and the live
    /// stream without showing a batch twice or dropping one.
    pub end_offset: u64,
}

/// Counts what one agent has emitted via `agent-output`. Every emit for the
/// agent has to go through the same counter, or the offsets get a gap.
#[derive(Debug, Default)]
pub struct OutputOffset(u64);

impl OutputOffset {
    /// Books `line` and returns the offset its batch ends at.
    pub fn advance(&mut self, line: &str) -> u64 {
        self.0 += line.len() as u64;
        self.0
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusEvent {
    pub agent_id: String,
    pub status: AgentStatus,
    pub exit_code: Option<i32>,
    pub repo_path: Option<String>,
}

pub struct AgentSession {
    pub info: AgentInfo,
    pub child: Box<dyn PtyChild + Send + Sync>,
    /// Registration of this process's shared PTY writer/master.
    pub pty: super::pty::AgentPty,
    /// The launch request this agent serves; a kill reports to it.
    pub launch_request_uid: Option<String>,
    /// Books the run's usage when it ends; `None` outside an initialised project.
    pub usage: Option<crate::agent_usage::capture::UsageCapture>,
    /// A launch file only this agent uses (a supervisor's MCP config); it is
    /// deleted when the process entry goes, however the agent ended. Never
    /// read: being owned is the whole job.
    #[allow(dead_code)]
    pub launch_file: Option<OwnedFile>,
}

/// A file that belongs to one agent and is removed when this value drops.
#[derive(Debug)]
pub struct OwnedFile(pub std::path::PathBuf);

impl Drop for OwnedFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

pub struct AgentManager {
    /// Only the `agents` module touches sessions; everyone else asks through
    /// the methods below.
    pub(in crate::agents) agents: HashMap<String, AgentSession>,
    /// Hands out `agent-<yyMMdd>-<seq>` ids (`agents/ids.rs`). In memory until
    /// the app data folder is known.
    pub ids: super::ids::IdAllocator,
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentManager {
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
            ids: super::ids::IdAllocator::in_memory(),
        }
    }

    /// A new, never-before-used id. An error means the counter could not be
    /// saved and no id was handed out.
    pub fn next_id(&mut self) -> Result<String, String> {
        self.ids.allocate()
    }

    /// The live agent `id`, if it runs.
    pub fn info(&self, id: &str) -> Option<&AgentInfo> {
        self.agents.get(id).map(|session| &session.info)
    }

    /// Every live agent's info, for bookkeeping that rewrites it in place
    /// (adoption, a supervisor key).
    pub fn infos_mut(&mut self) -> impl Iterator<Item = &mut AgentInfo> {
        self.agents.values_mut().map(|session| &mut session.info)
    }

    /// Each live agent's process id with its info; agents whose process id
    /// is unknown are left out.
    pub fn processes(&self) -> impl Iterator<Item = (u32, &AgentInfo)> {
        self.agents
            .values()
            .filter_map(|session| Some((session.child.process_id()?, &session.info)))
    }

    /// The usage capture of agent `id`, where its provider has one.
    pub fn usage(&self, id: &str) -> Option<&crate::agent_usage::capture::UsageCapture> {
        self.agents
            .get(id)
            .and_then(|session| session.usage.as_ref())
    }
}

pub type AgentManagerState = Arc<Mutex<AgentManager>>;

pub fn new_agent_manager_state() -> AgentManagerState {
    Arc::new(Mutex::new(AgentManager::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_window::tests::fixtures;
    use std::collections::BTreeSet;

    #[test]
    fn an_output_event_has_exactly_the_fixture_fields() {
        let fixtures = fixtures();
        let cases = fixtures["messages"]["agentOutput"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let raw = &case["raw"];
            let event = AgentOutputEvent {
                agent_id: raw["agentId"].as_str().unwrap().to_string(),
                stream: raw["stream"].as_str().unwrap().to_string(),
                line: raw["line"].as_str().unwrap().to_string(),
                timestamp: raw["timestamp"].as_u64().unwrap(),
                repo_path: raw["repoPath"].as_str().map(str::to_string),
                end_offset: raw["endOffset"].as_u64().unwrap(),
            };
            let sent = serde_json::to_value(&event).unwrap();
            let keys = |value: &serde_json::Value| -> BTreeSet<String> {
                value.as_object().unwrap().keys().cloned().collect()
            };
            assert_eq!(keys(&sent), keys(raw), "{}", case["name"]);
            assert_eq!(&sent, raw, "{}", case["name"]);
        }
    }

    #[test]
    fn offsets_run_on_across_batches_as_the_fixtures_count_them() {
        // The fixture cases are consecutive batches of one agent.
        let fixtures = fixtures();
        let cases = fixtures["messages"]["agentOutput"].as_array().unwrap();
        let mut offset = OutputOffset::default();
        for case in cases {
            let raw = &case["raw"];
            assert_eq!(
                offset.advance(raw["line"].as_str().unwrap()),
                raw["endOffset"].as_u64().unwrap(),
                "{}",
                case["name"]
            );
        }
    }

    #[test]
    fn offsets_count_bytes_without_a_gap_and_never_go_back() {
        let mut offset = OutputOffset::default();
        let mut expected = 0u64;
        for line in ["a", "", "\u{2713} ok", "\r\n", "\u{1f600}"] {
            expected += line.len() as u64;
            assert_eq!(offset.advance(line), expected);
        }
        assert_eq!(expected, 1 + 6 + 2 + 4);
    }
}
