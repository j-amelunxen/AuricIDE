//! What one tracked run is and how a call changes it. Pure: the clock and the
//! store arrive as arguments, so every transition in the contract is tested
//! without a file.

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
    check_reference("goalId", params.goal_id.as_deref())
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

#[derive(Debug, Clone, PartialEq)]
pub struct StopAnswer {
    pub agent: ExternalAgent,
    pub already_stopped: bool,
}

/// The first stop wins, whatever figures a later one carries.
pub fn apply_stop(
    file: &mut ExternalFile,
    params: &ExternalStopParams,
    owner: &Owner,
    now: u64,
) -> Result<StopAnswer, ExternalError> {
    let run_id = params.run_id.as_deref();
    let key = display_key(&params.external_id, run_id);
    let agent = file
        .find_key(&params.external_id, run_id)
        .filter(|agent| owner.holds(agent))
        .ok_or(ExternalError::UnknownKey(key))?;
    if !agent.is_live() {
        return Ok(StopAnswer {
            agent: agent.clone(),
            already_stopped: true,
        });
    }
    // Without a stated end, a start reported slightly ahead of this clock must
    // not leave the run ending before it began.
    let finished_at = params.finished_at.unwrap_or(now.max(agent.registered_at));
    if finished_at < agent.registered_at || finished_at > now + CLOCK_SKEW_MS {
        return Err(ExternalError::InvalidParams(
            "finishedAt lies before the registration or too far ahead of now".into(),
        ));
    }
    let state = match params.outcome.unwrap_or(StopOutcome::Success) {
        StopOutcome::Success => ExternalState::Stopped,
        StopOutcome::Failed => ExternalState::Failed,
    };
    agent.finish(state, finished_at, now);
    agent.report = ExternalReport::from_stop(params);
    if params.model.is_some() {
        agent.model = params.model.clone();
    }
    owner.refresh(agent);
    Ok(StopAnswer {
        agent: agent.clone(),
        already_stopped: false,
    })
}

/// The human's way out for a stop that never comes. Booked with no runtime; the
/// owner stays as it was, because a person is not one.
pub fn apply_close(
    file: &mut ExternalFile,
    id: &str,
    now: u64,
) -> Result<(ExternalAgent, bool), ExternalError> {
    let agent = file
        .agents
        .iter_mut()
        .find(|agent| agent.id == id)
        .ok_or_else(|| ExternalError::UnknownId(id.to_string()))?;
    if !agent.is_live() {
        return Ok((agent.clone(), false));
    }
    agent.finish(ExternalState::Stopped, now.max(agent.registered_at), now);
    agent.closed_by = Some("human".to_string());
    Ok((agent.clone(), true))
}

#[cfg(test)]
#[path = "model_tests.rs"]
mod tests;
