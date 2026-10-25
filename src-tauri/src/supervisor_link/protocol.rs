//! The wire format of the supervisor link: one JSON message per WebSocket
//! text frame, versioned with `v`. `src/lib/agents/supervisorLink.fixtures.json`
//! is the contract; the tests below run every case in it.

use crate::agents::AgentRole;
use crate::control_socket::protocol::{ControlError, MAX_TAIL_BYTES};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub const PROTOCOL: u64 = 1;
pub const DEFAULT_SEARCH_LIMIT: u32 = 50;
pub const MAX_SEARCH_LIMIT: u32 = 200;
/// Fixture `jobs`.
pub const MAX_PAYLOAD_BYTES: usize = 16_384;
pub const DEFAULT_JOBS_LIMIT: u32 = 50;
pub const MAX_JOBS_LIMIT: u32 = 200;

pub const METHODS: [&str; 18] = [
    "session.hello",
    "supervisors.spawn",
    "supervisors.list",
    "agents.list",
    "agents.read",
    "agents.send",
    "agents.kill",
    "events.subscribe",
    "events.unsubscribe",
    "documents.projects",
    "documents.search",
    "documents.get",
    "documents.resolve",
    "documents.asset",
    "documents.propose",
    "jobs.create",
    "jobs.list",
    "jobs.cancel",
];

pub const EVENTS: [&str; 8] = [
    "agent.added",
    "agent.updated",
    "agent.removed",
    "agent.output",
    "job.started",
    "job.progress",
    "job.finished",
    "job.failed",
];

/// Every code the link may answer with. A code from elsewhere (the control
/// dispatcher, the frontend) that is not in this list goes out as `internal`
/// with the original code kept in the message.
pub const ERROR_CODES: [&str; 31] = [
    "invalid_request",
    "unsupported_version",
    "unknown_method",
    "invalid_params",
    "forbidden_agent_caller",
    "unknown_agent",
    "agent_not_running",
    "headless_no_stdin",
    "supervisor_unavailable",
    "provider_denied",
    "provider_unsupported",
    "frontend_unavailable",
    "document_not_visible",
    "document_not_found",
    "document_invalid",
    "document_conflict",
    "not_a_git_repo",
    "supervisor_denied",
    "job_kind_not_allowed",
    "quota_exceeded",
    "unknown_job",
    "busy",
    "supervisor_key_invalid",
    "supervisor_key_in_use",
    "unknown_supervisor",
    "manager_archived",
    "manager_key_mismatch",
    "manager_key_foreign_folder",
    "instructions_too_large",
    "registry_unreadable",
    "internal",
];

/// What this server can do beyond protocol 1 as first published; a client
/// checks before it relies on it (`session.hello`).
pub const FEATURES: [&str; 2] = ["supervisorKeys", "roleFilter"];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LinkError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl LinkError {
    /// `code` must be one of `ERROR_CODES`; anything else becomes `internal`.
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        let message = message.into();
        if ERROR_CODES.contains(&code) {
            return Self {
                code: code.to_string(),
                message,
                reason: None,
            };
        }
        Self {
            code: "internal".to_string(),
            message: format!("{code}: {message}"),
            reason: None,
        }
    }

    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self::new("invalid_params", message)
    }
}

