use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;

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
enum ArgumentConfig {
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
struct ProviderConfigInfo {
    models: Vec<ModelOption>,
    permission_modes: Vec<PermissionModeOption>,
    default_model: String,
    default_permission_mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderConfig {
    id: String,
    name: String,
    executable: String,
    arguments: Vec<ArgumentConfig>,
    info: ProviderConfigInfo,
    version_check: VersionCheck,
    prompt_template: String,
}

// ── Shell escaping ──────────────────────────────────────────────────

/// Escape a string for use inside double quotes in zsh/bash.
/// Handles all characters that are special inside double quotes:
/// `\`, `"`, `` ` ``, `$`, and `!` (zsh history expansion).
fn shell_escape_double_quoted(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('`', "\\`")
        .replace('$', "\\$")
        .replace('!', "\\!")
}

// ── DynamicProvider ──────────────────────────────────────────────────

pub struct DynamicProvider {
    config: ProviderConfig,
}

impl DynamicProvider {
    pub(crate) fn new(config: ProviderConfig) -> Self {
        Self { config }
    }
}

impl AgentProvider for DynamicProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: self.config.id.clone(),
            name: self.config.name.clone(),
            models: self.config.info.models.clone(),
            permission_modes: self.config.info.permission_modes.clone(),
            default_model: self.config.info.default_model.clone(),
            default_permission_mode: self.config.info.default_permission_mode.clone(),
        }
    }

    fn build_spawn_command(
        &self,
        model: &str,
        task: &str,
        permission_mode: Option<&str>,
        dangerously_ignore_permissions: bool,
        auto_accept_edits: bool,
        headless: bool,
    ) -> SpawnCommand {
        let mut cmd_parts = Vec::new();
        cmd_parts.push(self.config.executable.clone());

        for arg in &self.config.arguments {
            match arg {
                ArgumentConfig::Literal { value } => {
                    cmd_parts.push(value.clone());
                }
                ArgumentConfig::Model {
                    flag,
                    ignore_if_auto,
                } => {
                    if model == "auto" && *ignore_if_auto {
                        continue;
                    }
                    if !flag.is_empty() {
                        cmd_parts.push(flag.clone());
                    }
                    cmd_parts.push(model.to_string());
                }
                ArgumentConfig::Task { quote } => {
                    let escaped_task = shell_escape_double_quoted(task);
                    if *quote {
                        cmd_parts.push(format!("\"{}\"", escaped_task));
                    } else {
                        cmd_parts.push(escaped_task);
                    }
                }
                ArgumentConfig::Headless {
                    flag,
                    interactive_flag,
                } => {
                    if headless {
                        cmd_parts.push(flag.clone());
                    } else if let Some(interactive) = interactive_flag {
                        cmd_parts.push(interactive.clone());
                    }
                }
                ArgumentConfig::Permission { map, fallback } => {
                    let mode_key = if let Some(m) = permission_mode {
                        m.to_string()
                    } else {
                        // Legacy mapping
                        if dangerously_ignore_permissions {
                            "bypassPermissions".to_string()
                        } else if auto_accept_edits {
                            "acceptEdits".to_string()
                        } else {
                            "default".to_string()
                        }
                    };

                    let flag_val = map
                        .get(&mode_key)
                        .cloned()
                        .or(fallback.clone())
                        .unwrap_or_default();

                    if !flag_val.is_empty() {
                        cmd_parts.push(flag_val);
                    }
                }
            }
        }

        SpawnCommand {
            command: cmd_parts.join(" "),
            env_vars: vec![],
        }
    }

    fn version_check(&self) -> VersionCheck {
        self.config.version_check.clone()
    }

    fn prompt_template(&self) -> PromptTemplate {
        PromptTemplate {
            template: self.config.prompt_template.clone(),
        }
    }
}

// ── CrushProvider ──────────────────────────────────────────────────

pub struct CrushProvider;

impl AgentProvider for CrushProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: "crush".to_string(),
            name: "Crush".to_string(),
            models: vec![
                ModelOption {
                    value: "auto".to_string(),
                    label: "Auto / Default".to_string(),
                },
                ModelOption {
                    value: "moonshotai/kimi-k2-thinking".to_string(),
                    label: "Moonshot Kimi k2 Thinking".to_string(),
                },
            ],
            permission_modes: vec![
                PermissionModeOption {
                    value: "yolo".to_string(),
                    label: "YOLO (Autonomous)".to_string(),
                    description: "Skip all permission prompts (--yolo)".to_string(),
                },
                PermissionModeOption {
                    value: "default".to_string(),
                    label: "Interactive".to_string(),
                    description: "Ask for permissions".to_string(),
                },
            ],
            default_model: "auto".to_string(),
            default_permission_mode: "default".to_string(),
        }
    }

    fn build_spawn_command(
        &self,
        model: &str,
        task: &str,
        permission_mode: Option<&str>,
        _dangerously_ignore_permissions: bool,
        _auto_accept_edits: bool,
        _headless: bool,
    ) -> SpawnCommand {
        let escaped_task = shell_escape_double_quoted(task);

        let mut cmd = "crush".to_string();

        if model != "auto" {
            cmd.push_str(&format!(" --model {}", model));
        }

        if let Some(mode) = permission_mode {
            if mode == "yolo" || mode == "bypassPermissions" {
                cmd.push_str(" --yolo");
            }
        }

        cmd.push_str(&format!(" \"{}\"", escaped_task));

        SpawnCommand {
            command: cmd,
            env_vars: vec![],
        }
    }

    fn version_check(&self) -> VersionCheck {
        VersionCheck {
            command: "crush".to_string(),
            args: vec!["--version".to_string()],
        }
    }

    fn prompt_template(&self) -> PromptTemplate {
        PromptTemplate {
            template: "crush \"".to_string(),
        }
    }
}

