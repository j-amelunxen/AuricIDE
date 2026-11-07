//! What one tracked run is and how a call changes it. Pure: the clock and the
//! store arrive as arguments, so every transition in the contract is tested
//! without a file.

use crate::capability_tokens::{self, Grant, SecretToken, TokenError};
use crate::supervisor::several::same_folder;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::Path;
use std::sync::OnceLock;

pub const STORE_VERSION: u32 = 1;
pub const STORE_FILE_NAME: &str = "external-agents.json";
pub const CHANGED_EVENT: &str = "external-agents-changed";

const HOUR_MS: u64 = 3_600_000;
pub const STALE_RUNNING_AFTER_MS: u64 = 26 * HOUR_MS;
pub const STALE_REGISTERED_AFTER_MS: u64 = 72 * HOUR_MS;
pub const FINAL_KEPT_MS: u64 = 7 * 24 * HOUR_MS;
pub const MAX_LIVE: usize = 200;
pub const MAX_ON_SPANS: usize = 64;
pub const CLOCK_SKEW_MS: u64 = 300_000;
pub const MAX_STARTED_AGE_MS: u64 = 30 * 24 * HOUR_MS;
pub const MAX_CORRECTIONS: usize = 16;

/// The capability-token scope of an external run (`capabilityTokens.fixtures.json`).
pub const TOKEN_KIND: &str = "external_run";
pub const TOKEN_ACTION_STOP: &str = "external_stop";
pub const TOKEN_DEFAULT_TTL_SECONDS: u64 = 259_200;
pub const CLOSED_BY_TOKEN: &str = "token";
pub const CLOSED_BY_HUMAN: &str = "human";

const KEY_PATTERN: &str = "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$";
const PROVIDER_PATTERN: &str = "^[a-z0-9][a-z0-9._-]{0,63}$";
const MODEL_PATTERN: &str = r"^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,127}$";
const NAME_MAX_CHARS: usize = 80;
const REFERENCE_MIN_CHARS: usize = 4;
const CREDENTIAL_SHAPES: [&str; 8] = [
    "sk-",
    "ghp_",
    "gho_",
    "github_pat_",
    "xox",
    "AKIA",
    "Bearer ",
    "-----BEGIN",
];
const ACTIVE_SECONDS_MAX: u64 = 31_622_400;
const AGENT_RUNS_MAX: u64 = 1_000_000;
const TOKENS_MAX: u64 = 9_007_199_254_740_991;
const COST_USD_MAX: f64 = 1_000_000.0;

/// What a caller may ask for. The final states only come from a stop, so
/// `stopped` in a register call is refused while the params are read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LiveState {
    Registered,
    Running,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExternalState {
    Registered,
    Running,
    Stopped,
    Failed,
}

impl From<LiveState> for ExternalState {
    fn from(state: LiveState) -> Self {
        match state {
            LiveState::Registered => Self::Registered,
            LiveState::Running => Self::Running,
        }
    }
}

/// `killed` is the human's close and not for callers, so it is not offered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StopOutcome {
    Success,
    Failed,
}

/// Why a run ended, from a short fixed list; there is no free-text reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EndReason {
    Completed,
    Error,
    Timeout,
    Cancelled,
    Reaped,
    Lost,
}

/// Unknown fields are refused so a prompt cannot reach the store by accident.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalRegisterParams {
    pub external_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    pub project_path: String,
    pub name: String,
    pub provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ticket_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal_id: Option<String>,
    pub state: LiveState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    /// How long the token issued with this call lives; default 72 h.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_ttl_seconds: Option<u64>,
    /// A further token for a run that is live already.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_token: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalStopParams {
    pub external_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<StopOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_seconds: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_runs: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partial: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_reason: Option<EndReason>,
    /// The run's capability token, for a caller outside the owner's tree.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<SecretToken>,
    /// The owner (or the human) may close a stale run or correct a final one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
}

