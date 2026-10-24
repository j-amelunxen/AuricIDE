//! Extra MCP servers a project's agents start with, picked from the project's
//! own `.mcp.json`.
//!
//! The IDE binds every agent to a fixed set (`auric-pm`, connectors) through a
//! private config, so a server the human put into `.mcp.json` never reached a
//! spawned agent. A project may now name servers in its supervisor rules
//! (`extraMcpServers`); the definitions are read from `.mcp.json` at spawn time
//! and added next to the built-in ones. Built-in names always win a clash.
//!
//! Definitions travel as written (env and headers included) into the agent's
//! private config only. Nothing here logs or returns a value: warnings and the
//! inspect result carry names, transports and reasons, never commands, env or
//! headers.
use serde::Serialize;
use serde_json::{Map, Value};
use std::{collections::BTreeMap, path::Path};

pub const FILE_NAME: &str = ".mcp.json";
const MAX_FILE_BYTES: u64 = 262_144;
const MAX_NAME_LEN: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteKind {
    Http,
    Sse,
}

impl RemoteKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RemoteKind::Http => "http",
            RemoteKind::Sse => "sse",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExtraTransport {
    Stdio {
        command: String,
        args: Vec<String>,
        env: BTreeMap<String, String>,
    },
    Remote {
        kind: RemoteKind,
        url: String,
        headers: BTreeMap<String, String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtraMcpServer {
    pub name: String,
    pub transport: ExtraTransport,
}

/// A server the policy named but that did not make it into the agent, and why.
/// The reason never contains a value from the file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Skipped {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Resolved {
    pub servers: Vec<ExtraMcpServer>,
    pub skipped: Vec<Skipped>,
}

/// Names the IDE registers itself. A `.mcp.json` entry with one of these is
/// never taken, so it cannot replace Auric PM or a connector.
pub fn is_reserved(name: &str) -> bool {
    name.starts_with("auric-") || name.starts_with("connector-") || name == "auric"
}

/// Letters, digits, `_` and `-`: valid as a JSON key, a Claude tool prefix and
/// an unquoted TOML key (Codex `-c mcp_servers.<name>.…`).
pub fn is_valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_LEN
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn string_map(value: Option<&Value>) -> Result<BTreeMap<String, String>, ()> {
    match value {
        None | Some(Value::Null) => Ok(BTreeMap::new()),
        Some(Value::Object(map)) => map
            .iter()
            .map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string())).ok_or(()))
            .collect(),
        Some(_) => Err(()),
    }
}

fn string_list(value: Option<&Value>) -> Result<Vec<String>, ()> {
    match value {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| v.as_str().map(str::to_string).ok_or(()))
            .collect(),
        Some(_) => Err(()),
    }
}

/// One `.mcp.json` entry as Claude Code writes it: `command`/`args`/`env`, or
/// `type: http|sse` with `url`/`headers`.
pub fn parse_definition(name: &str, entry: &Value) -> Result<ExtraMcpServer, &'static str> {
    let Value::Object(source) = entry else {
        return Err("the entry is not an object");
    };
    let text = |key: &str| source.get(key).and_then(Value::as_str).map(str::trim);
    let transport = if let Some(url) = text("url").filter(|u| !u.is_empty()) {
        let kind = match text("type") {
            None | Some("http") | Some("streamable-http") => RemoteKind::Http,
            Some("sse") => RemoteKind::Sse,
            Some(_) => return Err("unsupported transport type"),
        };
        ExtraTransport::Remote {
            kind,
            url: url.to_string(),
            headers: string_map(source.get("headers")).map_err(|_| "headers must be strings")?,
        }
    } else if let Some(command) = text("command").filter(|c| !c.is_empty()) {
        if !matches!(text("type"), None | Some("stdio")) {
            return Err("unsupported transport type");
        }
        if command.contains('\0') {
            return Err("invalid command");
        }
        ExtraTransport::Stdio {
            command: command.to_string(),
            args: string_list(source.get("args")).map_err(|_| "args must be strings")?,
            env: string_map(source.get("env")).map_err(|_| "env must be strings")?,
        }
    } else {
        return Err("neither command nor url");
    };
    Ok(ExtraMcpServer {
        name: name.to_string(),
        transport,
    })
}

/// The `mcpServers` object of `<root>/.mcp.json`. `Ok(None)`: no such file.
pub fn read_project_servers(root: &Path) -> Result<Option<Map<String, Value>>, String> {
    let path = root.join(FILE_NAME);
    let meta = match std::fs::metadata(&path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("{FILE_NAME} is not readable: {}", error.kind())),
    };
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return Err(format!("{FILE_NAME} is not a regular file under 256 KiB"));
    }
    let bytes = std::fs::read(&path)
        .map_err(|error| format!("{FILE_NAME} is not readable: {}", error.kind()))?;
    let parsed: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("{FILE_NAME} is not valid JSON (line {})", error.line()))?;
    match parsed.get("mcpServers") {
        None | Some(Value::Null) => Ok(Some(Map::new())),
        Some(Value::Object(servers)) => Ok(Some(servers.clone())),
        Some(_) => Err(format!("{FILE_NAME}: mcpServers is not an object")),
    }
}

