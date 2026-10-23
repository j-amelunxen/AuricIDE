use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

// ── Serializable types for the frontend ──────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub value: String,
    pub label: String,
    /// Size within the provider, higher is bigger (`dynamic-providers/README.md`).
    /// Absent: a model without a known size, which the supervisor does not
    /// pick by default.
    #[serde(
        default,
        deserialize_with = "lenient_rank",
        skip_serializing_if = "Option::is_none"
    )]
    pub rank: Option<i64>,
    /// One sentence on the work the model is enough for, read by the
    /// supervisor when it picks a model. Absent when not a non-blank string.
    #[serde(
        default,
        deserialize_with = "lenient_text",
        skip_serializing_if = "Option::is_none"
    )]
    pub use_for: Option<String>,
    /// Price relative to the provider's cheapest model, which is 1. Absent
    /// when not a positive number.
    #[serde(
        default,
        deserialize_with = "lenient_cost",
        serialize_with = "serialize_cost",
        skip_serializing_if = "Option::is_none"
    )]
    pub relative_cost: Option<f64>,
    /// Whether the provider CLI still accepts this id. Defaults to true so
    /// older configs and tests keep working; live discovery sets false for
    /// static entries the CLI no longer lists (`model_catalog`).
    #[serde(default = "default_available", skip_serializing_if = "is_true")]
    pub available: bool,
}

impl Default for ModelOption {
    fn default() -> Self {
        Self {
            value: String::new(),
            label: String::new(),
            rank: None,
            use_for: None,
            relative_cost: None,
            available: true,
        }
    }
}

fn default_available() -> bool {
    true
}

fn is_true(value: &bool) -> bool {
    *value
}

impl ModelOption {
    pub fn is_available(&self) -> bool {
        self.available
    }
}

/// A `rank` that is not an integer is no rank, not a provider config that
/// fails to load: the size is a hint for choosing, the model still runs.
fn lenient_rank<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value.as_i64())
}

/// Like `lenient_rank`: a description that is not text is no description.
fn lenient_text<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string))
}

/// A whole cost as an integer (`3`, not `3.0`), as the config wrote it.
pub fn serialize_cost<S: serde::Serializer>(
    cost: &Option<f64>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match cost {
        Some(value) if value.fract() == 0.0 && value.abs() < 1e15 => {
            serializer.serialize_i64(*value as i64)
        }
        Some(value) => serializer.serialize_f64(*value),
        None => serializer.serialize_none(),
    }
}

/// Like `lenient_rank`: a cost that is not a positive number is no cost.
fn lenient_cost<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value
        .as_f64()
        .filter(|cost| cost.is_finite() && *cost > 0.0))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionModeOption {
    pub value: String,
    pub label: String,
    pub description: String,
    /// The mode runs without permission prompts (`dynamic-providers/README.md`).
    /// A supervisor's agents never run in such a mode.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unattended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub models: Vec<ModelOption>,
    pub permission_modes: Vec<PermissionModeOption>,
    pub default_model: String,
    pub default_permission_mode: String,
}

// ── Return types for spawn logic ─────────────────────────────────────

#[derive(Debug, Clone)]
pub struct SpawnCommand {
    pub command: String,
    pub env_vars: Vec<(String, String)>,
    /// The leading token(s) of `command` that name the binary.
    ///
    /// Reported rather than re-derived, because a config may legitimately set
    /// `"executable": "npx -y @anthropic-ai/claude-code"` — so "the first word
    /// of the command" is neither the program nor a safe place to splice an
    /// extra flag in after.
    pub executable: String,
}

impl SpawnCommand {
    /// Applies provider-specific launch material without reconstructing the
    /// command string. This is the provider-neutral seam used by project/MCP
    /// integrations and can later carry generated config-file arguments too.
    pub fn with_injection(mut self, injection: SpawnInjection) -> Self {
        if !injection.arguments.is_empty() {
            if let Some(rest) = self.command.strip_prefix(&self.executable) {
                self.command = format!(
                    "{} {}{}",
                    self.executable,
                    injection.arguments.join(" "),
                    rest
                );
            }
        }

        for (key, value) in injection.env_vars {
            self.env_vars.retain(|(existing, _)| existing != &key);
            self.env_vars.push((key, value));
        }
        self
    }