fn matches(cell: &'static OnceLock<Regex>, pattern: &str, value: &str) -> bool {
    cell.get_or_init(|| Regex::new(pattern).expect("the patterns above are valid"))
        .is_match(value)
}

fn valid_key(value: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    matches(&RE, KEY_PATTERN, value)
}

fn check_key(external_id: &str, run_id: Option<&str>) -> Result<(), String> {
    if !valid_key(external_id) {
        return Err("externalId takes letters, digits and ._:/- only".into());
    }
    if run_id.is_some_and(|run_id| !valid_key(run_id)) {
        return Err("runId takes letters, digits and ._:/- only".into());
    }
    Ok(())
}

fn check_model(model: Option<&str>) -> Result<(), String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    if model.is_some_and(|model| !matches(&RE, MODEL_PATTERN, model)) {
        return Err("model takes letters, digits and ._:/[]- only".into());
    }
    Ok(())
}

/// No letter or digit right before the shape: "task-12" holds "sk-" and is no
/// key. This is a net for an accident, not a scanner.
fn holds_credential_shape(name: &str) -> bool {
    CREDENTIAL_SHAPES.iter().any(|shape| {
        name.match_indices(shape).any(|(at, _)| {
            !name[..at]
                .chars()
                .next_back()
                .is_some_and(|before| before.is_ascii_alphanumeric())
        })
    })
}

fn check_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("name must not be empty".into());
    }
    if name.chars().any(char::is_control) {
        return Err("name must be one line".into());
    }
    if name.chars().count() > NAME_MAX_CHARS {
        return Err(format!("name must be at most {NAME_MAX_CHARS} characters"));
    }
    if holds_credential_shape(name) {
        return Err("name must not hold a credential".into());
    }
    Ok(())
}

fn check_reference(field: &str, value: Option<&str>) -> Result<(), String> {
    match value {
        Some(value) if value.chars().count() < REFERENCE_MIN_CHARS => Err(format!(
            "{field} is at least {REFERENCE_MIN_CHARS} characters"
        )),
        _ => Ok(()),
    }
}

/// What the shape of the params can tell. The clock and the project come later.
pub fn validate_register(params: &ExternalRegisterParams) -> Result<(), String> {
    static PROVIDER: OnceLock<Regex> = OnceLock::new();
    check_key(&params.external_id, params.run_id.as_deref())?;
    if params.project_path.trim().is_empty() {
        return Err("projectPath must not be empty".into());
    }
    check_name(&params.name)?;
    if !matches(&PROVIDER, PROVIDER_PATTERN, &params.provider) {
        return Err("provider takes lower-case letters, digits and ._- only".into());
    }
    check_model(params.model.as_deref())?;
    check_reference("ticketId", params.ticket_id.as_deref())?;
    check_reference("goalId", params.goal_id.as_deref())?;
    let ttl = capability_tokens::TTL_MIN_SECONDS..=capability_tokens::TTL_MAX_SECONDS;
    if params
        .token_ttl_seconds
        .is_some_and(|seconds| !ttl.contains(&seconds))
    {
        return Err(format!(
            "tokenTtlSeconds must be between {} and {}",
            ttl.start(),
            ttl.end()
        ));
    }
    Ok(())
}

fn check_max(field: &str, value: Option<u64>, max: u64) -> Result<(), String> {
    if value.is_some_and(|value| value > max) {
        return Err(format!("{field} must be at most {max}"));
    }
    Ok(())
}

