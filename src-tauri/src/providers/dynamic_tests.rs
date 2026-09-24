use super::*;
use std::fs;
use std::path::PathBuf;

// ── Dynamic Provider Tests (Claude Emulation) ─────────────────────

pub(crate) fn get_claude_config() -> ProviderConfig {
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
    let provider = DynamicProvider::new(get_claude_config());
    let cmd = provider
        .build_spawn_command("auto", "two  spaces", Some("default"), false, false, false)
        .with_flag_after_executable("--settings", "/tmp/s.json");
    assert!(cmd.command.contains("\"two  spaces\""), "{}", cmd.command);
}

#[test]
fn test_dynamic_claude_interactive_auto() {
    let provider = DynamicProvider::new(get_claude_config());
    let cmd = provider.build_spawn_command("auto", "task", Some("default"), false, false, false);
    assert_eq!(cmd.command, "claude \"task\"");
}

#[test]
fn test_dynamic_claude_headless_model() {
    let provider = DynamicProvider::new(get_claude_config());
    let cmd = provider.build_spawn_command("opus", "task", Some("default"), false, false, true);
    assert_eq!(cmd.command, "claude --model opus -p \"task\"");
}

#[test]
fn test_dynamic_claude_permission() {
    let provider = DynamicProvider::new(get_claude_config());
    let cmd = provider.build_spawn_command("sonnet", "task", Some("plan"), false, false, false);
    assert_eq!(
        cmd.command,
        "claude --model sonnet \"task\" --permission-mode plan"
    );
}

#[test]
fn test_dynamic_claude_auto_permission_mode() {
    let provider = DynamicProvider::new(get_claude_config());
    let cmd = provider.build_spawn_command("sonnet", "task", Some("auto"), false, false, false);
    assert_eq!(
        cmd.command,
        "claude --model sonnet \"task\" --permission-mode auto"
    );
    assert!(!cmd.command.contains("bypassPermissions"));
}

#[test]
fn test_dynamic_none_permission_falls_back_to_configured_default() {
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

#[test]
fn project_binding_injection_is_declarative_and_can_add_arguments_and_environment() {
    let json = r#"{
      "id": "mcp-aware",
      "name": "MCP-aware CLI",
      "executable": "agent-cli",
      "arguments": [{ "type": "task", "quote": true }],
      "projectBinding": {
        "arguments": ["--project", "{projectRoot}", "--database={databasePath}", "--mcp-config", "{mcpConfigPath}"],
        "environment": {
          "PROVIDER_PROJECT": "{projectRoot}",
          "PROVIDER_DATABASE": "{databasePath}"
        }
      },
      "info": {
        "models": [], "permissionModes": [],
        "defaultModel": "auto", "defaultPermissionMode": "default"
      },
      "versionCheck": { "command": "agent-cli", "args": ["--version"] },
      "promptTemplate": "agent-cli \""
    }"#;
    let provider = DynamicProvider::new(serde_json::from_str(json).unwrap());
    let binding =
        ProviderProjectBinding::new("/repo/A Project", "/repo/A Project/.auric/project.db")
            .with_mcp_config_path("/app data/project.mcp.json");
    let injection = provider.project_binding_injection(&binding);
    let cmd = provider
        .build_spawn_command("auto", "task", None, false, false, false)
        .with_injection(injection);

    assert_eq!(
        cmd.command,
        "agent-cli --project \"/repo/A Project\" --database=\"/repo/A Project/.auric/project.db\" --mcp-config \"/app data/project.mcp.json\" \"task\""
    );
    assert_eq!(
        cmd.env_vars,
        vec![
            (
                "PROVIDER_DATABASE".to_string(),
                "/repo/A Project/.auric/project.db".to_string()
            ),
            (
                "PROVIDER_PROJECT".to_string(),
                "/repo/A Project".to_string()
            ),
        ]
    );
}

#[test]
fn provider_without_project_binding_declares_no_isolated_mcp_support() {
    let provider = DynamicProvider::new(get_claude_config());
    let binding = ProviderProjectBinding::new("/project", "/project/.auric/project.db");

    assert!(provider.project_binding_injection(&binding).is_empty());
}