// ── ProviderRegistry ────────────────────────────────────────────────

pub struct ProviderRegistry {
    providers: HashMap<String, Arc<dyn AgentProvider>>,
    default_id: String,
}

impl ProviderRegistry {
    pub fn new(app: Option<&tauri::AppHandle>) -> Self {
        let mut providers: HashMap<String, Arc<dyn AgentProvider>> = HashMap::new();

        // Add Crush as fallback/default if no others are present (or keep it always)
        providers.insert("crush".to_string(), Arc::new(CrushProvider));

        // Load Dynamic Providers
        let mut search_paths = vec![
            PathBuf::from("dynamic-providers"),
            PathBuf::from("../dynamic-providers"),
        ];

        if let Some(app) = app {
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                search_paths.push(app_data_dir.join("dynamic-providers"));
            }
            if let Ok(resource_dir) = app.path().resource_dir() {
                search_paths.push(resource_dir.join("dynamic-providers"));
            }
        }

        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                search_paths.push(exe_dir.join("dynamic-providers"));
            }
        }

        for dynamic_dir in search_paths {
            if dynamic_dir.exists() && dynamic_dir.is_dir() {
                if let Ok(entries) = fs::read_dir(&dynamic_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.extension().and_then(|s| s.to_str()) == Some("json") {
                            if let Ok(content) = fs::read_to_string(&path) {
                                match serde_json::from_str::<ProviderConfig>(&content) {
                                    Ok(config) => {
                                        let id = config.id.clone();
                                        providers
                                            .insert(id, Arc::new(DynamicProvider::new(config)));
                                    }
                                    Err(e) => eprintln!(
                                        "Failed to parse provider config {:?}: {}",
                                        path, e
                                    ),
                                }
                            }
                        }
                    }
                }
            }
        }

        // Determine default ID. First dynamic provider we find? Or claude?
        // Usually, pick the first dynamic one, or fallback to crush.
        let default_id = if providers.contains_key("claude") {
            "claude".to_string()
        } else if providers.len() > 1 {
            // Find any key that isn't crush
            providers
                .keys()
                .find(|&k| k != "crush")
                .cloned()
                .unwrap_or_else(|| "crush".to_string())
        } else {
            "crush".to_string()
        };

        Self {
            providers,
            default_id,
        }
    }

    pub fn get(&self, id: &str) -> Option<&Arc<dyn AgentProvider>> {
        self.providers.get(id)
    }

    pub fn default_provider(&self) -> &Arc<dyn AgentProvider> {
        self.providers
            .get(&self.default_id)
            .expect("default provider must exist")
    }

    pub fn list_providers(&self) -> Vec<ProviderInfo> {
        let mut infos: Vec<ProviderInfo> = self.providers.values().map(|p| p.info()).collect();
        infos.sort_by(|a, b| {
            if a.id == self.default_id {
                std::cmp::Ordering::Less
            } else if b.id == self.default_id {
                std::cmp::Ordering::Greater
            } else {
                a.id.cmp(&b.id)
            }
        });
        infos
    }
}

pub type ProviderRegistryState = Arc<ProviderRegistry>;