/// Reported figures are stored as reported; only the range is ours to check.
pub fn validate_stop(params: &ExternalStopParams) -> Result<(), String> {
    check_key(&params.external_id, params.run_id.as_deref())?;
    if let Some(token) = &params.token {
        if !capability_tokens::valid_shape(token.expose()) {
            return Err("token is not a capability token".into());
        }
        if params.force == Some(true) {
            return Err("a token cannot force; force is for the owning supervisor".into());
        }
    }
    check_model(params.model.as_deref())?;
    check_max("activeSeconds", params.active_seconds, ACTIVE_SECONDS_MAX)?;
    check_max("agentRuns", params.agent_runs, AGENT_RUNS_MAX)?;
    check_max("inputTokens", params.input_tokens, TOKENS_MAX)?;
    check_max("outputTokens", params.output_tokens, TOKENS_MAX)?;
    check_max("cacheReadTokens", params.cache_read_tokens, TOKENS_MAX)?;
    check_max("cacheWriteTokens", params.cache_write_tokens, TOKENS_MAX)?;
    match params.cost_usd {
        Some(cost) if !(0.0..=COST_USD_MAX).contains(&cost) => {
            Err(format!("costUsd must be between 0 and {COST_USD_MAX}"))
        }
        _ => Ok(()),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OnSpan {
    pub from: u64,
    pub to: Option<u64>,
}

/// Figures as reported. `None` is unknown and stays apart from a reported 0.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalReport {
    pub active_ms: Option<u64>,
    pub agent_runs: Option<u64>,
    pub partial: Option<bool>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
}

impl ExternalReport {
    /// `None` when the stop carried nothing to report.
    fn from_stop(params: &ExternalStopParams) -> Option<Self> {
        let report = Self {
            active_ms: params.active_seconds.map(|seconds| seconds * 1000),
            agent_runs: params.agent_runs,
            partial: params.partial,
            input_tokens: params.input_tokens,
            output_tokens: params.output_tokens,
            cache_read_tokens: params.cache_read_tokens,
            cache_write_tokens: params.cache_write_tokens,
            cost_usd: params.cost_usd,
        };
        (report != Self::default()).then_some(report)
    }

    /// `partial` qualifies the figures and is not one itself.
    pub fn has_figures(&self) -> bool {
        self.active_ms.is_some()
            || self.agent_runs.is_some()
            || self.input_tokens.is_some()
            || self.output_tokens.is_some()
            || self.cache_read_tokens.is_some()
            || self.cache_write_tokens.is_some()
            || self.cost_usd.is_some()
    }
}

/// One entry, the same fields in the file and, with `stale`, on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgent {
    pub id: String,
    pub external_id: String,
    pub run_id: Option<String>,
    pub project_path: String,
    pub name: String,
    pub provider: String,
    pub model: Option<String>,
    pub ticket_id: Option<String>,
    pub ticket_name: Option<String>,
    pub goal_id: Option<String>,
    pub state: ExternalState,
    pub registered_at: u64,
    pub last_seen_at: u64,
    pub finished_at: Option<u64>,
    pub on_spans: Vec<OnSpan>,
    pub owner_run_dir: String,
    pub owner_agent_id: Option<String>,
    pub closed_by: Option<String>,
    pub report: Option<ExternalReport>,
    pub booked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_reason: Option<EndReason>,
    /// The audit trail of forced closes and corrections, oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub corrections: Vec<Correction>,
}

/// Who forced a change: the owning supervisor or the human.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ForcedBy {
    Supervisor,
    Human,
}

/// The end data a forced call replaced.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndData {
    pub state: ExternalState,
    pub finished_at: Option<u64>,
    pub closed_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_reason: Option<EndReason>,
    pub report: Option<ExternalReport>,
    pub model: Option<String>,
}

/// One forced close or correction: when, by whom, and what was there before.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Correction {
    pub at: u64,
    pub forced_by: ForcedBy,
    pub agent_id: Option<String>,
    /// The entry was in the history already, so the booking is replaced.
    pub was_booked: bool,
    pub previous: EndData,
}

/// Stale is worked out when asked for, never stored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalAgentView {
    #[serde(flatten)]
    pub agent: ExternalAgent,
    pub stale: bool,
}

impl ExternalAgent {
    pub fn is_live(&self) -> bool {
        matches!(
            self.state,
            ExternalState::Registered | ExternalState::Running
        )
    }