    /// Inserts a flag directly behind the executable, leaving the provider's
    /// own argument order untouched.
    ///
    /// Splices on the executable prefix rather than splitting the command into
    /// words and rejoining it: the task is embedded in this string, and
    /// re-joining would collapse any run of spaces inside the prompt the user
    /// actually wrote.
    pub fn with_flag_after_executable(mut self, flag: &str, value: &str) -> Self {
        let Some(rest) = self.command.strip_prefix(&self.executable) else {
            return self;
        };
        // The value is quoted here, so it is escaped here too. A path under
        // `Application Support` only needs the quotes; a home directory with a
        // `$` or a `!` in it needs the escaping as well.
        self.command = format!(
            "{executable} {flag} \"{value}\"{rest}",
            executable = self.executable,
            value = shell_escape_double_quoted(value),
        );
        self
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SpawnInjection {
    pub arguments: Vec<String>,
    pub env_vars: Vec<(String, String)>,
}

impl SpawnInjection {
    pub fn is_empty(&self) -> bool {
        self.arguments.is_empty() && self.env_vars.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderProjectBinding {
    pub project_root: String,
    pub database_path: String,
    pub mcp_config_path: Option<String>,
    pub crush_config_path: Option<String>,
    pub runtime_entrypoint: Option<String>,
    /// Absolute `node` whose ABI matches the bundled addon; Codex `-c` overrides
    /// use this so they cannot fall back to a bare `node` on PATH.
    pub mcp_command: Option<String>,
    /// The environment the Auric MCP server gets (`crate::mcp::agent_mcp_server_env`).
    /// Config-file providers carry it in the file; Codex, configured on the
    /// command line, gets it as an inline table.
    pub mcp_env: BTreeMap<String, String>,
    pub connectors: Vec<crate::connectors::ResolvedConnector>,
}

impl ProviderProjectBinding {
    pub fn new(project_root: impl Into<String>, database_path: impl Into<String>) -> Self {
        Self {
            project_root: project_root.into(),
            database_path: database_path.into(),
            mcp_config_path: None,
            crush_config_path: None,
            runtime_entrypoint: None,
            mcp_command: None,
            mcp_env: BTreeMap::new(),
            connectors: Vec::new(),
        }
    }

    pub fn with_mcp_env(mut self, env: BTreeMap<String, String>) -> Self {
        self.mcp_env = env;
        self
    }

    pub fn with_mcp_config_path(mut self, path: impl Into<String>) -> Self {
        self.mcp_config_path = Some(path.into());
        self
    }

    pub fn with_runtime_entrypoint(mut self, path: impl Into<String>) -> Self {
        self.runtime_entrypoint = Some(path.into());
        self
    }

    pub fn with_mcp_command(mut self, command: impl Into<String>) -> Self {
        self.mcp_command = Some(command.into());
        self
    }

    pub fn with_crush_config_path(mut self, path: impl Into<String>) -> Self {
        self.crush_config_path = Some(path.into());
        self
    }
}

pub fn shell_quote_argument(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

/// Renders an untrusted value as exactly one inert shell word.
///
/// Spawn commands run through `sh -c` / `zsh -c`, and values such as the model
/// name come straight from MCP callers. A value made only of characters that
/// no POSIX shell treats specially is left as is, so ordinary model ids read
/// the same as before (`--model opus`); anything else is single-quoted, which
/// disables every expansion, separator and line break inside it.
pub fn shell_word(value: &str) -> String {
    let plain = !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._:/@%+=,-".contains(c));
    if plain {
        value.to_string()
    } else {
        shell_quote_argument(value)
    }
}

/// A TOML inline table of strings. Keys and values are written as JSON
/// strings, which are valid TOML basic strings (same quote and backslash
/// escapes, control characters as `\uXXXX`), so no value can close the table
/// or start another key.
pub fn toml_inline_table(entries: &BTreeMap<String, String>) -> Result<String, String> {
    let pairs = entries
        .iter()
        .map(|(key, value)| {
            let key = serde_json::to_string(key).map_err(|error| error.to_string())?;
            let value = serde_json::to_string(value).map_err(|error| error.to_string())?;
            Ok(format!("{key}={value}"))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(format!("{{{}}}", pairs.join(",")))
}

/// Codex accepts configuration overrides for one invocation. This keeps the
/// Auric server out of the user's global config and pins the session to one
/// packaged runtime and one canonical project root.
pub fn codex_project_binding_injection(
    binding: &ProviderProjectBinding,
) -> Result<SpawnInjection, String> {
    let runtime = binding
        .runtime_entrypoint
        .as_deref()
        .ok_or_else(|| "Codex MCP binding is missing the runtime entrypoint".to_string())?;
    let runtime = serde_json::to_string(runtime).map_err(|error| error.to_string())?;
    let command = serde_json::to_string(binding.mcp_command.as_deref().unwrap_or("node"))
        .map_err(|error| error.to_string())?;
    let project =
        serde_json::to_string(&binding.project_root).map_err(|error| error.to_string())?;
    let args = format!("mcp_servers.auric-pm.args=[{runtime},\"--project-root\",{project}]");
    let mut arguments = vec![
        "-c".to_string(),
        shell_quote_argument(&format!("mcp_servers.auric-pm.command={command}")),
        "-c".to_string(),
        shell_quote_argument(&args),
        "-c".to_string(),
        shell_quote_argument("mcp_servers.auric-pm.required=true"),
        // `codex exec` runs with `approval: never`, so a tool call that needs
        // approval is refused rather than asked — and conductor agents report
        // back through exactly the write tools. The server is ours and bound to
        // this one project, so it is approved as a whole.
        "-c".to_string(),
        shell_quote_argument("mcp_servers.auric-pm.default_tools_approval_mode=\"approve\""),
    ];
    if !binding.mcp_env.is_empty() {
        arguments.push("-c".to_string());
        arguments.push(shell_quote_argument(&format!(
            "mcp_servers.auric-pm.env={}",
            toml_inline_table(&binding.mcp_env)?
        )));
    }
    for connector in &binding.connectors {
        let prefix = format!("mcp_servers.{}", connector.server_name());
        let settings = [
            (
                "command",
                serde_json::to_string(&connector.command).map_err(|e| e.to_string())?,
            ),
            (
                "args",
                serde_json::to_string(&connector.args).map_err(|e| e.to_string())?,
            ),
            ("env", toml_inline_table(&connector.env)?),
            (
                "enabled_tools",
                serde_json::to_string(&connector.allowed_tools).map_err(|e| e.to_string())?,
            ),
            (
                "startup_timeout_sec",
                connector.startup_timeout_s.to_string(),
            ),
            ("enabled", "true".into()),
        ];
        for (key, value) in settings {
            arguments.push("-c".into());
            arguments.push(shell_quote_argument(&format!("{prefix}.{key}={value}")));
        }
    }
    Ok(SpawnInjection {
        arguments,
        env_vars: Vec::new(),
    })
}

/// Claude exposes an inventory denylist, unlike Codex/Crush's per-server allowlist.
/// Undeclared tools remain outside this filter; this is not a call broker.
pub fn connector_tool_filter_injection(
    provider_id: &str,
    connectors: &[crate::connectors::ResolvedConnector],
) -> SpawnInjection {
    if provider_id != "claude" {
        return SpawnInjection::default();
    }
    let denied: Vec<String> = connectors
        .iter()
        .flat_map(|connector| {
            connector
                .denied_tools
                .iter()
                .map(|tool| format!("mcp__{}__{tool}", connector.server_name()))
        })
        .collect();
    if denied.is_empty() {
        return SpawnInjection::default();
    }
    SpawnInjection {
        arguments: vec![
            "--disallowedTools".into(),
            shell_quote_argument(&denied.join(",")),
        ],
        env_vars: vec![],
    }
}

/// The provider's launch material for one isolated Auric MCP project, which
/// may be empty when the provider declares no project binding.
pub fn project_binding_material(
    provider_id: &str,
    provider: &dyn AgentProvider,
    binding: &ProviderProjectBinding,
) -> Result<SpawnInjection, String> {
    if provider_id == "codex" {
        codex_project_binding_injection(binding)
    } else {
        Ok(provider.project_binding_injection(binding))
    }
}

/// The launch material that binds `provider` to one isolated Auric MCP
/// project, or the refusal when it has none. Strict: `allowUnboundMcp` is not
/// considered here, only at spawn (`agents::manager::bind_to_project_mcp`).
pub fn project_binding_injection_for(
    provider_id: &str,
    provider: &dyn AgentProvider,
    binding: &ProviderProjectBinding,
) -> Result<SpawnInjection, String> {
    crate::agents::manager::binding_injection_for(
        provider_id,
        project_binding_material(provider_id, provider, binding)?,
        false,
    )
}

/// Whether a project-bound spawn of `provider` can succeed at all: the same
/// decision `project_binding_injection_for` makes at spawn, taken against a
/// binding with every path filled in. `list_agent_providers` offers only these.
pub fn supports_isolated_mcp_binding(provider_id: &str, provider: &dyn AgentProvider) -> bool {
    let probe = ProviderProjectBinding::new("/project", "/project/.auric/project.db")
        .with_mcp_config_path("/agent-bindings/project.mcp.json")
        .with_crush_config_path("/agent-bindings/project.crush.json")
        .with_runtime_entrypoint("/runtime/server.mjs");
    project_binding_injection_for(provider_id, provider, &probe).is_ok()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionCheck {
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PromptTemplate {
    pub template: String,
}

// ── AgentProvider trait ──────────────────────────────────────────────

pub trait AgentProvider: Send + Sync {
    fn info(&self) -> ProviderInfo;

    fn build_spawn_command(
        &self,
        model: &str,
        task: &str,
        permission_mode: Option<&str>,
        dangerously_ignore_permissions: bool,
        auto_accept_edits: bool,
        headless: bool,
    ) -> SpawnCommand;

    fn version_check(&self) -> VersionCheck;

    fn prompt_template(&self) -> PromptTemplate;

    fn project_binding_injection(&self, _binding: &ProviderProjectBinding) -> SpawnInjection {
        SpawnInjection::default()
    }

    fn allows_unbound_mcp(&self) -> bool {
        false
    }

    /// How this provider's runs are measured, `None` when they are not.
    fn usage_config(&self) -> Option<UsageConfig> {
        None
    }

    /// Extra writable paths when this provider's agents must run under
    /// AuricIDE's write sandbox for the resolved permission mode, `None` when
    /// they run unconfined. See `agents::write_sandbox`.
    fn write_sandbox(
        &self,
        _permission_mode: Option<&str>,
        _dangerously_ignore_permissions: bool,
        _auto_accept_edits: bool,
    ) -> Option<Vec<String>> {
        None
    }
}

// ── DynamicProvider Configuration ────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ArgumentConfig {
    Literal {
        value: String,
    },
    #[serde(rename_all = "camelCase")]
    Model {
        flag: String,
        ignore_if_auto: bool,
    },
    #[serde(rename_all = "camelCase")]
    Task {
        /// Still required so existing configs keep parsing; the task is
        /// always passed as one quoted argument (see `DynamicProvider`).
        #[allow(dead_code)]
        quote: bool,
    },
    #[serde(rename_all = "camelCase")]
    Headless {
        flag: String,
        interactive_flag: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Permission {
        map: HashMap<String, String>,
        fallback: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigInfo {
    pub models: Vec<ModelOption>,
    pub permission_modes: Vec<PermissionModeOption>,
    pub default_model: String,
    pub default_permission_mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBindingInjectionConfig {
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteSandboxConfig {
    /// Paths beyond the workspace the CLI itself has to write (its own state,
    /// its login). `~/` is the user's home.
    #[serde(default)]
    pub writable: Vec<String>,
    /// Permission modes that deliberately run without guardrails.
    #[serde(default)]
    pub exempt_permission_modes: Vec<String>,
}

/// How a provider's runs are measured (`usage` in the provider config).
/// Absent means no capture: the run still gets a row, without tokens or cost.
/// Parsed strictly: a misspelt key fails the file rather than turning capture
/// off unnoticed.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UsageConfig {
    pub result: Option<ResultUsageConfig>,
    pub transcript: Option<TranscriptUsageConfig>,
}

/// The CLI prints its own accounting when a headless run ends.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultUsageConfig {
    pub format: ResultFormat,
    /// Appended to the command of headless launches only.
    #[serde(default)]
    pub headless_args: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum ResultFormat {
    #[serde(rename = "claude-json")]
    ClaudeJson,
}

/// The session file the CLI writes, read after the run.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranscriptUsageConfig {
    pub format: TranscriptFormat,
    /// Flag that takes a session id; each spawn passes a fresh UUID v4.
    #[serde(default)]
    pub session_id_flag: Option<String>,
    #[serde(default)]
    pub session_id_from: Option<SessionIdFrom>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum TranscriptFormat {
    #[serde(rename = "claude-jsonl")]
    ClaudeJsonl,
    #[serde(rename = "codex-rollout")]
    CodexRollout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum SessionIdFrom {
    #[serde(rename = "output")]
    Output,
}

/// How to refresh `info.models` from the provider CLI at runtime.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsDiscoveryConfig {
    /// Executable to run. Empty when `format` reads a file (Codex cache).
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub format: ModelsDiscoveryFormat,
    /// How long a successful discovery may be reused. Defaults to one hour.
    #[serde(default = "default_models_cache_seconds")]
    pub cache_seconds: u64,
}

fn default_models_cache_seconds() -> u64 {
    3600
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModelsDiscoveryFormat {
    /// `id\\tlabel` per line (`agy models`).
    TsvIdLabel,
    /// Bullet list under "Available models:" (`grok models`).
    GrokBullet,
    /// `~/.codex/models_cache.json`, `visibility: "list"` only.
    CodexCache,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub arguments: Vec<ArgumentConfig>,
    #[serde(default)]
    pub project_binding: Option<ProjectBindingInjectionConfig>,
    /// Lets a provider start without an isolated Auric MCP binding when its CLI
    /// has no per-launch way to receive one. Its tools then use whatever MCP
    /// config the CLI discovers itself. Off unless the config says so.
    #[serde(default)]
    pub allow_unbound_mcp: bool,
    /// Runs the agent under AuricIDE's write sandbox: it may write inside its
    /// workspace and nowhere else on the machine. For CLIs whose own sandbox
    /// is missing or too coarse to leave the workspace writable.
    #[serde(default)]
    pub write_sandbox: Option<WriteSandboxConfig>,
    /// How this provider's runs are measured; see [`UsageConfig`].
    #[serde(default)]
    pub usage: Option<UsageConfig>,
    /// Optional live model list. When absent, known provider ids still get a
    /// built-in discovery (`model_catalog::builtin_discovery`).
    #[serde(default)]
    pub models_discovery: Option<ModelsDiscoveryConfig>,
    pub info: ProviderConfigInfo,
    pub version_check: VersionCheck,
    pub prompt_template: String,
}

// ── Shell escaping ──────────────────────────────────────────────────

/// Escape a string for use inside double quotes in zsh/bash.
/// Handles all characters that are special inside double quotes:
/// `\`, `"`, `` ` ``, `$`, and `!` (zsh history expansion).
pub fn shell_escape_double_quoted(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('`', "\\`")
        .replace('$', "\\$")
        .replace('!', "\\!")
}
