use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
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
                    } else if dangerously_ignore_permissions {
                        // Legacy mapping
                        "bypassPermissions".to_string()
                    } else if auto_accept_edits {
                        "acceptEdits".to_string()
                    } else {
                        // No explicit mode requested: the provider's configured
                        // defaultPermissionMode (dynamic-providers/*.json) decides.
                        self.config.info.default_permission_mode.clone()
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
            executable: self.config.executable.clone(),
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
            executable: "crush".to_string(),
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

/// The one provider compiled into the binary. Every other provider comes from a
/// user-supplied `dynamic-providers/*.json`, so this id is the fallback a fresh
/// install always has and no config file may claim it.
pub const RESERVED_PROVIDER_ID: &str = "crush";

pub struct ProviderRegistry {
    // Interior mutability so providers can be imported at runtime (the packaged
    // app ships without dynamic-providers/, so users bring their own configs).
    providers: RwLock<HashMap<String, Arc<dyn AgentProvider>>>,
    default_id: RwLock<String>,
    /// Where imported configs are persisted (app_data_dir/dynamic-providers).
    import_dir: Option<PathBuf>,
}

impl ProviderRegistry {
    pub fn new(app: Option<&tauri::AppHandle>) -> Self {
        let mut providers: HashMap<String, Arc<dyn AgentProvider>> = HashMap::new();

        // Add Crush as fallback/default if no others are present (or keep it always)
        providers.insert(RESERVED_PROVIDER_ID.to_string(), Arc::new(CrushProvider));

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

        providers.extend(Self::load_configs_from(&search_paths));

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

        let import_dir = app.and_then(|a| {
            a.path()
                .app_data_dir()
                .ok()
                .map(|d| d.join("dynamic-providers"))
        });

        Self {
            providers: RwLock::new(providers),
            default_id: RwLock::new(default_id),
            import_dir,
        }
    }

    /// Scan `dirs` for `*.json` provider configs. Later directories win over
    /// earlier ones for the same id, which is the order `new()` has always used.
    ///
    /// A file that fails to parse is reported on stderr and skipped, so one bad
    /// config never costs the user the rest of them. A config claiming the
    /// built-in id is skipped too — see `RESERVED_PROVIDER_ID`.
    fn load_configs_from(dirs: &[PathBuf]) -> HashMap<String, Arc<dyn AgentProvider>> {
        let mut loaded: HashMap<String, Arc<dyn AgentProvider>> = HashMap::new();

        for dir in dirs {
            if !dir.is_dir() {
                continue;
            }
            let Ok(entries) = fs::read_dir(dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                let Ok(content) = fs::read_to_string(&path) else {
                    continue;
                };
                match serde_json::from_str::<ProviderConfig>(&content) {
                    Ok(config) => {
                        let id = config.id.clone();
                        if id == RESERVED_PROVIDER_ID {
                            eprintln!(
                                "Ignoring {:?}: \"{}\" is a built-in provider id",
                                path, RESERVED_PROVIDER_ID
                            );
                            continue;
                        }
                        loaded.insert(id, Arc::new(DynamicProvider::new(config)));
                    }
                    Err(e) => {
                        eprintln!("Failed to parse provider config {:?}: {}", path, e)
                    }
                }
            }
        }

        loaded
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn AgentProvider>> {
        self.providers.read().unwrap().get(id).cloned()
    }

    pub fn default_provider(&self) -> Arc<dyn AgentProvider> {
        let default_id = self.default_id.read().unwrap().clone();
        let providers = self.providers.read().unwrap();
        providers
            .get(&default_id)
            .or_else(|| providers.values().next())
            .expect("registry always has at least the crush provider")
            .clone()
    }

    pub fn list_providers(&self) -> Vec<ProviderInfo> {
        let default_id = self.default_id.read().unwrap().clone();
        let providers = self.providers.read().unwrap();
        let mut infos: Vec<ProviderInfo> = providers.values().map(|p| p.info()).collect();
        infos.sort_by(|a, b| {
            if a.id == default_id {
                std::cmp::Ordering::Less
            } else if b.id == default_id {
                std::cmp::Ordering::Greater
            } else {
                a.id.cmp(&b.id)
            }
        });
        infos
    }

    /// Import a dynamic provider config at runtime: validate JSON, persist it to
    /// the import dir, and register it live. Returns the imported provider's info.
    pub fn import_provider(&self, json: &str) -> Result<ProviderInfo, String> {
        let config: ProviderConfig =
            serde_json::from_str(json).map_err(|e| format!("Invalid provider config: {}", e))?;
        let id = config.id.trim().to_string();
        if id.is_empty() {
            return Err("Provider config is missing an \"id\"".to_string());
        }
        if id == RESERVED_PROVIDER_ID {
            return Err(format!(
                "\"{}\" is a built-in provider id and cannot be overwritten",
                RESERVED_PROVIDER_ID
            ));
        }

        // Persist so the import survives a restart.
        if let Some(dir) = &self.import_dir {
            fs::create_dir_all(dir).map_err(|e| format!("Could not create provider dir: {}", e))?;
            fs::write(dir.join(format!("{}.json", id)), json)
                .map_err(|e| format!("Could not save provider: {}", e))?;
        }

        let provider = Arc::new(DynamicProvider::new(config));
        let info = provider.info();
        self.providers.write().unwrap().insert(id.clone(), provider);
        // A freshly-imported claude becomes the default (matches startup logic).
        if id == "claude" {
            *self.default_id.write().unwrap() = "claude".to_string();
        }
        Ok(info)
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
                "auto": "--permission-mode auto",
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

    // ── Splicing a flag in behind the executable ──────────────────────

    #[test]
    fn a_flag_lands_between_the_executable_and_the_providers_own_arguments() {
        let provider = DynamicProvider::new(get_claude_config());
        let cmd = provider
            .build_spawn_command("sonnet", "task", Some("auto"), false, false, false)
            .with_flag_after_executable("--settings", "/tmp/s.json");
        assert_eq!(
            cmd.command,
            "claude --settings \"/tmp/s.json\" --model sonnet \"task\" --permission-mode auto"
        );
    }

    #[test]
    fn a_multi_word_executable_keeps_its_own_arguments_together() {
        // `"executable": "npx -y @anthropic-ai/claude-code"` is a shape the
        // config format allows. Inserting after the first *word* would produce
        // `npx --settings ... -y @anthropic-ai/claude-code` and break the run.
        let mut config = get_claude_config();
        config.executable = "npx -y @anthropic-ai/claude-code".to_string();
        let cmd = DynamicProvider::new(config)
            .build_spawn_command("auto", "task", Some("default"), false, false, false)
            .with_flag_after_executable("--settings", "/tmp/s.json");
        assert_eq!(
            cmd.command,
            "npx -y @anthropic-ai/claude-code --settings \"/tmp/s.json\" \"task\""
        );
    }

    #[test]
    fn a_spliced_value_is_escaped_for_the_double_quotes_it_lands_in() {
        let provider = DynamicProvider::new(get_claude_config());
        let cmd = provider
            .build_spawn_command("auto", "task", Some("default"), false, false, false)
            .with_flag_after_executable("--settings", "/Users/a$b!/Application Support/s.json");
        assert!(
            cmd.command
                .contains(r#""/Users/a\$b\!/Application Support/s.json""#),
            "{}",
            cmd.command
        );
    }

    #[test]
    fn splicing_does_not_reflow_whitespace_inside_the_task() {
        // The task is embedded in this string. Splitting the command into
        // words and rejoining it would quietly rewrite the user's prompt.
        let provider = DynamicProvider::new(get_claude_config());
        let cmd = provider
            .build_spawn_command("auto", "two  spaces", Some("default"), false, false, false)
            .with_flag_after_executable("--settings", "/tmp/s.json");
        assert!(cmd.command.contains("\"two  spaces\""), "{}", cmd.command);
    }

    #[test]
    fn test_dynamic_claude_interactive_auto() {
        let provider = DynamicProvider::new(get_claude_config());
        // claude "task" (explicit interactive mode maps to no flag)
        let cmd =
            provider.build_spawn_command("auto", "task", Some("default"), false, false, false);
        assert_eq!(cmd.command, "claude \"task\"");
    }

    #[test]
    fn test_dynamic_claude_headless_model() {
        let provider = DynamicProvider::new(get_claude_config());
        // claude --model opus -p "task"
        let cmd = provider.build_spawn_command("opus", "task", Some("default"), false, false, true);
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

    fn empty_registry() -> ProviderRegistry {
        let mut providers: HashMap<String, Arc<dyn AgentProvider>> = HashMap::new();
        providers.insert("crush".to_string(), Arc::new(CrushProvider));
        ProviderRegistry {
            providers: RwLock::new(providers),
            default_id: RwLock::new("crush".to_string()),
            import_dir: None, // no persistence in tests
        }
    }

    #[test]
    fn test_import_provider_registers_and_lists_it() {
        let registry = empty_registry();
        assert!(registry.get("claude").is_none());

        let json = r#"{
            "id": "claude", "name": "Claude Code", "executable": "claude",
            "arguments": [{ "type": "task", "quote": true }],
            "info": { "models": [], "permissionModes": [], "defaultModel": "sonnet", "defaultPermissionMode": "acceptEdits" },
            "versionCheck": { "command": "claude", "args": ["--version"] },
            "promptTemplate": "claude -p \""
        }"#;
        let info = registry.import_provider(json).unwrap();

        assert_eq!(info.id, "claude");
        assert!(registry.get("claude").is_some());
        assert!(registry.list_providers().iter().any(|p| p.id == "claude"));
        // A freshly-imported claude becomes the default.
        assert_eq!(registry.default_provider().info().id, "claude");
    }

    #[test]
    fn test_import_provider_rejects_invalid_json() {
        let registry = empty_registry();
        let err = registry.import_provider("{ not valid").unwrap_err();
        assert!(err.contains("Invalid provider config"));
    }

    #[test]
    fn test_import_provider_rejects_crush_id() {
        let registry = empty_registry();
        let json = r#"{"id":"crush","name":"x","executable":"x","arguments":[],
            "info":{"models":[],"permissionModes":[],"defaultModel":"","defaultPermissionMode":""},
            "versionCheck":{"command":"x","args":[]},"promptTemplate":""}"#;
        let err = registry.import_provider(json).unwrap_err();
        assert!(err.contains("crush"));
    }

    #[test]
    fn test_dynamic_claude_auto_permission_mode() {
        let provider = DynamicProvider::new(get_claude_config());
        // Claude Code's explicit auto mode is distinct from bypassPermissions.
        let cmd = provider.build_spawn_command("sonnet", "task", Some("auto"), false, false, false);
        assert_eq!(
            cmd.command,
            "claude --model sonnet \"task\" --permission-mode auto"
        );
        assert!(!cmd.command.contains("bypassPermissions"));
    }

    #[test]
    fn test_dynamic_none_permission_falls_back_to_configured_default() {
        // No explicit mode and no legacy flags → the provider's configured
        // defaultPermissionMode from the dynamic config decides.
        let provider = DynamicProvider::new(get_claude_config());
        let cmd = provider.build_spawn_command("sonnet", "task", None, false, false, false);
        assert_eq!(
            cmd.command,
            "claude --model sonnet \"task\" --permission-mode acceptEdits"
        );
    }

    #[test]
    fn test_dynamic_legacy_flags_win_over_configured_default() {
        let provider = DynamicProvider::new(get_claude_config());
        let cmd = provider.build_spawn_command("sonnet", "task", None, true, false, false);
        assert!(
            cmd.command.contains("--permission-mode bypassPermissions"),
            "legacy dangerously_ignore_permissions must still map to bypass: {}",
            cmd.command
        );
    }

    #[test]
    fn test_dynamic_explicit_mode_wins_over_configured_default() {
        let provider = DynamicProvider::new(get_claude_config());
        let cmd = provider.build_spawn_command("sonnet", "task", Some("plan"), false, false, false);
        assert!(
            cmd.command.contains("--permission-mode plan"),
            "explicit mode must win: {}",
            cmd.command
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

    // ── Dynamic Provider Tests (Grok Emulation) ───────────────────────

    /// Mirrors dynamic-providers/grok.json. The expected command strings below
    /// were checked against a real `grok 1.0.0` install, not just its --help.
    fn get_grok_config() -> ProviderConfig {
        let json = r#"{
          "id": "grok",
          "name": "Grok CLI",
          "executable": "grok",
          "arguments": [
            { "type": "model", "flag": "--model", "ignoreIfAuto": true },
            { "type": "headless", "flag": "-p" },
            { "type": "task", "quote": true },
            { "type": "permission", "map": {
                "auto": "--permission-mode auto",
                "acceptEdits": "--permission-mode acceptEdits",
                "bypassPermissions": "--permission-mode bypassPermissions",
                "plan": "--permission-mode plan",
                "default": ""
              },
              "fallback": ""
            }
          ],
          "info": {
            "models": [],
            "permissionModes": [],
            "defaultModel": "auto",
            "defaultPermissionMode": "auto"
          },
          "versionCheck": { "command": "grok", "args": ["--version"] },
          "promptTemplate": "grok -p \""
        }"#;
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn test_dynamic_grok_interactive_auto() {
        let provider = DynamicProvider::new(get_grok_config());
        // grok "task" — the prompt is a positional argument in interactive mode.
        let cmd =
            provider.build_spawn_command("auto", "task", Some("default"), false, false, false);
        assert_eq!(cmd.command, "grok \"task\"");
    }

    #[test]
    fn test_dynamic_grok_headless_model() {
        let provider = DynamicProvider::new(get_grok_config());
        // grok --model grok-4.5 -p "task" --permission-mode auto
        let cmd =
            provider.build_spawn_command("grok-4.5", "task", Some("auto"), false, false, true);
        assert_eq!(
            cmd.command,
            "grok --model grok-4.5 -p \"task\" --permission-mode auto"
        );
    }

    #[test]
    fn test_dynamic_grok_unattended_default_is_guarded_not_bypass() {
        // Automated spawns (conductor, goal launches) pass no mode at all, so
        // the configured default decides. It must run without prompting and it
        // must not be the guardrail-free one.
        let provider = DynamicProvider::new(get_grok_config());
        let cmd = provider.build_spawn_command("auto", "task", None, false, false, true);
        assert_eq!(cmd.command, "grok -p \"task\" --permission-mode auto");
    }

    #[test]
    fn test_dynamic_grok_maps_every_offered_permission_mode() {
        let provider = DynamicProvider::new(get_grok_config());
        for (mode, expected_flag) in [
            ("acceptEdits", "--permission-mode acceptEdits"),
            ("bypassPermissions", "--permission-mode bypassPermissions"),
            ("plan", "--permission-mode plan"),
        ] {
            let cmd = provider.build_spawn_command("auto", "task", Some(mode), false, false, true);
            assert_eq!(cmd.command, format!("grok -p \"task\" {}", expected_flag));
        }
    }

    // ── Dynamic Provider Tests (Codex Emulation) ──────────────────────

    /// Mirrors dynamic-providers/codex.json. Codex splits what other CLIs call
    /// a permission mode across two flags, and `codex exec` accepts only the
    /// sandbox half — `--ask-for-approval` exists on the interactive form
    /// alone, so the shared map may never contain it. The command strings below
    /// were checked against a real `codex-cli 0.146.1` argument parser.
    fn get_codex_config() -> ProviderConfig {
        let json = r#"{
          "id": "codex",
          "name": "Codex CLI",
          "executable": "codex",
          "arguments": [
            { "type": "headless", "flag": "exec" },
            { "type": "model", "flag": "--model", "ignoreIfAuto": true },
            { "type": "task", "quote": true },
            { "type": "permission", "map": {
                "acceptEdits": "--sandbox workspace-write",
                "bypassPermissions": "--dangerously-bypass-approvals-and-sandbox",
                "plan": "--sandbox read-only",
                "default": ""
              },
              "fallback": ""
            }
          ],
          "info": {
            "models": [],
            "permissionModes": [],
            "defaultModel": "auto",
            "defaultPermissionMode": "acceptEdits"
          },
          "versionCheck": { "command": "codex", "args": ["--version"] },
          "promptTemplate": "codex exec \""
        }"#;
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn test_dynamic_codex_headless_uses_exec_subcommand() {
        let provider = DynamicProvider::new(get_codex_config());
        // The subcommand has to lead; --model and the prompt follow it.
        let cmd = provider.build_spawn_command(
            "gpt-5.6-sol",
            "task",
            Some("acceptEdits"),
            false,
            false,
            true,
        );
        assert_eq!(
            cmd.command,
            "codex exec --model gpt-5.6-sol \"task\" --sandbox workspace-write"
        );
    }

    #[test]
    fn test_dynamic_codex_interactive_drops_the_subcommand() {
        let provider = DynamicProvider::new(get_codex_config());
        let cmd = provider.build_spawn_command("auto", "task", Some("plan"), false, false, false);
        assert_eq!(cmd.command, "codex \"task\" --sandbox read-only");
    }

    #[test]
    fn test_dynamic_codex_unattended_default_sandboxes_the_workspace() {
        // Automated spawns pass no mode, so the configured default decides. It
        // must confine writes to the workspace rather than lift the sandbox.
        let provider = DynamicProvider::new(get_codex_config());
        let cmd = provider.build_spawn_command("auto", "task", None, false, false, true);
        assert_eq!(cmd.command, "codex exec \"task\" --sandbox workspace-write");
    }

    #[test]
    fn test_dynamic_codex_bypass_is_the_only_mode_without_a_sandbox() {
        let provider = DynamicProvider::new(get_codex_config());
        let cmd = provider.build_spawn_command(
            "auto",
            "task",
            Some("bypassPermissions"),
            false,
            false,
            true,
        );
        assert_eq!(
            cmd.command,
            "codex exec \"task\" --dangerously-bypass-approvals-and-sandbox"
        );
        assert!(!cmd.command.contains("--sandbox"));
    }

    #[test]
    fn test_dynamic_codex_unoffered_mode_falls_back_to_no_flag() {
        // Codex has no classifier-guarded mode, so "auto" is not offered. A
        // spawn default carried over from another provider must not silently
        // become a sandbox choice — it leaves the decision to codex's config.
        let provider = DynamicProvider::new(get_codex_config());
        let cmd = provider.build_spawn_command("auto", "task", Some("auto"), false, false, true);
        assert_eq!(cmd.command, "codex exec \"task\"");
    }

    // ── Dynamic Provider Tests (OpenCode Emulation) ────────────────────

    /// Mirrors dynamic-providers/opencode.json. Headless is the `run`
    /// subcommand; interactive uses `--prompt` so the task is not parsed as
    /// the TUI's positional project path. The command strings below were
    /// checked against a real `opencode 1.18.18` install, not just its --help.
    fn get_opencode_config() -> ProviderConfig {
        let json = r#"{
          "id": "opencode",
          "name": "OpenCode",
          "executable": "opencode",
          "arguments": [
            { "type": "headless", "flag": "run", "interactiveFlag": "--prompt" },
            { "type": "task", "quote": true },
            { "type": "model", "flag": "--model", "ignoreIfAuto": true },
            { "type": "permission", "map": {
                "auto": "--auto",
                "acceptEdits": "--auto",
                "bypassPermissions": "--auto",
                "plan": "--agent plan",
                "default": ""
              },
              "fallback": ""
            }
          ],
          "info": {
            "models": [],
            "permissionModes": [],
            "defaultModel": "auto",
            "defaultPermissionMode": "auto"
          },
          "versionCheck": { "command": "opencode", "args": ["--version"] },
          "promptTemplate": "opencode run \""
        }"#;
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn test_dynamic_opencode_headless_uses_run_subcommand() {
        let provider = DynamicProvider::new(get_opencode_config());
        // `run` has to lead so the prompt is a message, not a project path.
        let cmd = provider.build_spawn_command(
            "anthropic/claude-sonnet-4-6",
            "task",
            Some("auto"),
            false,
            false,
            true,
        );
        assert_eq!(
            cmd.command,
            "opencode run \"task\" --model anthropic/claude-sonnet-4-6 --auto"
        );
    }

    #[test]
    fn test_dynamic_opencode_interactive_uses_prompt_flag() {
        let provider = DynamicProvider::new(get_opencode_config());
        // A bare positional would be the TUI project path. --prompt owns the task.
        let cmd =
            provider.build_spawn_command("auto", "task", Some("default"), false, false, false);
        assert_eq!(cmd.command, "opencode --prompt \"task\"");
    }

    #[test]
    fn test_dynamic_opencode_unattended_default_auto_approves() {
        // Automated spawns pass no mode, so the configured default decides.
        // It must run without prompting; deny rules still apply.
        let provider = DynamicProvider::new(get_opencode_config());
        let cmd = provider.build_spawn_command("auto", "task", None, false, false, true);
        assert_eq!(cmd.command, "opencode run \"task\" --auto");
    }

    #[test]
    fn test_dynamic_opencode_plan_uses_the_plan_agent() {
        let provider = DynamicProvider::new(get_opencode_config());
        let cmd = provider.build_spawn_command("auto", "task", Some("plan"), false, false, true);
        assert_eq!(cmd.command, "opencode run \"task\" --agent plan");
        assert!(
            !cmd.command.contains("--auto"),
            "plan must not also auto-approve: {}",
            cmd.command
        );
    }

    #[test]
    fn test_dynamic_opencode_carried_modes_map_to_auto_approve() {
        // OpenCode has no accept-edits-only or lift-all-denies flag. Modes
        // carried over from another provider must still produce a runnable
        // unattended command rather than stall on a prompt.
        let provider = DynamicProvider::new(get_opencode_config());
        for mode in ["acceptEdits", "bypassPermissions"] {
            let cmd = provider.build_spawn_command("auto", "task", Some(mode), false, false, true);
            assert_eq!(cmd.command, "opencode run \"task\" --auto");
        }
    }

    #[test]
    fn test_local_opencode_config_matches_the_command_contract() {
        // dynamic-providers/*.json is local-only by design (.gitignore), so a
        // fresh clone has no file to read here. The command contract itself is
        // covered deterministically by the get_opencode_config() tests above;
        // this one only catches a hand-edited local config drifting away from
        // it, and must stay silent when there is nothing local to check.
        let path =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dynamic-providers/opencode.json");
        let Ok(content) = fs::read_to_string(&path) else {
            eprintln!("skipping: no local {}", path.display());
            return;
        };
        let provider = DynamicProvider::new(
            serde_json::from_str(&content)
                .unwrap_or_else(|e| panic!("local {} is not valid JSON: {e}", path.display())),
        );
        assert_eq!(provider.info().id, "opencode");
        let cmd = provider.build_spawn_command("auto", "task", Some("auto"), false, false, true);
        assert_eq!(cmd.command, "opencode run \"task\" --auto");
    }

    #[test]
    fn test_import_refuses_to_overwrite_the_built_in_provider() {
        let registry = ProviderRegistry {
            providers: RwLock::new(HashMap::from([(
                RESERVED_PROVIDER_ID.to_string(),
                Arc::new(CrushProvider) as Arc<dyn AgentProvider>,
            )])),
            default_id: RwLock::new(RESERVED_PROVIDER_ID.to_string()),
            import_dir: None,
        };
        let hijack = format!(
            r#"{{"id": "{}", "name": "Not Crush", "executable": "nope",
                 "arguments": [], "info": {{"models": [], "permissionModes": [],
                 "defaultModel": "auto", "defaultPermissionMode": "default"}},
                 "versionCheck": {{"command": "nope", "args": []}},
                 "promptTemplate": "nope"}}"#,
            RESERVED_PROVIDER_ID
        );

        let err = registry.import_provider(&hijack).unwrap_err();

        assert!(err.contains("built-in provider id"), "{err}");
        // The built-in must still be the one registered under that id.
        let providers = registry.providers.read().unwrap();
        assert_eq!(providers[RESERVED_PROVIDER_ID].info().name, "Crush");
    }

    #[test]
    fn test_startup_scan_refuses_to_overwrite_the_built_in_provider() {
        // Same rule as the import path: a stray crush.json in a scanned folder
        // must not replace the fallback a fresh install depends on.
        let dir = tempfile::tempdir().unwrap();
        let scanned = dir.path().join("dynamic-providers");
        fs::create_dir_all(&scanned).unwrap();
        fs::write(
            scanned.join(format!("{}.json", RESERVED_PROVIDER_ID)),
            format!(
                r#"{{"id": "{}", "name": "Not Crush", "executable": "nope",
                     "arguments": [], "info": {{"models": [], "permissionModes": [],
                     "defaultModel": "auto", "defaultPermissionMode": "default"}},
                     "versionCheck": {{"command": "nope", "args": []}},
                     "promptTemplate": "nope"}}"#,
                RESERVED_PROVIDER_ID
            ),
        )
        .unwrap();

        let loaded = ProviderRegistry::load_configs_from(&[scanned]);

        assert!(
            loaded.is_empty(),
            "a config claiming the reserved id must be skipped, got {:?}",
            loaded.keys().collect::<Vec<_>>()
        );
    }

    #[test]
    fn test_startup_scan_loads_a_normal_config() {
        // Guard against the reserved-id check swallowing everything.
        let dir = tempfile::tempdir().unwrap();
        let scanned = dir.path().join("dynamic-providers");
        fs::create_dir_all(&scanned).unwrap();
        fs::write(
            scanned.join("opencode.json"),
            r#"{"id": "opencode", "name": "OpenCode", "executable": "opencode",
                "arguments": [{ "type": "task", "quote": true }],
                "info": {"models": [], "permissionModes": [],
                         "defaultModel": "auto", "defaultPermissionMode": "auto"},
                "versionCheck": {"command": "opencode", "args": ["--version"]},
                "promptTemplate": "opencode run "}"#,
        )
        .unwrap();

        let loaded = ProviderRegistry::load_configs_from(&[scanned]);

        assert_eq!(loaded.len(), 1);
        assert!(loaded.contains_key("opencode"));
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
        let cmd = provider.build_spawn_command("sonnet", task, Some("default"), false, false, true);
        assert_eq!(
            cmd.command,
            "claude --model sonnet -p \"Call \\`list_epics()\\` then \\`create_epic({ name })\\` ok\""
        );
    }

    #[test]
    fn test_shell_escape_backslash_and_dollar() {
        let provider = DynamicProvider::new(get_claude_config());
        let task = r#"path C:\Users and $HOME with "quotes""#;
        let cmd = provider.build_spawn_command("auto", task, Some("default"), false, false, true);
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