    pub fn is_stale(&self, now: u64) -> bool {
        let limit = match self.state {
            ExternalState::Running => STALE_RUNNING_AFTER_MS,
            ExternalState::Registered => STALE_REGISTERED_AFTER_MS,
            ExternalState::Stopped | ExternalState::Failed => return false,
        };
        now.saturating_sub(self.last_seen_at) > limit
    }

    /// An open span runs up to now, or up to the end of a run already over.
    pub fn on_ms(&self, now: u64) -> u64 {
        let open_end = self.finished_at.unwrap_or(now);
        self.on_spans
            .iter()
            .map(|span| span.to.unwrap_or(open_end).saturating_sub(span.from))
            .sum()
    }

    pub fn view(&self, now: u64) -> ExternalAgentView {
        ExternalAgentView {
            agent: self.clone(),
            stale: self.is_stale(now),
        }
    }

    /// Final and booked, past the time the row stays on the timeline. An
    /// unbooked entry stays: it still holds figures the history does not have.
    pub fn is_expired(&self, now: u64) -> bool {
        !self.is_live()
            && self.booked
            && self
                .finished_at
                .is_some_and(|at| now.saturating_sub(at) > FINAL_KEPT_MS)
    }

    fn turn_on(&mut self, at: u64) {
        if self.on_spans.len() < MAX_ON_SPANS {
            self.on_spans.push(OnSpan { from: at, to: None });
        } else if let Some(last) = self.on_spans.last_mut() {
            last.to = None;
        }
    }

    fn turn_off(&mut self, at: u64) {
        if let Some(open) = self.on_spans.iter_mut().find(|span| span.to.is_none()) {
            open.to = Some(at.max(open.from));
        }
    }

    fn finish(&mut self, state: ExternalState, finished_at: u64, now: u64) {
        self.turn_off(finished_at);
        self.state = state;
        self.finished_at = Some(finished_at);
        self.last_seen_at = now;
        self.booked = false;
    }

    fn end_data(&self) -> EndData {
        EndData {
            state: self.state,
            finished_at: self.finished_at,
            closed_by: self.closed_by.clone(),
            end_reason: self.end_reason,
            report: self.report.clone(),
            model: self.model.clone(),
        }
    }

    /// Keeps the on-spans inside a moved end: a span that ended at the old end
    /// ends at the new one, and nothing runs past it.
    fn retime(&mut self, finished_at: u64) {
        let old_end = self.finished_at;
        self.on_spans.retain(|span| span.from <= finished_at);
        for span in &mut self.on_spans {
            let to = span.to.unwrap_or(finished_at);
            let to = if Some(to) == old_end {
                finished_at
            } else {
                to.min(finished_at)
            };
            span.to = Some(to.max(span.from));
        }
        self.finished_at = Some(finished_at);
    }

    /// The trail is bounded so a loop of corrections cannot grow the file.
    fn audit(
        &mut self,
        previous: EndData,
        was_booked: bool,
        forced_by: ForcedBy,
        agent_id: Option<String>,
        now: u64,
    ) -> Result<(), ExternalError> {
        if self.corrections.len() >= MAX_CORRECTIONS {
            return Err(ExternalError::InvalidParams(format!(
                "this run holds {MAX_CORRECTIONS} corrections already"
            )));
        }
        self.corrections.push(Correction {
            at: now,
            forced_by,
            agent_id,
            was_booked,
            previous,
        });
        Ok(())
    }

    fn matches_key(&self, external_id: &str, run_id: Option<&str>) -> bool {
        self.external_id == external_id && self.run_id.as_deref() == run_id
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExternalFile {
    pub version: u32,
    pub agents: Vec<ExternalAgent>,
}

impl Default for ExternalFile {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            agents: Vec::new(),
        }
    }
}

impl ExternalFile {
    fn find_key(&mut self, external_id: &str, run_id: Option<&str>) -> Option<&mut ExternalAgent> {
        self.agents
            .iter_mut()
            .find(|agent| agent.matches_key(external_id, run_id))
    }