pub fn new_provider_registry(app: Option<&tauri::AppHandle>) -> ProviderRegistryState {
    Arc::new(ProviderRegistry::new(app))
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Dynamic Provider Tests (Claude Emulation) ─────────────────────

    fn get_claude_config() -> ProviderConfig {
        let json = r#"{
          "id": "claude",
          "name": "Claude Code",
          "executable": "claude",
          "arguments": [
            { "type": "model", "flag": "--model", "ignoreIfAuto": true },
            { "type": "headless", "flag": "-p" },
            { "type": "task", "quote": true },
            { "type": "permission", "map": { 
                "bypassPermissions": "--permission-mode bypassPermissions",
                "acceptEdits": "--permission-mode acceptEdits",
                "plan": "--permission-mode plan"
              },
              "fallback": ""
            }
          ],
          "info": {
            "models": [],
            "permissionModes": [],
            "defaultModel": "sonnet",
            "defaultPermissionMode": "acceptEdits"
          },
          "versionCheck": { "command": "claude", "args": ["--version"] },
          "promptTemplate": "claude --model sonnet -p \""
        }"#;
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn test_dynamic_claude_interactive_auto() {
        let provider = DynamicProvider::new(get_claude_config());
        // claude "task"
        let cmd = provider.build_spawn_command("auto", "task", None, false, false, false);
        assert_eq!(cmd.command, "claude \"task\"");
    }

    #[test]
    fn test_dynamic_claude_headless_model() {
        let provider = DynamicProvider::new(get_claude_config());
        // claude --model opus -p "task"
        let cmd = provider.build_spawn_command("opus", "task", None, false, false, true);
        assert_eq!(cmd.command, "claude --model opus -p \"task\"");
    }

    #[test]
    fn test_dynamic_claude_permission() {
        let provider = DynamicProvider::new(get_claude_config());
        // claude --model sonnet "task" --permission-mode plan
        let cmd = provider.build_spawn_command("sonnet", "task", Some("plan"), false, false, false);
        assert_eq!(
            cmd.command,
            "claude --model sonnet \"task\" --permission-mode plan"
        );
    }

    // ── Dynamic Provider Tests (Gemini Emulation) ─────────────────────

    fn get_gemini_config() -> ProviderConfig {
        let json = r#"{
          "id": "gemini",
          "name": "Gemini CLI",
          "executable": "gemini",
          "arguments": [
            { "type": "headless", "flag": "-p", "interactiveFlag": "-i" },
            { "type": "task", "quote": true },
            { "type": "model", "flag": "--model", "ignoreIfAuto": true },
            { "type": "permission", "map": { 
                "bypassPermissions": "",
                "default": "--sandbox" 
              },
              "fallback": "--sandbox"
            }
          ],
          "info": {
            "models": [],
            "permissionModes": [],
            "defaultModel": "auto",
            "defaultPermissionMode": "acceptEdits"
          },
          "versionCheck": { "command": "gemini", "args": ["--version"] },
          "promptTemplate": "gemini --model gemini-2.5-flash -p \""
        }"#;
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn test_dynamic_gemini_interactive_auto() {
        let provider = DynamicProvider::new(get_gemini_config());
        // gemini -i "task" --sandbox (default fallback)
        // Wait, permission_mode None -> fallback logic
        let cmd = provider.build_spawn_command("auto", "task", None, false, false, false);
        assert_eq!(cmd.command, "gemini -i \"task\" --sandbox");
    }

    #[test]
    fn test_dynamic_gemini_headless_model() {
        let provider = DynamicProvider::new(get_gemini_config());
        // gemini -p "task" --model gemini-2.5-pro --sandbox
        let cmd = provider.build_spawn_command("gemini-2.5-pro", "task", None, false, false, true);
        assert_eq!(
            cmd.command,
            "gemini -p \"task\" --model gemini-2.5-pro --sandbox"
        );
    }

    // ── CrushProvider Tests ────────────────────────────────────────────

    #[test]
    fn test_crush_permission_bypass_maps_to_yolo() {
        let provider = CrushProvider;
        let cmd = provider.build_spawn_command(
            "auto",
            "do it",
            Some("bypassPermissions"),
            false,
            false,
            false,
        );
        assert!(
            cmd.command.contains("--yolo"),
            "Expected --yolo in command: {}",
            cmd.command
        );
    }

    #[test]
    fn test_crush_permission_yolo_maps_to_yolo() {
        let provider = CrushProvider;
        let cmd = provider.build_spawn_command("auto", "do it", Some("yolo"), false, false, false);
        assert!(
            cmd.command.contains("--yolo"),
            "Expected --yolo in command: {}",
            cmd.command
        );
    }

    #[test]
    fn test_shell_escape_backticks_and_parens() {
        let provider = DynamicProvider::new(get_claude_config());
        let task = "Call `list_epics()` then `create_epic({ name })` ok";
        let cmd = provider.build_spawn_command("sonnet", task, None, false, false, true);
        assert_eq!(
            cmd.command,
            "claude --model sonnet -p \"Call \\`list_epics()\\` then \\`create_epic({ name })\\` ok\""
        );
    }

    #[test]
    fn test_shell_escape_backslash_and_dollar() {
        let provider = DynamicProvider::new(get_claude_config());
        let task = r#"path C:\Users and $HOME with "quotes""#;
        let cmd = provider.build_spawn_command("auto", task, None, false, false, true);
        assert_eq!(
            cmd.command,
            r#"claude -p "path C:\\Users and \$HOME with \"quotes\"""#
        );
    }

    #[test]
    fn test_shell_escape_exclamation() {
        let provider = CrushProvider;
        let cmd = provider.build_spawn_command("auto", "fix this!", None, false, false, false);
        assert_eq!(cmd.command, r#"crush "fix this\!""#);
    }

    #[test]
    fn test_dynamic_gemini_bypass() {
        let provider = DynamicProvider::new(get_gemini_config());
        // gemini -i "task" --model m
        // bypass -> empty string
        let cmd = provider.build_spawn_command(
            "m",
            "task",
            Some("bypassPermissions"),
            false,
            false,
            false,
        );
        assert_eq!(cmd.command, "gemini -i \"task\" --model m");
    }
}