#[test]
fn spawn_injection_preserves_prompt_whitespace_and_overrides_duplicate_environment_keys() {
    let command = SpawnCommand {
        command: "agent-cli \"two  spaces\"".to_string(),
        env_vars: vec![("KEY".to_string(), "old".to_string())],
        executable: "agent-cli".to_string(),
    };

    let result = command.with_injection(SpawnInjection {
        arguments: vec!["--flag".to_string()],
        env_vars: vec![("KEY".to_string(), "new".to_string())],
    });

    assert_eq!(result.command, "agent-cli --flag \"two  spaces\"");
    assert_eq!(
        result.env_vars,
        vec![("KEY".to_string(), "new".to_string())]
    );
}

#[test]
fn codex_binding_uses_session_scoped_mcp_overrides_with_shell_safe_values() {
    let binding =
        ProviderProjectBinding::new("/repo/A Project", "/repo/A Project/.auric/project.db")
            .with_runtime_entrypoint("/Applications/Auric IDE/server.mjs");
    let injection = codex_project_binding_injection(&binding).unwrap();
    let command = DynamicProvider::new(get_codex_config())
        .build_spawn_command("auto", "task", Some("acceptEdits"), false, false, true)
        .with_injection(injection);

    assert!(command.command.contains("mcp_servers.auric-pm.command"));
    assert!(command
        .command
        .contains("/Applications/Auric IDE/server.mjs"));
    assert!(command.command.contains("/repo/A Project"));
    assert!(command.command.contains("required=true"));
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
    let cmd = provider.build_spawn_command("auto", "task", None, false, false, false);
    assert_eq!(cmd.command, "gemini -i \"task\" --sandbox");
}

#[test]
fn test_dynamic_gemini_headless_model() {
    let provider = DynamicProvider::new(get_gemini_config());
    let cmd = provider.build_spawn_command("gemini-2.5-pro", "task", None, false, false, true);
    assert_eq!(
        cmd.command,
        "gemini -p \"task\" --model gemini-2.5-pro --sandbox"
    );
}

#[test]
fn test_dynamic_gemini_bypass() {
    let provider = DynamicProvider::new(get_gemini_config());
    let cmd =
        provider.build_spawn_command("m", "task", Some("bypassPermissions"), false, false, false);
    assert_eq!(cmd.command, "gemini -i \"task\" --model m");
}

// ── Dynamic Provider Tests (Grok Emulation) ───────────────────────

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
    let cmd = provider.build_spawn_command("auto", "task", Some("default"), false, false, false);
    assert_eq!(cmd.command, "grok \"task\"");
}

#[test]
fn test_dynamic_grok_headless_model() {
    let provider = DynamicProvider::new(get_grok_config());
    let cmd = provider.build_spawn_command("grok-4.5", "task", Some("auto"), false, false, true);
    assert_eq!(
        cmd.command,
        "grok --model grok-4.5 -p \"task\" --permission-mode auto"
    );
}

#[test]
fn test_dynamic_grok_unattended_default_is_guarded_not_bypass() {
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
    let provider = DynamicProvider::new(get_codex_config());
    let cmd = provider.build_spawn_command("auto", "task", Some("auto"), false, false, true);
    assert_eq!(cmd.command, "codex exec \"task\"");
}

// ── Dynamic Provider Tests (OpenCode Emulation) ────────────────────

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
    let cmd = provider.build_spawn_command("auto", "task", Some("default"), false, false, false);
    assert_eq!(cmd.command, "opencode --prompt \"task\"");
}

#[test]
fn test_dynamic_opencode_unattended_default_auto_approves() {
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
    let provider = DynamicProvider::new(get_opencode_config());
    for mode in ["acceptEdits", "bypassPermissions"] {
        let cmd = provider.build_spawn_command("auto", "task", Some(mode), false, false, true);
        assert_eq!(cmd.command, "opencode run \"task\" --auto");
    }
}

#[test]
fn test_local_opencode_config_matches_the_command_contract() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dynamic-providers/opencode.json");
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
