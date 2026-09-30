use super::types::*;

pub struct DynamicProvider {
    config: ProviderConfig,
}

impl DynamicProvider {
    pub fn new(config: ProviderConfig) -> Self {
        Self { config }
    }

    /// The permission mode a launch runs under: the requested one, the legacy
    /// booleans, or the provider's configured default — the same key the
    /// permission argument and the write sandbox are looked up by.
    fn resolved_permission_mode(
        &self,
        permission_mode: Option<&str>,
        dangerously_ignore_permissions: bool,
        auto_accept_edits: bool,
    ) -> String {
        if let Some(mode) = permission_mode {
            mode.to_string()
        } else if dangerously_ignore_permissions {
            // Legacy mapping
            "bypassPermissions".to_string()
        } else if auto_accept_edits {
            "acceptEdits".to_string()
        } else {
            // No explicit mode requested: the provider's configured
            // defaultPermissionMode (dynamic-providers/*.json) decides.
            self.config.info.default_permission_mode.clone()
        }
    }

    fn render_binding_template(
        template: &str,
        binding: &ProviderProjectBinding,
        quote_paths: bool,
    ) -> String {
        let project_root = if quote_paths {
            format!("\"{}\"", shell_escape_double_quoted(&binding.project_root))
        } else {
            binding.project_root.clone()
        };
        let database_path = if quote_paths {
            format!("\"{}\"", shell_escape_double_quoted(&binding.database_path))
        } else {
            binding.database_path.clone()
        };
        let mcp_config_path = binding
            .mcp_config_path
            .as_deref()
            .map(|path| {
                if quote_paths {
                    format!("\"{}\"", shell_escape_double_quoted(path))
                } else {
                    path.to_string()
                }
            })
            .unwrap_or_default();

        template
            .replace("{projectRoot}", &project_root)
            .replace("{databasePath}", &database_path)
            .replace("{mcpConfigPath}", &mcp_config_path)
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
                    cmd_parts.push(shell_word(model));
                }
                // The task is untrusted text (it can come from an MCP caller),
                // so it is always one double-quoted, escaped argument. An
                // unquoted task would let `;` or a line break end the command;
                // `quote: false` is kept only so older configs still parse.
                ArgumentConfig::Task { quote: _ } => {
                    cmd_parts.push(format!("\"{}\"", shell_escape_double_quoted(task)));
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
                    let mode_key = self.resolved_permission_mode(
                        permission_mode,
                        dangerously_ignore_permissions,
                        auto_accept_edits,
                    );

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

        if headless {
            let headless_args = self
                .config
                .usage
                .as_ref()
                .and_then(|usage| usage.result.as_ref())
                .map(|result| result.headless_args.as_slice())
                .unwrap_or_default();
            cmd_parts.extend(headless_args.iter().map(|arg| shell_word(arg)));
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

    fn allows_unbound_mcp(&self) -> bool {
        self.config.allow_unbound_mcp
    }

    fn usage_config(&self) -> Option<UsageConfig> {
        self.config.usage.clone()
    }

    fn write_sandbox(
        &self,
        permission_mode: Option<&str>,
        dangerously_ignore_permissions: bool,
        auto_accept_edits: bool,
    ) -> Option<Vec<String>> {
        let sandbox = self.config.write_sandbox.as_ref()?;
        let mode = self.resolved_permission_mode(
            permission_mode,
            dangerously_ignore_permissions,
            auto_accept_edits,
        );
        if sandbox.exempt_permission_modes.contains(&mode) {
            return None;
        }
        Some(sandbox.writable.clone())
    }

    fn project_binding_injection(&self, binding: &ProviderProjectBinding) -> SpawnInjection {
        let Some(config) = &self.config.project_binding else {
            return SpawnInjection::default();
        };

        SpawnInjection {
            arguments: config
                .arguments
                .iter()
                .map(|argument| Self::render_binding_template(argument, binding, true))
                .collect(),
            env_vars: config
                .environment
                .iter()
                .map(|(key, value)| {
                    (
                        key.clone(),
                        Self::render_binding_template(value, binding, false),
                    )
                })
                .collect(),
        }
    }
}
