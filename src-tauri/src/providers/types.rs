use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub arguments: Vec<ArgumentConfig>,
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
