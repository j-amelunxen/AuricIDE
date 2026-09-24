use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

// ── Serializable types for the frontend ──────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionModeOption {
    pub value: String,
    pub label: String,
    pub description: String,
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
}

impl ProviderProjectBinding {
    pub fn new(project_root: impl Into<String>, database_path: impl Into<String>) -> Self {
        Self {
            project_root: project_root.into(),
            database_path: database_path.into(),
            mcp_config_path: None,
            crush_config_path: None,
            runtime_entrypoint: None,
        }
    }

    pub fn with_mcp_config_path(mut self, path: impl Into<String>) -> Self {
        self.mcp_config_path = Some(path.into());
        self
    }

    pub fn with_runtime_entrypoint(mut self, path: impl Into<String>) -> Self {
        self.runtime_entrypoint = Some(path.into());
        self
    }

    pub fn with_crush_config_path(mut self, path: impl Into<String>) -> Self {
        self.crush_config_path = Some(path.into());
        self
    }
}

fn shell_quote_argument(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
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
    let project =
        serde_json::to_string(&binding.project_root).map_err(|error| error.to_string())?;
    let args = format!("mcp_servers.auric-pm.args=[{runtime},\"--project-root\",{project}]");
    Ok(SpawnInjection {
        arguments: vec![
            "-c".to_string(),
            shell_quote_argument("mcp_servers.auric-pm.command=\"node\""),
            "-c".to_string(),
            shell_quote_argument(&args),
            "-c".to_string(),
            shell_quote_argument("mcp_servers.auric-pm.required=true"),
        ],
        env_vars: Vec::new(),
    })
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub arguments: Vec<ArgumentConfig>,
    #[serde(default)]
    pub project_binding: Option<ProjectBindingInjectionConfig>,
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
