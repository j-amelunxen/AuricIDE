//! The wire format of the control socket: one JSON request per line in, one
//! JSON response per line out. `src/lib/agents/agentControl.fixtures.json` is
//! the contract; the tests below run every case in it.

use crate::agents::run_results::RunResult;
use crate::agents::{AgentInfo, AgentRole, AgentStatus};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const DEFAULT_TAIL_BYTES: u64 = 16 * 1024;
pub const MAX_TAIL_BYTES: u64 = 256 * 1024;
pub const DEFAULT_AWAIT_SECONDS: u64 = 0;
pub const MAX_AWAIT_SECONDS: u64 = 15;
/// How long an interactive agent's console must stay silent before
/// `await_result` with `untilInput` reads it as waiting on an answer. An
/// agent that ends its turn on a question in prose prints nothing more.
pub const INPUT_QUIET_SECONDS: u64 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidRequest,
    UnknownMethod,
    InvalidParams,
    UnknownAgent,
    AgentNotRunning,
    HeadlessNoStdin,
    ProviderDenied,
    FrontendUnavailable,
    ForbiddenAgentCaller,
    SupervisorDenied,
    OutsideSupervisorScope,
    UnknownProject,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ControlError {
    pub code: ErrorCode,
    pub message: String,
    /// A stable key from `supervisorPolicy.fixtures.json`, on
    /// `supervisor_denied` only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl ControlError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            reason: None,
        }
    }

    pub fn with_reason(mut self, reason: impl Into<String>) -> Self {
        self.reason = Some(reason.into());
        self
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyParams {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadOutputParams {
    pub agent_id: String,
    /// Always `Some` after parsing: defaulted and clamped there.
    #[serde(default)]
    pub tail_bytes: Option<u64>,
    #[serde(default)]
    pub since_offset: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendInputParams {
    pub agent_id: String,
    pub text: String,
    #[serde(default = "default_true")]
    pub enter: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentIdParams {
    pub agent_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnParams {
    pub project_path: String,
    pub prompt: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub headless: Option<bool>,
    #[serde(default)]
    pub name: Option<String>,
    /// `supervisor` from an external caller starts a supervisor; `worker` is
    /// the same as leaving it out and parses to `None`.
    #[serde(default)]
    pub role: Option<AgentRole>,
    /// Whether the request named a role at all, `worker` included. A
    /// supervisor caller may not, and `role` alone no longer says so.
    #[serde(skip)]
    pub role_passed: bool,
    /// Run the agent in a git worktree of its own, created by the frontend
    /// (`AgentConfig.useWorktree`). Whoever asked for it removes it again
    /// with `remove_worktree`.
    #[serde(default)]
    pub worktree: Option<bool>,
    /// Why the task needs the model. A supervisor's spawn of a model from
    /// `REASON_REQUIRED_FROM_RANK` on is refused without one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reason: Option<String>,
}

/// `list_projects`: `project`, a path or a project name, keeps only the
/// projects it names.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectsParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwaitResultParams {
    pub agent_id: String,
    /// Always `Some` after parsing: defaulted and clamped there.
    #[serde(default)]
    pub wait_seconds: Option<u64>,
    /// Also return, unfinished, once the agent waits on an answer: a prompt
    /// in its console tail, or `INPUT_QUIET_SECONDS` of silence.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub until_input: bool,
    /// With `until_input`: only output past this offset can wake the call, so
    /// a question already seen does not wake it again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since_offset: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "snake_case")]
pub enum Request {
    ListAgents(EmptyParams),
    ReadOutput(ReadOutputParams),
    SendInput(SendInputParams),
    Kill(AgentIdParams),
    Spawn(SpawnParams),
    ListProjects(ListProjectsParams),
    AwaitResult(AwaitResultParams),
    RemoveWorktree(AgentIdParams),
    Dismiss(AgentIdParams),
    LinkPolicyGet(EmptyParams),
    LinkPolicyPropose(LinkPolicyProposeParams),
}

/// `link_policy_propose`: structured changes to the supervisor link policy
/// and why. Supervisor callers only; it stores a proposal a person decides.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkPolicyProposeParams {
    pub reason: String,
    pub changes: Vec<crate::supervisor_link::proposals::PolicyChange>,
}

const METHODS: [&str; 11] = [
    "list_agents",
    "read_output",
    "send_input",
    "kill",
    "spawn",
    "list_projects",
    "await_result",
    "remove_worktree",
    "dismiss",
    "link_policy_get",
    "link_policy_propose",
];

/// A request line that could not be turned into a `Request`. `id` is echoed
/// when the line carried one, `null` otherwise.
#[derive(Debug, Clone, PartialEq)]
pub struct Rejected {
    pub id: Value,
    pub error: ControlError,
}

pub fn parse_request(line: &str) -> Result<(Value, Request), Rejected> {
    let reject = |id: Value, code, message: String| Rejected {
        id,
        error: ControlError::new(code, message),
    };
    let value: Value = serde_json::from_str(line).map_err(|error| {
        reject(
            Value::Null,
            ErrorCode::InvalidRequest,
            format!("request is not valid JSON: {error}"),
        )
    })?;
    let Some(object) = value.as_object() else {
        return Err(reject(
            Value::Null,
            ErrorCode::InvalidRequest,
            "request must be a JSON object".into(),
        ));
    };
    let id = object.get("id").cloned().unwrap_or(Value::Null);
    let Some(method) = object.get("method").and_then(Value::as_str) else {
        return Err(reject(
            id,
            ErrorCode::InvalidRequest,
            "request has no string \"method\"".into(),
        ));
    };
    if !METHODS.contains(&method) {
        return Err(reject(
            id,
            ErrorCode::UnknownMethod,
            format!("unknown method \"{method}\"; known: {}", METHODS.join(", ")),
        ));
    }
    let params = match object.get("params") {
        None | Some(Value::Null) => json!({}),
        Some(params) => params.clone(),
    };
    let request: Request = serde_json::from_value(json!({ "method": method, "params": params }))
        .map_err(|error| {
            reject(
                id.clone(),
                ErrorCode::InvalidParams,
                format!("invalid params for {method}: {error}"),
            )
        })?;
    let role_passed = params.get("role").is_some_and(|role| !role.is_null());
    let request = match request {
        Request::Spawn(mut spawn) => {
            spawn.role_passed = role_passed;
            Request::Spawn(spawn)
        }
        other => other,
    };
    match normalise(request) {
        Ok(request) => Ok((id, request)),
        Err(message) => Err(reject(id, ErrorCode::InvalidParams, message)),
    }
}

/// Defaults and checks serde cannot express on its own.
fn normalise(request: Request) -> Result<Request, String> {
    let blank = |value: &str| value.trim().is_empty();
    match request {
        Request::ReadOutput(mut params) => {
            if blank(&params.agent_id) {
                return Err("agentId must not be empty".into());
            }
            let tail = params.tail_bytes.unwrap_or(DEFAULT_TAIL_BYTES);
            params.tail_bytes = Some(tail.min(MAX_TAIL_BYTES));
            Ok(Request::ReadOutput(params))
        }
        Request::SendInput(params) => {
            if blank(&params.agent_id) {
                return Err("agentId must not be empty".into());
            }
            if params.text.is_empty() && !params.enter {
                return Err("empty text without enter would write nothing".into());
            }
            Ok(Request::SendInput(params))
        }
        Request::Kill(params) | Request::RemoveWorktree(params) | Request::Dismiss(params)
            if blank(&params.agent_id) =>
        {
            Err("agentId must not be empty".into())
        }
        Request::LinkPolicyPropose(params)
            if blank(&params.reason) || params.changes.is_empty() =>
        {
            Err("reason and at least one change are required".into())
        }
        Request::ListProjects(params) if params.project.as_deref().is_some_and(blank) => {
            Err("project must not be empty; leave it out to list every project".into())
        }
        Request::Spawn(params) if blank(&params.project_path) || blank(&params.prompt) => {
            Err("projectPath and prompt must not be empty".into())
        }
        Request::Spawn(mut params) => {
            if params.role == Some(AgentRole::Worker) {
                params.role = None;
            }
            Ok(Request::Spawn(params))
        }
        Request::AwaitResult(mut params) => {
            if blank(&params.agent_id) {
                return Err("agentId must not be empty".into());
            }
            let wait = params.wait_seconds.unwrap_or(DEFAULT_AWAIT_SECONDS);
            params.wait_seconds = Some(wait.min(MAX_AWAIT_SECONDS));
            Ok(Request::AwaitResult(params))
        }
        other => Ok(other),
    }
}

pub fn ok_response(id: &Value, result: impl Serialize) -> Value {
    match serde_json::to_value(result) {
        Ok(result) => json!({ "id": id, "ok": true, "result": result }),
        Err(error) => error_response(
            id,
            &ControlError::new(ErrorCode::Internal, format!("could not serialise: {error}")),
        ),
    }
}

pub fn error_response(id: &Value, error: &ControlError) -> Value {
    json!({ "id": id, "ok": false, "error": error })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSummary {
    #[serde(flatten)]
    pub info: AgentInfo,
    pub output_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ListAgentsResult {
    pub agents: Vec<AgentSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputChunk {
    pub agent_id: String,
    pub status: AgentStatus,
    pub text: String,
    pub start_offset: u64,
    pub end_offset: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendInputResult {
    pub agent_id: String,
    pub bytes_written: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KillResult {
    pub agent_id: String,
    pub killed: bool,
}

/// `dismiss`: the finished agent's card is gone from the IDE and its kept
/// result forgotten.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DismissResult {
    pub agent_id: String,
    pub dismissed: bool,
}

/// What `remove_worktree` did with an agent's worktree. `removed: false` is
/// an answer, not a failure: the worktree holds uncommitted changes (`dirty`)
/// or commits its source does not have (`branchAhead`), and stays for a person.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveWorktreeResult {
    pub agent_id: String,
    #[serde(flatten)]
    pub worktree: crate::git::WorktreeRemoval,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnResult {
    pub agent_id: String,
}

/// What `spawn` hands the frontend: the caller's params plus what only Rust
/// may set. For a supervisor's child Rust sets `role`, `permissionMode`,
/// `spawnedByAgentId` and `runSource`; the bridge passes them on verbatim.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendSpawnParams {
    #[serde(flatten)]
    pub params: SpawnParams,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spawned_by_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_source: Option<String>,
}

/// `runSource` of a run a supervisor started (`docs/design-agent-usage.md`).
pub const RUN_SOURCE_SUPERVISOR: &str = "supervisor";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AwaitPending {
    /// Always `false`.
    pub done: bool,
    pub agent_id: String,
    pub status: AgentStatus,
    pub output_bytes: u64,
    /// Set only by a call with `until_input` that ended because the agent
    /// waits on an answer.
    pub waiting_for_input: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AwaitDone {
    /// Always `true`.
    pub done: bool,
    pub result: RunResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum AwaitOutcome {
    Pending(AwaitPending),
    Done(AwaitDone),
}

impl AwaitOutcome {
    pub fn pending(
        agent_id: &str,
        status: AgentStatus,
        output_bytes: u64,
        waiting_for_input: bool,
    ) -> Self {
        Self::Pending(AwaitPending {
            done: false,
            agent_id: agent_id.to_string(),
            status,
            output_bytes,
            waiting_for_input,
        })
    }

    pub fn done(result: RunResult) -> Self {
        Self::Done(AwaitDone { done: true, result })
    }
}

/// Where `ProjectEntry.description` came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DescriptionSource {
    User,
    Readme,
    Package,
    Cargo,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pub path: String,
    pub name: String,
    pub starred: bool,
    pub is_open: bool,
    /// The folder holds `.auric/project.db`; `spawn` refuses one without it.
    pub initialized: bool,
    /// From the recent-projects store; `None` when only starred or watched.
    pub last_opened_at: Option<u64>,
    pub running_agents: usize,
    pub description: Option<String>,
    pub description_source: Option<DescriptionSource>,
    /// Only in a supervisor's `list_projects`: what it may use there.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supervisor: Option<SupervisorAccess>,
}

/// One model in the `catalog` of a supervisor's `list_projects`, described
/// once however many projects allow it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorModelEntry {
    pub id: String,
    pub label: String,
    /// Higher is bigger; `None` is a model without a known size.
    pub rank: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_for: Option<String>,
    #[serde(
        serialize_with = "crate::providers::types::serialize_cost",
        skip_serializing_if = "Option::is_none"
    )]
    pub relative_cost: Option<f64>,
}

/// The models a provider allows in one project: `"all"` for every model the
/// catalog lists for it, else their ids.
#[derive(Debug, Clone, PartialEq)]
pub enum AllowedModels {
    All,
    Ids(Vec<String>),
}

impl Serialize for AllowedModels {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::All => serializer.serialize_str("all"),
            Self::Ids(ids) => ids.serialize(serializer),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorProviderAccess {
    pub id: String,
    /// Left out for the provider's own default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    pub models: AllowedModels,
}

/// The wire sorts keys (`serde_json` without `preserve_order`), which puts
/// `balancing` ahead of `providers`: a reader that stops early still has the
/// provider to take.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorAccess {
    /// The project's load balancing, `None` when it has none. Advisory.
    pub balancing: Option<crate::supervisor::policy::Balancing>,
    pub providers: Vec<SupervisorProviderAccess>,
    pub allow_interactive: bool,
    pub running_children: u32,
    pub max_running: u32,
}

/// Provider id → the models the listed projects allow, in the provider's order.
pub type ModelCatalog = std::collections::BTreeMap<String, Vec<SupervisorModelEntry>>;

#[derive(Debug, Clone, Serialize)]
pub struct ListProjectsResult {
    pub projects: Vec<ProjectEntry>,
    /// Only in a supervisor's `list_projects`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog: Option<ModelCatalog>,
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::supervisor::policy::{Balancing, ProviderBalance};

    pub(crate) const FIXTURES: &str =
        include_str!("../../../src/lib/agents/agentControl.fixtures.json");

    fn fixtures() -> Value {
        serde_json::from_str(FIXTURES).unwrap()
    }

    #[test]
    fn every_fixture_request_parses_as_the_contract_says() {
        let fixtures = fixtures();
        let cases = fixtures["requests"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let raw = case["raw"].as_str().unwrap();
            let parsed = parse_request(raw);
            if let Some(expected) = case.get("expected") {
                let (id, request) =
                    parsed.unwrap_or_else(|rejected| panic!("{name}: rejected {rejected:?}"));
                let mut actual = serde_json::to_value(&request).unwrap();
                actual["id"] = id;
                assert_eq!(&actual, expected, "{name}");
            } else {
                let expected = &case["expectedError"];
                let rejected = parsed.expect_err(name);
                assert_eq!(rejected.id, expected["id"], "{name}: id");
                assert_eq!(
                    serde_json::to_value(rejected.error.code).unwrap(),
                    expected["code"],
                    "{name}: code"
                );
                assert!(!rejected.error.message.is_empty(), "{name}: message");
            }
        }
    }

    #[test]
    fn error_codes_match_the_contract() {
        let codes = [
            ErrorCode::InvalidRequest,
            ErrorCode::UnknownMethod,
            ErrorCode::InvalidParams,
            ErrorCode::UnknownAgent,
            ErrorCode::AgentNotRunning,
            ErrorCode::HeadlessNoStdin,
            ErrorCode::ProviderDenied,
            ErrorCode::FrontendUnavailable,
            ErrorCode::ForbiddenAgentCaller,
            ErrorCode::SupervisorDenied,
            ErrorCode::OutsideSupervisorScope,
            ErrorCode::UnknownProject,
            ErrorCode::Internal,
        ];
        let ours: Vec<Value> = codes
            .iter()
            .map(|code| serde_json::to_value(code).unwrap())
            .collect();
        assert_eq!(Value::Array(ours), fixtures()["errorCodes"]);
    }

    #[test]
    fn tail_limits_match_the_contract() {
        let limits = &fixtures()["limits"];
        assert_eq!(limits["defaultTailBytes"], DEFAULT_TAIL_BYTES);
        assert_eq!(limits["maxTailBytes"], MAX_TAIL_BYTES);
        assert_eq!(limits["defaultAwaitSeconds"], DEFAULT_AWAIT_SECONDS);
        assert_eq!(limits["maxAwaitSeconds"], MAX_AWAIT_SECONDS);
        assert_eq!(limits["inputQuietSeconds"], INPUT_QUIET_SECONDS);
    }

    #[test]
    fn roles_and_the_supervisor_run_source_match_the_contract() {
        let fixtures = fixtures();
        let roles: Vec<Value> = [AgentRole::Worker, AgentRole::Supervisor]
            .iter()
            .map(|role| serde_json::to_value(role).unwrap())
            .collect();
        assert_eq!(Value::Array(roles), fixtures["roles"]);
        assert!(fixtures["runSources"]
            .as_array()
            .unwrap()
            .contains(&json!(RUN_SOURCE_SUPERVISOR)));
    }

    pub(crate) fn sample_agent() -> AgentInfo {
        AgentInfo {
            id: "agent-1".into(),
            name: "Fix the parser".into(),
            model: "sonnet".into(),
            provider: "claude".into(),
            status: AgentStatus::Running,
            current_task: Some("fix the parser".into()),
            started_at: 1_790_000_000_000,
            last_activity_at: Some(1_790_000_005_000),
            project_path: Some("/tmp/example-project".into()),
            repo_path: Some("/tmp/example-project".into()),
            spawned_by_ticket_id: None,
            spawned_by_goal_id: None,
            headless: false,
            role: AgentRole::Worker,
            spawned_by_agent_id: None,
        }
    }

    /// The `link_policy_get` fixture: a global `scene` type and
    /// `scene.draw` kind, one project inheriting both, one pending proposal.
    fn sample_link_policy() -> super::super::link_policy::LinkPolicyGetResult {
        use crate::supervisor_link::policy::*;
        let scene = DocumentType {
            name: "scene".into(),
            globs: vec!["docs/**/*.scene.json".into()],
            index: None,
            name_field: None,
            description_field: None,
            schema: None,
            assets: Vec::new(),
            max_asset_bytes: None,
        };
        let draw = JobKind {
            kind: "scene.draw".into(),
            instructions: None,
            global_instructions: Some("scene.draw.md".into()),
            writes: Vec::new(),
        };
        let project = "/tmp/example-project".to_string();
        let stored = StoredPolicy {
            defaults: LinkDefaults {
                document_types: vec![scene],
                job_kinds: vec![draw],
            },
            projects: [(project, ProjectEntry::default())].into(),
            jobs: JobLimits::default(),
        };
        super::super::link_policy::LinkPolicyGetResult {
            effective: resolve(&stored, None).into(),
            stored,
            pending: vec![super::super::link_policy::PendingProposal {
                id: "lp-0123456789ab".into(),
                reason: "Share the docs project".into(),
                diff: vec![
                    "+ projects[\"/tmp/other-project\"]: shared with the link, inherits the \
                     global defaults"
                        .into(),
                ],
                expires_at: 1_790_086_400_000,
            }],
        }
    }

    pub(crate) fn sample_worktree_removal(removed: bool, ahead: bool) -> RemoveWorktreeResult {
        RemoveWorktreeResult {
            agent_id: "agent-5".into(),
            worktree: crate::git::WorktreeRemoval {
                path: "/tmp/example-project.auric-wt/fix-the-parser-1a2b3c4d".into(),
                branch: Some("auric/fix-the-parser-1a2b3c4d".into()),
                source_repo: "/tmp/example-project".into(),
                removed,
                dirty: false,
                branch_ahead: ahead,
            },
        }
    }

    pub(crate) fn sample_run_result() -> RunResult {
        RunResult {
            agent_id: "agent-5".into(),
            status: AgentStatus::Idle,
            exit_code: Some(0),
            answer: Some("ANSWER: the parser handles empty input.".into()),
            is_error: false,
            source: crate::agents::run_results::RunResultSource::CliResult,
            finished_at: 1_790_000_060_000,
            cost_usd: Some(0.0123),
        }
    }

    #[test]
    // code-gate: complexity-function-length - one literal per fixture response; the list mirrors the contract file
    fn serialised_responses_match_the_fixture_responses() {
        let fixtures = fixtures();
        let expected = &fixtures["responses"];
        let cases: Vec<(&str, Value)> = vec![
            (
                "list_agents",
                ok_response(
                    &json!(1),
                    ListAgentsResult {
                        agents: vec![AgentSummary {
                            info: sample_agent(),
                            output_bytes: 5120,
                        }],
                    },
                ),
            ),
            (
                "read_output",
                ok_response(
                    &json!(2),
                    OutputChunk {
                        agent_id: "agent-1".into(),
                        status: AgentStatus::Running,
                        text: "Reading src/parser.ts\n".into(),
                        start_offset: 5098,
                        end_offset: 5120,
                        truncated: false,
                    },
                ),
            ),
            (
                "send_input",
                ok_response(
                    &json!(5),
                    SendInputResult {
                        agent_id: "agent-2".into(),
                        bytes_written: 6,
                    },
                ),
            ),
            (
                "kill",
                ok_response(
                    &json!(8),
                    KillResult {
                        agent_id: "agent-3".into(),
                        killed: true,
                    },
                ),
            ),
            (
                "spawn",
                ok_response(
                    &json!(7),
                    SpawnResult {
                        agent_id: "agent-4".into(),
                    },
                ),
            ),
            (
                "list_projects",
                ok_response(
                    &json!("a"),
                    ListProjectsResult {
                        projects: vec![
                            ProjectEntry {
                                path: "/tmp/pinned-project".into(),
                                name: "pinned-project".into(),
                                starred: true,
                                is_open: false,
                                initialized: true,
                                last_opened_at: Some(1_789_990_000_000),
                                running_agents: 0,
                                description: Some(
                                    "Customer portal; ask before touching billing.".into(),
                                ),
                                description_source: Some(DescriptionSource::User),
                                supervisor: None,
                            },
                            ProjectEntry {
                                path: "/tmp/example-project".into(),
                                name: "example-project".into(),
                                starred: true,
                                is_open: true,
                                initialized: true,
                                last_opened_at: Some(1_790_000_000_000),
                                running_agents: 1,
                                description: Some(
                                    "A small example service that parses invoices.".into(),
                                ),
                                description_source: Some(DescriptionSource::Readme),
                                supervisor: None,
                            },
                            ProjectEntry {
                                path: "/tmp/other-project".into(),
                                name: "other-project".into(),
                                starred: false,
                                is_open: false,
                                initialized: false,
                                last_opened_at: None,
                                running_agents: 0,
                                description: None,
                                description_source: None,
                                supervisor: None,
                            },
                        ],
                        catalog: None,
                    },
                ),
            ),
            (
                "await_result",
                ok_response(&json!(18), AwaitOutcome::done(sample_run_result())),
            ),
            (
                "remove_worktree",
                ok_response(&json!(25), sample_worktree_removal(true, false)),
            ),
            (
                "dismiss",
                ok_response(
                    &json!(27),
                    DismissResult {
                        agent_id: "agent-5".into(),
                        dismissed: true,
                    },
                ),
            ),
            (
                "link_policy_get",
                ok_response(&json!(30), sample_link_policy()),
            ),
            (
                "link_policy_propose",
                ok_response(
                    &json!(31),
                    super::super::link_policy::LinkPolicyProposeResult {
                        proposal_id: "lp-0123456789ab".into(),
                        status: "pending",
                        expires_at: 1_790_086_400_000,
                        diff: vec![
                            "+ projects[\"/tmp/example-project\"]: shared with the link, \
                             inherits the global defaults"
                                .into(),
                        ],
                    },
                ),
            ),
            (
                "error",
                error_response(
                    &json!(5),
                    &ControlError::new(
                        ErrorCode::HeadlessNoStdin,
                        "agent-2 runs headless and does not read input",
                    ),
                ),
            ),
        ];
        let expected_keys: Vec<&String> = expected.as_object().unwrap().keys().collect();
        assert_eq!(
            expected_keys.len(),
            cases.len(),
            "a fixture response has no case"
        );
        for (name, actual) in cases {
            assert_eq!(&actual, &expected[name], "{name}");
        }
    }

    /// The further answers a method can give, built from our own types.
    #[test]
    // code-gate: complexity-function-length - one literal per fixture response; the list mirrors the contract file
    fn additional_fixture_responses_are_what_we_serialise() {
        let fixtures = fixtures();
        let mut child = sample_agent();
        child.id = "agent-5".into();
        child.name = "Check the parser".into();
        child.model = "haiku".into();
        child.current_task = Some("check the parser".into());
        child.headless = true;
        child.spawned_by_agent_id = Some("agent-sup".into());
        let failed = RunResult {
            agent_id: "agent-6".into(),
            status: AgentStatus::Error,
            exit_code: None,
            answer: Some("Error: could not reach the model".into()),
            is_error: true,
            source: crate::agents::run_results::RunResultSource::ConsoleTail,
            finished_at: 1_790_000_090_000,
            cost_usd: None,
        };
        let model = |id: &str, label: &str, rank: Option<i64>| SupervisorModelEntry {
            id: id.into(),
            label: label.into(),
            rank,
            use_for: None,
            relative_cost: None,
        };
        let described =
            |entry: SupervisorModelEntry, use_for: &str, cost: f64| SupervisorModelEntry {
                use_for: Some(use_for.into()),
                relative_cost: Some(cost),
                ..entry
            };
        let catalog = ModelCatalog::from([
            (
                "claude".to_string(),
                vec![
                    described(
                        model("haiku", "Haiku", Some(1)),
                        "Lookups, formatting, short checks.",
                        1.0,
                    ),
                    described(
                        model("sonnet", "Sonnet", Some(2)),
                        "The default: browsing, reading, normal coding.",
                        3.0,
                    ),
                ],
            ),
            (
                "codex".to_string(),
                vec![
                    model("gpt-6-luna", "GPT-6 Luna", Some(1)),
                    model("auto", "Auto", None),
                ],
            ),
        ]);
        let project = ProjectEntry {
            path: "/tmp/example-project".into(),
            name: "example-project".into(),
            starred: true,
            is_open: true,
            initialized: true,
            last_opened_at: Some(1_790_000_000_000),
            running_agents: 1,
            description: Some("A small example service that parses invoices.".into()),
            description_source: Some(DescriptionSource::Readme),
            supervisor: Some(SupervisorAccess {
                providers: vec![
                    SupervisorProviderAccess {
                        id: "claude".into(),
                        permission_mode: None,
                        models: AllowedModels::All,
                    },
                    SupervisorProviderAccess {
                        id: "codex".into(),
                        permission_mode: Some("acceptEdits".into()),
                        models: AllowedModels::Ids(vec!["gpt-6-luna".into(), "auto".into()]),
                    },
                ],
                allow_interactive: true,
                running_children: 1,
                max_running: 2,
                balancing: Some(Balancing {
                    window_days: 7,
                    next: Some("codex".into()),
                    providers: vec![
                        ProviderBalance {
                            id: "claude".into(),
                            weight: 2,
                            spawns: 3,
                            target_percent: 67,
                            actual_percent: Some(75),
                        },
                        ProviderBalance {
                            id: "codex".into(),
                            weight: 1,
                            spawns: 1,
                            target_percent: 33,
                            actual_percent: Some(25),
                        },
                    ],
                }),
            }),
        };
        let ours: Vec<(&str, Value)> = vec![
            (
                "await_result while the agent still runs",
                ok_response(
                    &json!(18),
                    AwaitOutcome::pending("agent-5", AgentStatus::Running, 2048, false),
                ),
            ),
            (
                "await_result returns early: the agent waits for input",
                ok_response(
                    &json!(21),
                    AwaitOutcome::pending("agent-5", AgentStatus::Running, 4096, true),
                ),
            ),
            (
                "await_result for an agent that failed, answer from the console tail",
                ok_response(&json!(18), AwaitOutcome::done(failed)),
            ),
            (
                "list_agents for a supervisor: its children only",
                ok_response(
                    &json!(1),
                    ListAgentsResult {
                        agents: vec![AgentSummary { info: child, output_bytes: 2048 }],
                    },
                ),
            ),
            (
                "list_projects for a supervisor: allowed projects with what it may use there, \
                 models described once",
                ok_response(
                    &json!("a"),
                    ListProjectsResult {
                        projects: vec![project],
                        catalog: Some(catalog),
                    },
                ),
            ),
            (
                "list_projects for a project the caller cannot see",
                error_response(
                    &json!(32),
                    &ControlError::new(
                        ErrorCode::UnknownProject,
                        "No project matches 'nope'. Call list_projects without project to see yours.",
                    ),
                ),
            ),
            (
                "spawn refused by the supervisor policy carries a reason key",
                error_response(
                    &json!(7),
                    &ControlError::new(
                        ErrorCode::SupervisorDenied,
                        "Model 'opus' is not allowed for claude in /tmp/example-project. Allowed: haiku, sonnet.",
                    )
                    .with_reason("model_not_allowed"),
                ),
            ),
            (
                "spawn of a large model without a reason",
                error_response(
                    &json!(7),
                    &ControlError::new(
                        ErrorCode::SupervisorDenied,
                        "Model 'opus' is large (rank 3) for claude in /tmp/example-project. Pass \
                         modelReason with why the task needs it, or take a smaller one: haiku \
                         (rank 1), sonnet (rank 2).",
                    )
                    .with_reason("model_reason_required"),
                ),
            ),
            (
                "send_input from a supervisor to an agent it did not start",
                error_response(
                    &json!(5),
                    &ControlError::new(
                        ErrorCode::UnknownAgent,
                        "no agent with id agent-5 is running or recently finished",
                    ),
                ),
            ),
            (
                "remove_worktree keeps a worktree with work in it",
                ok_response(&json!(25), sample_worktree_removal(false, true)),
            ),
        ];
        let cases = fixtures["additionalResponses"].as_array().unwrap();
        assert_eq!(cases.len(), ours.len(), "a fixture response has no case");
        for (name, actual) in ours {
            let case = cases
                .iter()
                .find(|case| case["name"] == name)
                .unwrap_or_else(|| panic!("no fixture named {name}"));
            assert_eq!(actual, case["raw"], "{name}");
        }
    }
}
