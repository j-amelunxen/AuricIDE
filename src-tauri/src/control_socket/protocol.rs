//! The wire format of the control socket: one JSON request per line in, one
//! JSON response per line out. `src/lib/agents/agentControl.fixtures.json` is
//! the contract; the tests below run every case in it.

use crate::agents::{AgentInfo, AgentStatus};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const DEFAULT_TAIL_BYTES: u64 = 16 * 1024;
pub const MAX_TAIL_BYTES: u64 = 256 * 1024;

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
    Internal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ControlError {
    pub code: ErrorCode,
    pub message: String,
}

impl ControlError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "snake_case")]
pub enum Request {
    ListAgents(EmptyParams),
    ReadOutput(ReadOutputParams),
    SendInput(SendInputParams),
    Kill(AgentIdParams),
    Spawn(SpawnParams),
    ListProjects(EmptyParams),
}

const METHODS: [&str; 6] = [
    "list_agents",
    "read_output",
    "send_input",
    "kill",
    "spawn",
    "list_projects",
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
        Request::Kill(params) if blank(&params.agent_id) => Err("agentId must not be empty".into()),
        Request::Spawn(params) if blank(&params.project_path) || blank(&params.prompt) => {
            Err("projectPath and prompt must not be empty".into())
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnResult {
    pub agent_id: String,
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
}

#[derive(Debug, Clone, Serialize)]
pub struct ListProjectsResult {
    pub projects: Vec<ProjectEntry>,
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

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
        }
    }

    #[test]
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
                            },
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
}