/// Resolves the named servers against the project's `.mcp.json`. Anything
/// unusable is skipped with a reason; a missing or broken file skips them all.
pub fn resolve_names(names: &[String], root: &Path) -> Resolved {
    let mut resolved = Resolved::default();
    if names.is_empty() {
        return resolved;
    }
    let file = match read_project_servers(root) {
        Ok(Some(servers)) => servers,
        Ok(None) => Map::new(),
        Err(reason) => {
            resolved.skipped = names
                .iter()
                .map(|name| Skipped {
                    name: name.clone(),
                    reason: reason.clone(),
                })
                .collect();
            return resolved;
        }
    };
    for name in names {
        let skip = |reason: &str| Skipped {
            name: name.clone(),
            reason: reason.to_string(),
        };
        if !is_valid_name(name) {
            resolved
                .skipped
                .push(skip("the name is not letters, digits, _ or -"));
        } else if is_reserved(name) {
            resolved
                .skipped
                .push(skip("the name is reserved by the IDE"));
        } else if let Some(entry) = file.get(name) {
            match parse_definition(name, entry) {
                Ok(server) => resolved.servers.push(server),
                Err(reason) => resolved.skipped.push(skip(reason)),
            }
        } else {
            resolved.skipped.push(skip("not found in .mcp.json"));
        }
    }
    resolved
}

/// The project's supervisor rules name the servers; the project must be listed
/// and allowed, like for connectors.
pub fn resolve(policy: &crate::supervisor::policy::SupervisorPolicy, root: &Path) -> Resolved {
    let canonical = crate::supervisor::canonical_project_path(&root.to_string_lossy());
    let names = policy
        .projects
        .iter()
        .find(|(path, rules)| {
            rules.allowed && crate::supervisor::canonical_project_path(path) == canonical
        })
        .map(|(_, rules)| rules.extra_mcp_servers.clone())
        .unwrap_or_default();
    resolve_names(&names, root)
}

/// Drops what the provider cannot carry. Codex speaks streamable HTTP only.
pub fn for_provider(provider_id: &str, mut resolved: Resolved) -> Resolved {
    if provider_id == "codex" {
        let (kept, dropped): (Vec<_>, Vec<_>) = resolved.servers.into_iter().partition(|s| {
            !matches!(
                s.transport,
                ExtraTransport::Remote {
                    kind: RemoteKind::Sse,
                    ..
                }
            )
        });
        resolved.servers = kept;
        resolved
            .skipped
            .extend(dropped.into_iter().map(|s| Skipped {
                name: s.name,
                reason: "Codex does not support SSE servers".to_string(),
            }));
    }
    resolved
}

/// The shape of one server in a standard (`mcpServers`) config.
pub fn config_value(server: &ExtraMcpServer) -> Value {
    match &server.transport {
        ExtraTransport::Stdio { command, args, env } => {
            serde_json::json!({ "command": command, "args": args, "env": env })
        }
        ExtraTransport::Remote { kind, url, headers } => {
            serde_json::json!({ "type": kind.as_str(), "url": url, "headers": headers })
        }
    }
}

/// Adds the extras next to the built-in servers. A name that is already there
/// keeps its built-in definition. Returns the names that were added.
pub fn merge_into(servers: &mut Map<String, Value>, extras: &[ExtraMcpServer]) -> Vec<String> {
    let mut added = Vec::new();
    for server in extras {
        if !servers.contains_key(&server.name) {
            servers.insert(server.name.clone(), config_value(server));
            added.push(server.name.clone());
        }
    }
    added
}

/// What the settings picker shows for one `.mcp.json` entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovered {
    pub name: String,
    /// `stdio`, `http`, `sse`, or `invalid`.
    pub transport: String,
    /// Why the entry cannot be used; `None` when it can.
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub file_found: bool,
    pub servers: Vec<Discovered>,
    pub error: Option<String>,
}

pub fn inspect(root: &Path) -> Inspection {
    let file = match read_project_servers(root) {
        Ok(Some(servers)) => servers,
        Ok(None) => return Inspection::default(),
        Err(error) => {
            return Inspection {
                file_found: true,
                servers: Vec::new(),
                error: Some(error),
            }
        }
    };
    let servers = file
        .iter()
        .map(|(name, entry)| {
            let problem = if !is_valid_name(name) {
                Some("the name is not letters, digits, _ or -".to_string())
            } else if is_reserved(name) {
                Some("the name is reserved by the IDE".to_string())
            } else {
                None
            };
            match parse_definition(name, entry) {
                Ok(server) => Discovered {
                    name: name.clone(),
                    transport: match server.transport {
                        ExtraTransport::Stdio { .. } => "stdio".to_string(),
                        ExtraTransport::Remote { kind, .. } => kind.as_str().to_string(),
                    },
                    problem,
                },
                Err(reason) => Discovered {
                    name: name.clone(),
                    transport: "invalid".to_string(),
                    problem: problem.or_else(|| Some(reason.to_string())),
                },
            }
        })
        .collect();
    Inspection {
        file_found: true,
        servers,
        error: None,
    }
}

#[tauri::command]
pub fn extra_mcp_inspect(project_path: String) -> Inspection {
    inspect(Path::new(&project_path))
}

#[cfg(test)]
mod tests;