impl From<ControlError> for LinkError {
    fn from(error: ControlError) -> Self {
        let code = serde_json::to_value(error.code)
            .ok()
            .and_then(|code| code.as_str().map(str::to_string))
            .unwrap_or_else(|| "internal".to_string());
        let mut link = LinkError::new(&code, error.message);
        link.reason = error.reason;
        link
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Empty {}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelloParams {
    #[serde(default)]
    pub client: Option<String>,
}

/// `supervisors.spawn { if }`: what a key a live supervisor already carries
/// means.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpawnIf {
    /// Refuse it: `supervisor_key_in_use`.
    #[default]
    New,
    /// Answer that supervisor instead of starting one.
    Existing,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpawnSupervisorParams {
    #[serde(default)]
    pub key: Option<String>,
    /// Only with `key`.
    #[serde(default, rename = "if")]
    pub if_live: Option<SpawnIf>,
    #[serde(default)]
    pub task: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

/// What the frontend gets for `supervisors.spawn` (`spawn_supervisor`):
/// `if` is decided before, here, and the key travels as `supervisorKey`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendSupervisorSpawn {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supervisor_key: Option<String>,
}

/// Exactly one of `agentId` and `supervisor` (a key) names the agent of
/// `agents.read`, `agents.send` and `agents.kill`. The key is resolved when
/// the request runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    Agent(String),
    Supervisor(String),
}

fn target(
    method: &str,
    agent_id: Option<String>,
    supervisor: Option<String>,
) -> Result<Target, LinkError> {
    match (agent_id, supervisor) {
        (Some(agent_id), None) => Ok(Target::Agent(agent_id)),
        (None, Some(key)) => {
            check_key_format(&key)?;
            Ok(Target::Supervisor(key))
        }
        _ => Err(LinkError::invalid_params(format!(
            "{method}: give exactly one of agentId and supervisor"
        ))),
    }
}

/// A key a client passed that cannot be one: `supervisor_key_invalid`.
pub fn check_key_format(key: &str) -> Result<(), LinkError> {
    if crate::supervisor::several::is_valid_key(key) {
        return Ok(());
    }
    Err(LinkError::new(
        "supervisor_key_invalid",
        crate::supervisor::several::key_invalid_message(key),
    ))
}

fn check_optional_key(key: Option<&str>) -> Result<(), LinkError> {
    key.map_or(Ok(()), check_key_format)
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawRead {
    #[serde(default)]
    agent_id: Option<String>,
    #[serde(default)]
    supervisor: Option<String>,
    #[serde(default)]
    since_offset: Option<u64>,
    #[serde(default)]
    tail_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadParams {
    pub target: Target,
    pub since_offset: Option<u64>,
    pub tail_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawSend {
    #[serde(default)]
    agent_id: Option<String>,
    #[serde(default)]
    supervisor: Option<String>,
    text: String,
    #[serde(default = "default_true")]
    submit: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SendParams {
    pub target: Target,
    pub text: String,
    pub submit: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawAgent {
    #[serde(default)]
    agent_id: Option<String>,
    #[serde(default)]
    supervisor: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentParams {
    pub target: Target,
}

#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubscribeParams {
    #[serde(default)]
    pub agent_ids: Option<Vec<String>>,
    #[serde(default)]
    pub output: Option<bool>,
    #[serde(default)]
    pub since_offsets: Option<BTreeMap<String, u64>>,
    /// Default `true`: `job.*` events for every job of the register, or with
    /// `supervisors` for the jobs those supervisors asked for.
    #[serde(default)]
    pub jobs: Option<bool>,
    /// Keys or agent ids: each supervisor's whole subtree, recomputed every
    /// poll (`subtree.rs`). With `agentIds`, the union of both.
    #[serde(default)]
    pub supervisors: Option<Vec<String>>,
    /// Only agents of these roles (`roleFilter`). Narrows whatever the other
    /// filters cover; alone it covers every tree agent of the role, so a
    /// supervisor started later is delivered without subscribing again.
    #[serde(default)]
    pub roles: Option<Vec<AgentRole>>,
}

/// `agents.list { roles }`.
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListAgentsParams {
    #[serde(default)]
    pub roles: Option<Vec<AgentRole>>,
}

fn non_empty_roles(method: &str, roles: &Option<Vec<AgentRole>>) -> Result<(), LinkError> {
    match roles {
        Some(list) if list.is_empty() => Err(LinkError::invalid_params(format!(
            "{method}: roles needs at least one of \"supervisor\", \"worker\""
        ))),
        _ => Ok(()),
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchParams {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default, rename = "type")]
    pub document_type: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetParams {
    pub project: String,
    #[serde(rename = "type")]
    pub document_type: String,
    pub id: String,
    #[serde(default)]
    pub rev: Option<String>,
}

/// `documents.asset`: a file one of the project's document types lists under
/// `assets`, from the working tree or a commit.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetParams {
    pub project: String,
    pub path: String,
    #[serde(default)]
    pub rev: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveParams {
    pub project: String,
    #[serde(rename = "type")]
    pub document_type: String,
    pub from: String,
    #[serde(rename = "ref")]
    pub reference: String,
    #[serde(default)]
    pub rev: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProposeParams {
    pub project: String,
    #[serde(rename = "type")]
    pub document_type: String,
    pub id: String,
    pub document: Value,
    /// Required, and `null` is a value: "this document is new". A `Value`
    /// rather than an `Option` because serde reads a missing `Option` as
    /// `None`, which would turn a forgotten field into a blind overwrite check.
    pub base_hash: Value,
    #[serde(default)]
    pub message: Option<String>,
    /// The supervisor the proposal is for: named in the inbox notification.
    #[serde(default)]
    pub supervisor: Option<String>,
}

impl ProposeParams {
    /// `Ok(None)` for a new document, `Ok(Some(hash))` for an update.
    pub fn base(&self) -> Result<Option<&str>, LinkError> {
        match &self.base_hash {
            Value::Null => Ok(None),
            Value::String(hash) if !hash.is_empty() => Ok(Some(hash)),
            _ => Err(LinkError::invalid_params(
                "documents.propose: baseHash must be the document's hash or null for a new one",
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateJobParams {
    pub project: String,
    pub kind: String,
    /// Opaque to the IDE; handed to the agent as data. Required, `null` included.
    pub payload: Value,
    /// The supervisor that wants the job: it is told when the job ends.
    #[serde(default)]
    pub supervisor: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Running,
    Finished,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListJobsParams {
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub status: Option<JobStatus>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobParams {
    pub job_id: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq)]
pub enum LinkRequest {
    Hello(HelloParams),
    SpawnSupervisor(SpawnSupervisorParams),
    ListSupervisors,
    ListAgents(ListAgentsParams),
    Read(ReadParams),
    Send(SendParams),
    Kill(AgentParams),
    Subscribe(SubscribeParams),
    Unsubscribe,
    DocumentProjects,
    DocumentSearch(SearchParams),
    DocumentGet(GetParams),
    DocumentResolve(ResolveParams),
    DocumentAsset(AssetParams),
    DocumentPropose(ProposeParams),
    CreateJob(CreateJobParams),
    ListJobs(ListJobsParams),
    CancelJob(JobParams),
}

/// A message that could not be turned into a request, with the id to echo
/// (`null` when none was readable).
#[derive(Debug, Clone, PartialEq)]
pub struct Rejected {
    pub id: Value,
    pub error: LinkError,
}

fn params<T: DeserializeOwned>(method: &str, raw: Value) -> Result<T, LinkError> {
    serde_json::from_value(raw)
        .map_err(|error| LinkError::invalid_params(format!("{method}: {error}")))
}

pub fn parse_message(text: &str) -> Result<(Value, LinkRequest), Rejected> {
    let reject = |id: Value, code: &str, message: String| Rejected {
        id,
        error: LinkError::new(code, message),
    };
    let value: Value = serde_json::from_str(text)
        .map_err(|error| reject(Value::Null, "invalid_request", format!("not JSON: {error}")))?;
    let Value::Object(mut envelope) = value else {
        return Err(reject(
            Value::Null,
            "invalid_request",
            "a message is a JSON object".into(),
        ));
    };
    // An id that is neither a string nor a number is refused, not answered
    // as `null`: the client could not match that answer to its request.
    let id = match envelope.remove("id") {
        Some(id @ (Value::String(_) | Value::Number(_))) => id,
        None | Some(Value::Null) => Value::Null,
        Some(_) => {
            return Err(reject(
                Value::Null,
                "invalid_request",
                "id must be a string or a number".into(),
            ))
        }
    };
    if envelope.get("v").and_then(Value::as_u64) != Some(PROTOCOL) {
        return Err(reject(
            id,
            "unsupported_version",
            format!("this server speaks v {PROTOCOL}"),
        ));
    }
    let Some(method) = envelope.get("method").and_then(Value::as_str) else {
        return Err(reject(
            id,
            "invalid_request",
            "method must be a string".into(),
        ));
    };
    let method = method.to_string();
    let raw = match envelope.remove("params") {
        None | Some(Value::Null) => json!({}),
        Some(raw @ Value::Object(_)) => raw,
        Some(_) => {
            return Err(reject(
                id,
                "invalid_params",
                format!("{method}: params must be an object"),
            ))
        }
    };
    let request = parse_request(&method, raw).map_err(|error| Rejected {
        id: id.clone(),
        error,
    })?;
    Ok((id, request))
}

// code-gate: complexity-cyclomatic, complexity-function-length - one arm per contract method, each with its own range checks; the table reads best as one match
fn parse_request(method: &str, raw: Value) -> Result<LinkRequest, LinkError> {
    let request = match method {
        "session.hello" => LinkRequest::Hello(params(method, raw)?),
        "supervisors.spawn" => {
            let spawn: SpawnSupervisorParams = params(method, raw)?;
            if spawn.key.is_none() && spawn.if_live.is_some() {
                return Err(LinkError::invalid_params(
                    "supervisors.spawn: if needs a key",
                ));
            }
            check_optional_key(spawn.key.as_deref())?;
            LinkRequest::SpawnSupervisor(spawn)
        }
        "supervisors.list" => {
            params::<Empty>(method, raw)?;
            LinkRequest::ListSupervisors
        }
        "agents.list" => {
            let list: ListAgentsParams = params(method, raw)?;
            non_empty_roles(method, &list.roles)?;
            LinkRequest::ListAgents(list)
        }
        "agents.read" => {
            let read: RawRead = params(method, raw)?;
            if read.tail_bytes.is_some_and(|tail| tail > MAX_TAIL_BYTES) {
                return Err(LinkError::invalid_params(format!(
                    "agents.read: tailBytes is at most {MAX_TAIL_BYTES}"
                )));
            }
            LinkRequest::Read(ReadParams {
                target: target(method, read.agent_id, read.supervisor)?,
                since_offset: read.since_offset,
                tail_bytes: read.tail_bytes,
            })
        }
        "agents.send" => {
            let send: RawSend = params(method, raw)?;
            LinkRequest::Send(SendParams {
                target: target(method, send.agent_id, send.supervisor)?,
                text: send.text,
                submit: send.submit,
            })
        }
        "agents.kill" => {
            let kill: RawAgent = params(method, raw)?;
            LinkRequest::Kill(AgentParams {
                target: target(method, kill.agent_id, kill.supervisor)?,
            })
        }
        "events.subscribe" => {
            let subscribe: SubscribeParams = params(method, raw)?;
            non_empty_roles(method, &subscribe.roles)?;
            LinkRequest::Subscribe(subscribe)
        }
        "events.unsubscribe" => {
            params::<Empty>(method, raw)?;
            LinkRequest::Unsubscribe
        }
        "documents.projects" => {
            params::<Empty>(method, raw)?;
            LinkRequest::DocumentProjects
        }
        "documents.search" => {
            let search: SearchParams = params(method, raw)?;
            if search
                .limit
                .is_some_and(|limit| limit == 0 || limit > MAX_SEARCH_LIMIT)
            {
                return Err(LinkError::invalid_params(format!(
                    "documents.search: limit is 1..{MAX_SEARCH_LIMIT}"
                )));
            }
            LinkRequest::DocumentSearch(search)
        }
        "documents.get" => LinkRequest::DocumentGet(params(method, raw)?),
        "documents.resolve" => LinkRequest::DocumentResolve(params(method, raw)?),
        "documents.asset" => LinkRequest::DocumentAsset(params(method, raw)?),
        "documents.propose" => {
            let propose: ProposeParams = params(method, raw)?;
            propose.base()?;
            check_optional_key(propose.supervisor.as_deref())?;
            LinkRequest::DocumentPropose(propose)
        }
        "jobs.create" => {
            let create: CreateJobParams = params(method, raw)?;
            let bytes = serde_json::to_vec(&create.payload).map_or(usize::MAX, |b| b.len());
            if bytes > MAX_PAYLOAD_BYTES {
                return Err(LinkError::invalid_params(format!(
                    "jobs.create: payload is {bytes} bytes as JSON, at most {MAX_PAYLOAD_BYTES}"
                )));
            }
            if create.kind.trim().is_empty() {
                return Err(LinkError::invalid_params("jobs.create: kind is empty"));
            }
            check_optional_key(create.supervisor.as_deref())?;
            LinkRequest::CreateJob(create)
        }
        "jobs.list" => {
            let list: ListJobsParams = params(method, raw)?;
            if list
                .limit
                .is_some_and(|limit| limit == 0 || limit > MAX_JOBS_LIMIT)
            {
                return Err(LinkError::invalid_params(format!(
                    "jobs.list: limit is 1..{MAX_JOBS_LIMIT}"
                )));
            }
            LinkRequest::ListJobs(list)
        }
        "jobs.cancel" => LinkRequest::CancelJob(params(method, raw)?),
        other => {
            return Err(LinkError::new(
                "unknown_method",
                format!("unknown method '{other}'"),
            ))
        }
    };
    Ok(request)
}

pub fn response_ok(id: &Value, result: Value) -> Value {
    json!({ "v": PROTOCOL, "type": "response", "id": id, "ok": true, "result": result })
}

pub fn response_error(id: &Value, error: &LinkError) -> Value {
    json!({ "v": PROTOCOL, "type": "response", "id": id, "ok": false, "error": error })
}

pub fn event(seq: u64, name: &str, data: Value) -> Value {
    json!({ "v": PROTOCOL, "type": "event", "seq": seq, "event": name, "data": data })
}

/// The last word before a close: the connection was refused.
pub fn fatal(error: &LinkError) -> Value {
    json!({ "v": PROTOCOL, "type": "error", "error": error })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn fixtures() -> Value {
        serde_json::from_str(include_str!(
            "../../../src/lib/agents/supervisorLink.fixtures.json"
        ))
        .expect("fixtures parse")
    }

    fn strings(value: &Value) -> Vec<String> {
        value
            .as_array()
            .expect("array")
            .iter()
            .map(|entry| entry.as_str().expect("string").to_string())
            .collect()
    }

    #[test]
    fn methods_events_and_codes_match_the_contract() {
        let fixtures = fixtures();
        assert_eq!(fixtures["protocol"], json!(PROTOCOL));
        assert_eq!(strings(&fixtures["methods"]), METHODS.to_vec());
        assert_eq!(strings(&fixtures["events"]), EVENTS.to_vec());
        assert_eq!(strings(&fixtures["errorCodes"]), ERROR_CODES.to_vec());
        assert_eq!(strings(&fixtures["features"]), FEATURES.to_vec());
        assert_eq!(
            strings(&fixtures["supervisorProviders"]),
            crate::agents::manager::SUPERVISOR_PROVIDERS.to_vec()
        );
        assert_eq!(
            fixtures["search"]["defaultLimit"],
            json!(DEFAULT_SEARCH_LIMIT)
        );
        assert_eq!(fixtures["search"]["maxLimit"], json!(MAX_SEARCH_LIMIT));
        let jobs = &fixtures["jobs"];
        assert_eq!(jobs["maxPayloadBytes"], json!(MAX_PAYLOAD_BYTES));
        assert_eq!(jobs["listDefaultLimit"], json!(DEFAULT_JOBS_LIMIT));
        assert_eq!(jobs["listMaxLimit"], json!(MAX_JOBS_LIMIT));
        let statuses: Vec<Value> = [JobStatus::Running, JobStatus::Finished, JobStatus::Failed]
            .iter()
            .map(|status| serde_json::to_value(status).expect("a status serialises"))
            .collect();
        assert_eq!(jobs["statuses"], json!(statuses));
    }

    #[test]
    fn every_fixture_message_is_accepted_or_refused_as_the_contract_says() {
        for case in fixtures()["messages"].as_array().expect("messages") {
            let name = case["name"].as_str().expect("name");
            let line = case["line"].as_str().expect("line");
            match parse_message(line) {
                Ok(_) => assert_eq!(case["accepted"], json!(true), "{name}: accepted"),
                Err(rejected) => {
                    assert_eq!(rejected.error.code, case["error"], "{name}: code");
                    assert_eq!(rejected.id, case["id"], "{name}: id");
                }
            }
        }
    }

    #[test]
    fn every_method_in_the_contract_parses_with_its_minimal_params() {
        let minimal = |method: &str| match method {
            "agents.read" | "agents.kill" => json!({ "agentId": "agent-1" }),
            "agents.send" => json!({ "agentId": "agent-1", "text": "" }),
            "documents.get" => json!({ "project": "/p", "type": "t", "id": "docs/a.json" }),
            "documents.resolve" => {
                json!({ "project": "/p", "type": "t", "from": "docs/a.json", "ref": "b" })
            }
            "documents.asset" => json!({ "project": "/p", "path": "assets/a.glb" }),
            "documents.propose" => json!({
                "project": "/p", "type": "t", "id": "docs/a.json", "document": {}, "baseHash": null
            }),
            "jobs.create" => json!({ "project": "/p", "kind": "k", "payload": null }),
            "jobs.cancel" => json!({ "jobId": "job-1" }),
            _ => json!({}),
        };
        for method in METHODS {
            let line = json!({ "v": 1, "id": 1, "method": method, "params": minimal(method) });
            assert!(
                parse_message(&line.to_string()).is_ok(),
                "{method} did not parse"
            );
        }
    }

    #[test]
    fn submit_defaults_to_true_and_a_base_hash_must_be_a_string_or_null() {
        let (_, request) = parse_message(
            r#"{"v":1,"id":1,"method":"agents.send","params":{"agentId":"a","text":"hi"}}"#,
        )
        .expect("parses");
        assert!(matches!(
            request,
            LinkRequest::Send(SendParams { submit: true, .. })
        ));
        let (_, request) = parse_message(
            r#"{"v":1,"id":1,"method":"agents.kill","params":{"supervisor":"mail-triage"}}"#,
        )
        .expect("parses");
        assert_eq!(
            request,
            LinkRequest::Kill(AgentParams {
                target: Target::Supervisor("mail-triage".into())
            })
        );
        let rejected = parse_message(
            r#"{"v":1,"id":1,"method":"documents.propose","params":{"project":"/p","type":"t","id":"docs/a.json","document":{},"baseHash":42}}"#,
        )
        .expect_err("refused");
        assert_eq!(rejected.error.code, "invalid_params");
    }

    #[test]
    fn a_foreign_code_is_reported_as_internal_with_the_code_kept() {
        let error = LinkError::new("outside_supervisor_scope", "no");
        assert_eq!(error.code, "internal");
        assert_eq!(error.message, "outside_supervisor_scope: no");
    }
}
