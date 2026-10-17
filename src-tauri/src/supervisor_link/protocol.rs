//! The wire format of the supervisor link: one JSON message per WebSocket
//! text frame, versioned with `v`. `src/lib/agents/supervisorLink.fixtures.json`
//! is the contract; the tests below run every case in it.

use crate::control_socket::protocol::{ControlError, MAX_TAIL_BYTES};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub const PROTOCOL: u64 = 1;
pub const DEFAULT_SEARCH_LIMIT: u32 = 50;
pub const MAX_SEARCH_LIMIT: u32 = 200;

pub const METHODS: [&str; 13] = [
    "session.hello",
    "supervisors.spawn",
    "agents.list",
    "agents.read",
    "agents.send",
    "agents.kill",
    "events.subscribe",
    "events.unsubscribe",
    "scenes.projects",
    "scenes.search",
    "scenes.get",
    "scenes.resolve",
    "scenes.propose",
];

pub const EVENTS: [&str; 4] = [
    "agent.added",
    "agent.updated",
    "agent.removed",
    "agent.output",
];

/// Every code the link may answer with. A code from elsewhere (the control
/// dispatcher, the frontend) that is not in this list goes out as `internal`
/// with the original code kept in the message.
pub const ERROR_CODES: [&str; 17] = [
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
    "frontend_unavailable",
    "scene_not_visible",
    "scene_not_found",
    "scene_invalid",
    "scene_conflict",
    "not_a_git_repo",
    "internal",
];

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpawnSupervisorParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadParams {
    pub agent_id: String,
    #[serde(default)]
    pub since_offset: Option<u64>,
    #[serde(default)]
    pub tail_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SendParams {
    pub agent_id: String,
    pub text: String,
    #[serde(default = "default_true")]
    pub submit: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentParams {
    pub agent_id: String,
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
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchParams {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetParams {
    pub project: String,
    pub id: String,
    #[serde(default)]
    pub rev: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolveParams {
    pub project: String,
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
    pub id: String,
    pub scene: Value,
    /// Required, and `null` is a value: "this scene is new". A `Value` rather
    /// than an `Option` because serde reads a missing `Option` as `None`, which
    /// would turn a forgotten field into a blind overwrite check.
    pub base_hash: Value,
    #[serde(default)]
    pub message: Option<String>,
}

impl ProposeParams {
    /// `Ok(None)` for a new scene, `Ok(Some(hash))` for an update.
    pub fn base(&self) -> Result<Option<&str>, LinkError> {
        match &self.base_hash {
            Value::Null => Ok(None),
            Value::String(hash) if !hash.is_empty() => Ok(Some(hash)),
            _ => Err(LinkError::invalid_params(
                "scenes.propose: baseHash must be the scene's hash or null for a new scene",
            )),
        }
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq)]
pub enum LinkRequest {
    Hello(HelloParams),
    SpawnSupervisor(SpawnSupervisorParams),
    ListAgents,
    Read(ReadParams),
    Send(SendParams),
    Kill(AgentParams),
    Subscribe(SubscribeParams),
    Unsubscribe,
    SceneProjects,
    SceneSearch(SearchParams),
    SceneGet(GetParams),
    SceneResolve(ResolveParams),
    ScenePropose(ProposeParams),
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
    let id = match envelope.remove("id") {
        Some(id @ (Value::String(_) | Value::Number(_))) => id,
        _ => Value::Null,
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

fn parse_request(method: &str, raw: Value) -> Result<LinkRequest, LinkError> {
    let request = match method {
        "session.hello" => LinkRequest::Hello(params(method, raw)?),
        "supervisors.spawn" => LinkRequest::SpawnSupervisor(params(method, raw)?),
        "agents.list" => {
            params::<Empty>(method, raw)?;
            LinkRequest::ListAgents
        }
        "agents.read" => {
            let read: ReadParams = params(method, raw)?;
            if read.tail_bytes.is_some_and(|tail| tail > MAX_TAIL_BYTES) {
                return Err(LinkError::invalid_params(format!(
                    "agents.read: tailBytes is at most {MAX_TAIL_BYTES}"
                )));
            }
            LinkRequest::Read(read)
        }
        "agents.send" => LinkRequest::Send(params(method, raw)?),
        "agents.kill" => LinkRequest::Kill(params(method, raw)?),
        "events.subscribe" => LinkRequest::Subscribe(params(method, raw)?),
        "events.unsubscribe" => {
            params::<Empty>(method, raw)?;
            LinkRequest::Unsubscribe
        }
        "scenes.projects" => {
            params::<Empty>(method, raw)?;
            LinkRequest::SceneProjects
        }
        "scenes.search" => {
            let search: SearchParams = params(method, raw)?;
            if search
                .limit
                .is_some_and(|limit| limit == 0 || limit > MAX_SEARCH_LIMIT)
            {
                return Err(LinkError::invalid_params(format!(
                    "scenes.search: limit is 1..{MAX_SEARCH_LIMIT}"
                )));
            }
            LinkRequest::SceneSearch(search)
        }
        "scenes.get" => LinkRequest::SceneGet(params(method, raw)?),
        "scenes.resolve" => LinkRequest::SceneResolve(params(method, raw)?),
        "scenes.propose" => {
            let propose: ProposeParams = params(method, raw)?;
            propose.base()?;
            LinkRequest::ScenePropose(propose)
        }
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
mod tests {
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
        assert_eq!(
            fixtures["search"]["defaultLimit"],
            json!(DEFAULT_SEARCH_LIMIT)
        );
        assert_eq!(fixtures["search"]["maxLimit"], json!(MAX_SEARCH_LIMIT));
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
            "scenes.get" => json!({ "project": "/p", "id": "docs/a" }),
            "scenes.resolve" => json!({ "project": "/p", "from": "docs/a", "ref": "b" }),
            "scenes.propose" => {
                json!({ "project": "/p", "id": "docs/a", "scene": {}, "baseHash": null })
            }
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
        let rejected = parse_message(
            r#"{"v":1,"id":1,"method":"scenes.propose","params":{"project":"/p","id":"docs/a","scene":{},"baseHash":42}}"#,
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
