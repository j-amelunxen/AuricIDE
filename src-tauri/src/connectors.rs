//! Owner-approved, non-secret stdio connectors. No project database is consulted.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

const DEFAULT_STARTUP_TIMEOUT_S: u64 = 30;

fn default_startup_timeout_s() -> u64 {
    DEFAULT_STARTUP_TIMEOUT_S
}

fn is_default_startup_timeout_s(value: &u64) -> bool {
    *value == DEFAULT_STARTUP_TIMEOUT_S
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Launch {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Time allowed for the stdio MCP client to start and connect.
    #[serde(
        default = "default_startup_timeout_s",
        skip_serializing_if = "is_default_startup_timeout_s"
    )]
    pub startup_timeout_s: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tool {
    pub name: String,
    pub scopes: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema: String,
    pub id: String,
    pub version: String,
    pub transport: String,
    pub launch: Launch,
    pub scopes: Vec<String>,
    pub tools: Vec<Tool>,
    pub briefing: String,
    pub auth: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Registration {
    pub path: PathBuf,
    pub digest: String,
    pub manifest: Manifest,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConnectorPolicy {
    #[serde(default)]
    pub registry: BTreeMap<String, Registration>,
    /// Canonical logical project root -> connector id -> granted scopes.
    #[serde(default)]
    pub bindings: BTreeMap<String, BTreeMap<String, Vec<String>>>,
}
impl ConnectorPolicy {
    pub fn is_empty(&self) -> bool {
        self.registry.is_empty() && self.bindings.is_empty()
    }
    pub fn validate(&self) -> Result<(), String> {
        for (id, entry) in &self.registry {
            entry.manifest.validate()?;
            if id != &entry.manifest.id
                || !entry.path.is_absolute()
                || entry.digest.len() != 64
                || !entry.digest.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err("Invalid connector registration".into());
            }
        }
        let mut roots = BTreeSet::new();
        for (root, grants) in &self.bindings {
            if !Path::new(root).is_absolute()
                || !roots.insert(crate::supervisor::canonical_project_path(root))
            {
                return Err("Connector bindings need unique absolute logical project roots".into());
            }
            for (id, scopes) in grants {
                let entry = self.registry.get(id).ok_or("Unknown bound connector")?;
                if !unique(scopes) || scopes.iter().any(|s| !entry.manifest.scopes.contains(s)) {
                    return Err("Unknown or duplicate connector scope".into());
                }
            }
        }
        Ok(())
    }
}
fn unique(values: &[String]) -> bool {
    values.iter().collect::<BTreeSet<_>>().len() == values.len()
}
fn name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
}
impl Manifest {
    fn validate(&self) -> Result<(), String> {
        if self.schema != "auric-connector/v0"
            || self.transport != "stdio-mcp"
            || self.auth != "none"
        {
            return Err("Only auric-connector/v0, stdio-mcp and auth: none are supported".into());
        }
        if !name(&self.id)
            || !self
                .id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err("Connector id must be a lowercase slug".into());
        }
        semver::Version::parse(&self.version).map_err(|e| e.to_string())?;
        if self.launch.command.is_empty()
            || self.launch.command.contains('\0')
            || self.launch.startup_timeout_s == 0
            || self.briefing.len() > 16_384
            || !unique(&self.scopes)
            || self
                .scopes
                .iter()
                .any(|s| s.is_empty() || s.len() > 100 || s.chars().any(char::is_control))
        {
            return Err("Invalid connector launch, briefing or scopes".into());
        }
        let mut tools = BTreeSet::new();
        for tool in &self.tools {
            if !name(&tool.name)
                || !tools.insert(&tool.name)
                || !unique(&tool.scopes)
                || tool.scopes.iter().any(|s| !self.scopes.contains(s))
            {
                return Err("Invalid tool inventory or unknown scope".into());
            }
        }
        for (key, value) in &self.launch.env {
            if key.is_empty()
                || key.starts_with("AURIC_")
                || key.contains('=')
                || key.contains('\0')
                || value.contains('\0')
            {
                return Err("Invalid environment key/value; AURIC_ is host-owned".into());
            }
        }
        for arg in &self.launch.args {
            let stripped = arg
                .replace("${AURIC_PROJECT_NAME}", "")
                .replace("${AURIC_PROJECT_ROOT}", "");
            if stripped.contains("${") || arg.contains('\0') {
                return Err("Only AURIC_PROJECT_NAME and AURIC_PROJECT_ROOT substitutions are supported in args".into());
            }
        }
        Ok(())
    }
}
/// Reads the bytes once: digest and parsed definition always refer to the same content.
pub fn inspect(path: &Path) -> Result<Registration, String> {
    if !path.is_absolute()
        || path.file_name().and_then(|s| s.to_str()) != Some("auric-connector.yaml")
    {
        return Err("Choose an absolute path to auric-connector.yaml".into());
    }
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() > 262_144 {
        return Err("Connector manifest exceeds 256 KiB".into());
    }
    let manifest: Manifest = serde_yaml::from_slice(&bytes).map_err(|e| e.to_string())?;
    manifest.validate()?;
    Ok(Registration {
        path,
        digest: format!("{:x}", Sha256::digest(&bytes)),
        manifest,
    })
}
/// Saving unrelated settings preserves disabled entries. New approvals must match current bytes.
pub fn validate_registration_changes(
    before: &ConnectorPolicy,
    after: &ConnectorPolicy,
) -> Result<(), String> {
    for (id, entry) in &after.registry {
        if before.registry.get(id) != Some(entry) && inspect(&entry.path)? != *entry {
            return Err(format!(
                "Connector {id} changed after review; review it again before saving"
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn connector_inspect(path: String) -> Result<Registration, String> {
    inspect(Path::new(&path))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedConnector {
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub startup_timeout_s: u64,
    pub allowed_tools: Vec<String>,
    pub denied_tools: Vec<String>,
    pub briefing: String,
}
impl ResolvedConnector {
    pub fn server_name(&self) -> String {
        format!("connector-{}", self.id)
    }
}
/// Disabled/missing/changed definitions contribute neither a server nor a briefing.
/// Existing processes keep their immutable launch snapshot; no live revocation in v0.
pub fn resolve(
    policy: &crate::supervisor::policy::SupervisorPolicy,
    root: &Path,
) -> Vec<ResolvedConnector> {
    let root_text = root.to_string_lossy();
    let canonical = crate::supervisor::canonical_project_path(&root_text);
    if !policy
        .projects
        .iter()
        .any(|(p, r)| r.allowed && crate::supervisor::canonical_project_path(p) == canonical)
    {
        return vec![];
    }
    let Some((_, bindings)) = policy
        .connectors
        .bindings
        .iter()
        .find(|(p, _)| crate::supervisor::canonical_project_path(p) == canonical)
    else {
        return vec![];
    };
    bindings
        .iter()
        .filter_map(|(id, scopes)| {
            let pinned = policy.connectors.registry.get(id)?;
            let current = inspect(&pinned.path).ok()?;
            if current.digest != pinned.digest || current.manifest != pinned.manifest {
                return None;
            }
            let manifest = current.manifest;
            if scopes.iter().any(|s| !manifest.scopes.contains(s)) {
                return None;
            }
            let (allowed, denied): (Vec<_>, Vec<_>) = manifest
                .tools
                .iter()
                .partition(|t| t.scopes.iter().all(|s| scopes.contains(s)));
            if allowed.is_empty() {
                return None;
            }
            let command = Path::new(&manifest.launch.command);
            let command = if command.is_absolute() {
                command.to_path_buf()
            } else {
                pinned.path.parent()?.join(command)
            };
            let project_name = root.file_name()?.to_string_lossy();
            Some(ResolvedConnector {
                id: id.clone(),
                command: command.to_string_lossy().into_owned(),
                args: manifest
                    .launch
                    .args
                    .iter()
                    .map(|s| substitute_arg(s, &project_name, &root_text))
                    .collect(),
                env: manifest.launch.env,
                startup_timeout_s: manifest.launch.startup_timeout_s,
                allowed_tools: allowed.iter().map(|t| t.name.clone()).collect(),
                denied_tools: denied.iter().map(|t| t.name.clone()).collect(),
                briefing: manifest.briefing,
            })
        })
        .collect()
}
fn substitute_arg(value: &str, project_name: &str, project_root: &str) -> String {
    static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    PATTERN
        .get_or_init(|| regex::Regex::new(r"\$\{AURIC_PROJECT_(NAME|ROOT)\}").unwrap())
        .replace_all(value, |captures: &regex::Captures<'_>| {
            if &captures[1] == "NAME" {
                project_name.to_string()
            } else {
                project_root.to_string()
            }
        })
        .into_owned()
}

pub fn launch_context(task: &str, connectors: &[ResolvedConnector]) -> String {
    let mut context = task.to_string();
    for connector in connectors {
        context.push_str(&format!(
            "\n\nExternal connector: {}\nGranted tools: {}\n{}",
            connector.id,
            connector.allowed_tools.join(", "),
            connector.briefing
        ));
    }
    context
}

/// Capability gate shared by spawn and tests. An unbound adapter must never receive even a briefing.
pub fn for_provider(
    connectors: Vec<ResolvedConnector>,
    provider_id: &str,
    provider: &dyn crate::providers::AgentProvider,
    mut binding: crate::providers::ProviderProjectBinding,
) -> Result<Vec<ResolvedConnector>, String> {
    binding = binding
        .with_mcp_config_path("connector-capability-probe")
        .with_crush_config_path("connector-capability-probe")
        .with_runtime_entrypoint("connector-capability-probe");
    let material = crate::providers::project_binding_material(provider_id, provider, &binding)?;
    // An env-only bridge can serve just Auric PM (e.g. AURIC_MCP_CONFIG),
    // so nonempty launch material alone is not connector support.
    let consumes_config = provider_id == "codex"
        || material
            .arguments
            .iter()
            .any(|arg| arg.contains("connector-capability-probe"))
        || material.env_vars.iter().any(|(key, value)| {
            key == "CRUSH_GLOBAL_CONFIG" && value == "connector-capability-probe"
        });
    if consumes_config {
        Ok(connectors)
    } else {
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests;
