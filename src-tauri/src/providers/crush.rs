use super::types::*;

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