    /// Drops what has served its time. `true` when anything went.
    pub fn prune(&mut self, now: u64) -> bool {
        let before = self.agents.len();
        self.agents.retain(|agent| !agent.is_expired(now));
        self.agents.len() != before
    }

    fn fresh_id(&self) -> String {
        loop {
            let id = format!("ext-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
            if !self.agents.iter().any(|agent| agent.id == id) {
                return id;
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ExternalError {
    /// The file is there but cannot be trusted. It is never overwritten.
    Unreadable(String),
    Storage(String),
    KeyInUse(String),
    LimitReached,
    UnknownKey(String),
    UnknownId(String),
    InvalidParams(String),
    Token(TokenError),
}

impl fmt::Display for ExternalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unreadable(reason) => {
                write!(f, "external-agents.json cannot be used: {reason}")
            }
            Self::Storage(reason) => write!(f, "could not write external-agents.json: {reason}"),
            Self::KeyInUse(key) => write!(f, "another supervisor holds the external run {key}"),
            Self::LimitReached => write!(f, "at most {MAX_LIVE} external runs can be live at once"),
            Self::UnknownKey(key) => write!(f, "you have no external run {key}"),
            Self::UnknownId(id) => write!(f, "no external run has the id {id}"),
            Self::InvalidParams(reason) => f.write_str(reason),
            Self::Token(error) => error.fmt(f),
        }
    }
}

/// The caller, as the socket's PID walk found it. The folder is what owns an
/// entry: the agent id changes on every resume, the folder does not.
#[derive(Debug, Clone)]
pub struct Owner {
    pub run_dir: String,
    pub agent_id: String,
}

impl Owner {
    pub fn holds(&self, agent: &ExternalAgent) -> bool {
        same_folder(Path::new(&agent.owner_run_dir), Path::new(&self.run_dir))
    }

    fn refresh(&self, agent: &mut ExternalAgent) {
        agent.owner_run_dir = self.run_dir.clone();
        agent.owner_agent_id = Some(self.agent_id.clone());
    }
}

pub fn display_key(external_id: &str, run_id: Option<&str>) -> String {
    match run_id {
        Some(run_id) => format!("{external_id} / {run_id}"),
        None => external_id.to_string(),
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Links {
    pub ticket: Option<(String, String)>,
    pub goal_id: Option<String>,
}

pub struct RegisterInput<'a> {
    pub params: &'a ExternalRegisterParams,
    /// The project as the policy check resolved it.
    pub project_path: &'a str,
    pub links: Links,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RegisterAnswer {
    pub agent: ExternalAgent,
    pub created: bool,
    pub changed: bool,
}

/// What a register call does, whichever call came before it. The store writes
/// the file afterwards, unless the key was already final.
pub fn apply_register(
    file: &mut ExternalFile,
    input: RegisterInput<'_>,
    owner: &Owner,
    now: u64,
) -> Result<RegisterAnswer, ExternalError> {
    let params = input.params;
    let run_id = params.run_id.as_deref();
    let key = display_key(&params.external_id, run_id);
    if let Some(agent) = file.find_key(&params.external_id, run_id) {
        if !owner.holds(agent) {
            return Err(ExternalError::KeyInUse(key));
        }
        if !agent.is_live() {
            return Ok(RegisterAnswer {
                agent: agent.clone(),
                created: false,
                changed: false,
            });
        }
        if !same_folder(
            Path::new(&agent.project_path),
            Path::new(input.project_path),
        ) {
            return Err(ExternalError::InvalidParams(format!(
                "{key} is registered in {}; a run does not change project",
                agent.project_path
            )));
        }
        let changed = refresh_live(agent, &input, owner, now);
        return Ok(RegisterAnswer {
            agent: agent.clone(),
            created: false,
            changed,
        });
    }
    if file.agents.iter().filter(|agent| agent.is_live()).count() >= MAX_LIVE {
        return Err(ExternalError::LimitReached);
    }
    let agent = new_entry(file.fresh_id(), input, owner, now)?;
    file.agents.push(agent.clone());
    Ok(RegisterAnswer {
        agent,
        created: true,
        changed: true,
    })
}

fn new_entry(
    id: String,
    input: RegisterInput<'_>,
    owner: &Owner,
    now: u64,
) -> Result<ExternalAgent, ExternalError> {
    let params = input.params;
    let registered_at = params.started_at.unwrap_or(now);
    if registered_at > now + CLOCK_SKEW_MS || registered_at < now.saturating_sub(MAX_STARTED_AGE_MS)
    {
        return Err(ExternalError::InvalidParams(
            "startedAt is too far from now".into(),
        ));
    }
    let (ticket_id, ticket_name) = input.links.ticket.unzip();
    let mut agent = ExternalAgent {
        id,
        external_id: params.external_id.clone(),
        run_id: params.run_id.clone(),
        project_path: input.project_path.to_string(),
        name: params.name.clone(),
        provider: params.provider.clone(),
        model: params.model.clone(),
        ticket_id,
        ticket_name,
        goal_id: input.links.goal_id,
        state: params.state.into(),
        registered_at,
        last_seen_at: now,
        finished_at: None,
        on_spans: Vec::new(),
        owner_run_dir: owner.run_dir.clone(),
        owner_agent_id: Some(owner.agent_id.clone()),
        closed_by: None,
        report: None,
        booked: false,
        end_reason: None,
        corrections: Vec::new(),
    };
    if agent.state == ExternalState::Running {
        agent.turn_on(registered_at);
    }
    Ok(agent)
}

/// Replaces `target` when `value` was given and differs. `true` if it did.
fn take_given<T: PartialEq>(target: &mut T, value: Option<T>) -> bool {
    match value {
        Some(value) if *target != value => {
            *target = value;
            true
        }
        _ => false,
    }
}

/// A repeat from the owner is a sign of life and may move the state. `changed`
/// says whether anything but that sign of life moved.
fn refresh_live(
    agent: &mut ExternalAgent,
    input: &RegisterInput<'_>,
    owner: &Owner,
    now: u64,
) -> bool {
    let params = input.params;
    let mut changed = false;
    let wanted: ExternalState = params.state.into();
    if agent.state != wanted {
        match params.state {
            LiveState::Running => agent.turn_on(now),
            LiveState::Registered => agent.turn_off(now),
        }
        agent.state = wanted;
        changed = true;
    }
    changed |= take_given(&mut agent.name, Some(params.name.clone()));
    changed |= take_given(&mut agent.provider, Some(params.provider.clone()));
    changed |= take_given(&mut agent.model, params.model.clone().map(Some));
    if let Some((id, name)) = input.links.ticket.clone() {
        changed |= take_given(&mut agent.ticket_id, Some(Some(id)));
        changed |= take_given(&mut agent.ticket_name, Some(Some(name)));
    }
    changed |= take_given(&mut agent.goal_id, input.links.goal_id.clone().map(Some));
    agent.last_seen_at = now;
    owner.refresh(agent);
    changed
}

/// Who stops a run: the owner the PID walk found, or the holder of a token
/// the owner was given for it.
pub enum StopBy<'a> {
    Owner(&'a Owner),
    Token(&'a Grant),
}

#[derive(Debug, Clone, PartialEq)]
pub struct StopAnswer {
    pub agent: ExternalAgent,
    pub already_stopped: bool,
    /// A forced call changed an entry that was final already.
    pub corrected: bool,
}

fn check_finished(agent: &ExternalAgent, finished_at: u64, now: u64) -> Result<(), ExternalError> {
    if finished_at < agent.registered_at || finished_at > now + CLOCK_SKEW_MS {
        return Err(ExternalError::InvalidParams(
            "finishedAt lies before the registration or too far ahead of now".into(),
        ));
    }
    Ok(())
}

fn stop_state(outcome: StopOutcome) -> ExternalState {
    match outcome {
        StopOutcome::Success => ExternalState::Stopped,
        StopOutcome::Failed => ExternalState::Failed,
    }
}

/// Given figures win field by field; what was not given stays.
fn merge_report(
    base: Option<ExternalReport>,
    given: Option<ExternalReport>,
) -> Option<ExternalReport> {
    let Some(given) = given else { return base };
    let base = base.unwrap_or_default();
    Some(ExternalReport {
        active_ms: given.active_ms.or(base.active_ms),
        agent_runs: given.agent_runs.or(base.agent_runs),
        partial: given.partial.or(base.partial),
        input_tokens: given.input_tokens.or(base.input_tokens),
        output_tokens: given.output_tokens.or(base.output_tokens),
        cache_read_tokens: given.cache_read_tokens.or(base.cache_read_tokens),
        cache_write_tokens: given.cache_write_tokens.or(base.cache_write_tokens),
        cost_usd: given.cost_usd.or(base.cost_usd),
    })
}

/// What a forced call on a final entry replaces. Absent fields stay.
#[derive(Debug, Clone, Default)]
pub struct Amend {
    pub finished_at: Option<u64>,
    pub state: Option<ExternalState>,
    pub report: Option<ExternalReport>,
    pub model: Option<String>,
    pub end_reason: Option<EndReason>,
}

/// Corrects a final entry and books it again. `false`, with no audit record,
/// when the values given are the values there.
fn correct(
    agent: &mut ExternalAgent,
    amend: Amend,
    forced_by: ForcedBy,
    by_agent: Option<String>,
    now: u64,
) -> Result<bool, ExternalError> {
    let previous = agent.end_data();
    let mut next = agent.clone();
    if let Some(at) = amend.finished_at {
        check_finished(&next, at, now)?;
        next.retime(at);
    }
    if let Some(state) = amend.state {
        next.state = state;
    }
    next.report = merge_report(next.report.take(), amend.report);
    if amend.model.is_some() {
        next.model = amend.model;
    }
    if amend.end_reason.is_some() {
        next.end_reason = amend.end_reason;
    }
    if next.end_data() == previous && next.on_spans == agent.on_spans {
        return Ok(false);
    }
    next.audit(previous, agent.booked, forced_by, by_agent, now)?;
    next.booked = false;
    next.last_seen_at = next.last_seen_at.max(now);
    *agent = next;
    Ok(true)
}

/// The first stop wins, whatever figures a later one carries, unless the
/// owner forces: then the given values replace the end data, audited.
pub fn apply_stop(
    file: &mut ExternalFile,
    params: &ExternalStopParams,
    by: &StopBy<'_>,
    now: u64,
) -> Result<StopAnswer, ExternalError> {
    let run_id = params.run_id.as_deref();
    let key = display_key(&params.external_id, run_id);
    let found = file.find_key(&params.external_id, run_id);
    let agent = match by {
        StopBy::Owner(owner) => found
            .filter(|agent| owner.holds(agent))
            .ok_or(ExternalError::UnknownKey(key))?,
        // A valid token for a key it was not issued on is out of scope,
        // whether or not that key exists.
        StopBy::Token(grant) => {
            let agent = found.ok_or(ExternalError::Token(TokenError::Scope))?;
            grant
                .check(TOKEN_KIND, &agent.id, TOKEN_ACTION_STOP, now)
                .map_err(ExternalError::Token)?;
            if !same_folder(
                Path::new(&grant.owner_run_dir),
                Path::new(&agent.owner_run_dir),
            ) {
                return Err(ExternalError::Token(TokenError::Scope));
            }
            agent
        }
    };
    let forcing_owner = match (params.force == Some(true), by) {
        (false, _) => None,
        (true, StopBy::Owner(owner)) => Some(*owner),
        (true, StopBy::Token(_)) => {
            return Err(ExternalError::InvalidParams(
                "a token cannot force; force is for the owning supervisor".into(),
            ))
        }
    };
    if !agent.is_live() {
        let corrected = match forcing_owner {
            None => false,
            Some(owner) => {
                let amend = Amend {
                    finished_at: params.finished_at,
                    state: params.outcome.map(stop_state),
                    report: ExternalReport::from_stop(params),
                    model: params.model.clone(),
                    end_reason: params.end_reason,
                };
                correct(
                    agent,
                    amend,
                    ForcedBy::Supervisor,
                    Some(owner.agent_id.clone()),
                    now,
                )?
            }
        };
        return Ok(StopAnswer {
            agent: agent.clone(),
            already_stopped: true,
            corrected,
        });
    }
    // Without a stated end, a start reported slightly ahead of this clock must
    // not leave the run ending before it began.
    let finished_at = params.finished_at.unwrap_or(now.max(agent.registered_at));
    check_finished(agent, finished_at, now)?;
    if let Some(owner) = forcing_owner {
        let previous = agent.end_data();
        let booked = agent.booked;
        agent.audit(
            previous,
            booked,
            ForcedBy::Supervisor,
            Some(owner.agent_id.clone()),
            now,
        )?;
    }
    agent.finish(
        stop_state(params.outcome.unwrap_or(StopOutcome::Success)),
        finished_at,
        now,
    );
    agent.report = ExternalReport::from_stop(params);
    if params.model.is_some() {
        agent.model = params.model.clone();
    }
    agent.end_reason = params.end_reason;
    match by {
        StopBy::Owner(owner) => owner.refresh(agent),
        StopBy::Token(_) => agent.closed_by = Some(CLOSED_BY_TOKEN.to_string()),
    }
    Ok(StopAnswer {
        agent: agent.clone(),
        already_stopped: false,
        corrected: false,
    })
}

/// What the human's close may carry besides the id.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct CloseOptions {
    pub force: bool,
    pub finished_at: Option<u64>,
    pub end_reason: Option<EndReason>,
}

/// The human's way out for a stop that never comes. Booked with no runtime; the
/// owner stays as it was, because a person is not one. The end defaults to now;
/// a stale run is better closed at its last sign of life (audited, no force
/// needed). With `force` a final entry's end time and reason are corrected,
/// audited; without it a final entry stays as it is.
pub fn apply_close(
    file: &mut ExternalFile,
    id: &str,
    options: CloseOptions,
    now: u64,
) -> Result<(ExternalAgent, bool), ExternalError> {
    let agent = file
        .agents
        .iter_mut()
        .find(|agent| agent.id == id)
        .ok_or_else(|| ExternalError::UnknownId(id.to_string()))?;
    if !agent.is_live() {
        if !options.force {
            return Ok((agent.clone(), false));
        }
        let amend = Amend {
            finished_at: options.finished_at,
            end_reason: options.end_reason,
            ..Amend::default()
        };
        let changed = correct(agent, amend, ForcedBy::Human, None, now)?;
        return Ok((agent.clone(), changed));
    }
    let finished_at = options.finished_at.unwrap_or(now.max(agent.registered_at));
    check_finished(agent, finished_at, now)?;
    // An end set by hand is not one the IDE observed, so it is audited even
    // without force; the UI closes a stale run that way, so a stop that lands
    // while its dialog is open is never overwritten.
    if options.force || options.finished_at.is_some() {
        let previous = agent.end_data();
        let booked = agent.booked;
        agent.audit(previous, booked, ForcedBy::Human, None, now)?;
    }
    agent.finish(ExternalState::Stopped, finished_at, now);
    agent.closed_by = Some(CLOSED_BY_HUMAN.to_string());
    agent.end_reason = options.end_reason;
    Ok((agent.clone(), true))
}

#[cfg(test)]
#[path = "model_tests.rs"]
mod tests;
