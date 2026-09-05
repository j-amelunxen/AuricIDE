use super::types::*;

pub struct DynamicProvider {
    config: ProviderConfig,
}

impl DynamicProvider {
    pub fn new(config: ProviderConfig) -> Self {
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
