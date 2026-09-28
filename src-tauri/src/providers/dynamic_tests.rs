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

/// What `sh -c` makes of one argument: the word the CLI actually receives.
fn as_shell_sees_it(argument: &str) -> String {
    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("printf '%s' {argument}"))
        .output()
        .unwrap();
    String::from_utf8(output.stdout).unwrap()
}

#[test]
fn codex_binding_hands_the_mcp_server_its_env_as_one_quoted_toml_table() {
    let env: std::collections::BTreeMap<String, String> = [
        ("AURIC_AGENT_CWD", "/repo/it's \"here\" $(id)"),
        ("AURIC_AGENT_PROVIDERS", "claude,codex,crush"),
        ("AURIC_NOTIFICATIONS_DB", "/app data/notifications.db"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    let binding = ProviderProjectBinding::new("/repo/p", "/repo/p/.auric/project.db")
        .with_runtime_entrypoint("/rt/server.mjs")
        .with_mcp_env(env);

    let injection = codex_project_binding_injection(&binding).unwrap();
    let overrides: Vec<String> = injection
        .arguments
        .chunks(2)
        .filter(|pair| pair[0] == "-c")
        .map(|pair| as_shell_sees_it(&pair[1]))
        .collect();

    assert!(
        overrides.contains(
            &concat!(
                r#"mcp_servers.auric-pm.env={"AURIC_AGENT_CWD"="/repo/it's \"here\" $(id)","#,
                r#""AURIC_AGENT_PROVIDERS"="claude,codex,crush","#,
                r#""AURIC_NOTIFICATIONS_DB"="/app data/notifications.db"}"#
            )
            .to_string()
        ),
        "{overrides:#?}"
    );
}

#[test]
fn codex_binding_without_env_adds_no_env_override() {
    let binding = ProviderProjectBinding::new("/repo/p", "/repo/p/.auric/project.db")
        .with_runtime_entrypoint("/rt/server.mjs");
    let injection = codex_project_binding_injection(&binding).unwrap();

    assert!(!injection
        .arguments
        .iter()
        .any(|argument| argument.contains("mcp_servers.auric-pm.env")));
}

/// Review r2, point 6: `list_agent_providers` must offer only providers a
/// project-bound spawn can actually start.
#[test]
fn the_provider_list_for_mcp_leaves_out_providers_without_an_isolated_binding() {
    let registry = new_provider_registry(None);
    registry
        .import_provider(
            r#"{
              "id": "claude", "name": "Claude Code", "executable": "claude",
              "arguments": [{ "type": "task", "quote": true }],
              "projectBinding": { "arguments": ["--mcp-config", "{mcpConfigPath}", "--strict-mcp-config"] },
              "info": { "models": [], "permissionModes": [], "defaultModel": "auto", "defaultPermissionMode": "default" },
              "versionCheck": { "command": "claude", "args": ["--version"] },
              "promptTemplate": "claude \""
            }"#,
        )
        .unwrap();
    registry
        .import_provider(
            r#"{
              "id": "codex", "name": "Codex CLI", "executable": "codex",
              "arguments": [{ "type": "task", "quote": true }],
              "info": { "models": [], "permissionModes": [], "defaultModel": "auto", "defaultPermissionMode": "default" },
              "versionCheck": { "command": "codex", "args": ["--version"] },
              "promptTemplate": "codex \""
            }"#,
        )
        .unwrap();
    registry
        .import_provider(
            r#"{
              "id": "plain", "name": "No MCP binding", "executable": "plain",
              "arguments": [{ "type": "task", "quote": true }],
              "info": { "models": [], "permissionModes": [], "defaultModel": "auto", "defaultPermissionMode": "default" },
              "versionCheck": { "command": "plain", "args": ["--version"] },
              "promptTemplate": "plain \""
            }"#,
        )
        .unwrap();

    let listed = crate::mcp::agent_providers_env(&registry);
    let ids: Vec<&str> = listed.split(',').collect();

    for id in ["claude", "codex", "crush"] {
        assert!(
            ids.contains(&id),
            "{id} can be started project-bound: {listed}"
        );
    }
    assert!(!ids.contains(&"plain"), "plain cannot: {listed}");

    // The same decision the spawn takes: plain is refused there, too.
    let plain = registry.get("plain").unwrap();
    let binding = ProviderProjectBinding::new("/p", "/p/.auric/project.db")
        .with_mcp_config_path("/a/p.mcp.json")
        .with_crush_config_path("/a/p.crush.json")
        .with_runtime_entrypoint("/rt/server.mjs");
    let error = project_binding_injection_for("plain", plain.as_ref(), &binding).unwrap_err();
    assert!(error.contains("does not support an isolated Auric MCP project binding"));
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
            "auto": "--sandbox workspace-write -c approval_policy=on-request -c approvals_reviewer=auto_review",
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

// `codex exec` has no `--ask-for-approval`, so the approval policy goes in as a
// config override, which both the interactive and the headless CLI accept.
#[test]
fn test_dynamic_codex_auto_routes_approvals_through_auto_review() {
    let provider = DynamicProvider::new(get_codex_config());
    let expected = "--sandbox workspace-write -c approval_policy=on-request \
                    -c approvals_reviewer=auto_review";
    let headless = provider.build_spawn_command("auto", "task", Some("auto"), false, false, true);
    assert_eq!(headless.command, format!("codex exec \"task\" {expected}"));
    let interactive =
        provider.build_spawn_command("auto", "task", Some("auto"), false, false, false);
    assert_eq!(interactive.command, format!("codex \"task\" {expected}"));
}

#[test]
fn test_dynamic_codex_unoffered_mode_falls_back_to_no_flag() {
    let provider = DynamicProvider::new(get_codex_config());
    let cmd = provider.build_spawn_command("auto", "task", Some("yolo"), false, false, true);
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

#[test]
fn unbound_mcp_is_refused_unless_the_provider_config_opts_in() {
    let refusing = DynamicProvider::new(get_claude_config());
    assert!(!refusing.allows_unbound_mcp());

    let mut config = get_claude_config();
    config.allow_unbound_mcp = true;
    assert!(DynamicProvider::new(config).allows_unbound_mcp());
}

#[test]
fn allow_unbound_mcp_deserializes_from_camel_case() {
    let json = r#"{
      "id": "no-mcp-flag",
      "name": "CLI without an MCP flag",
      "executable": "agent-cli",
      "arguments": [{ "type": "task", "quote": true }],
      "allowUnboundMcp": true,
      "info": {
        "models": [], "permissionModes": [],
        "defaultModel": "auto", "defaultPermissionMode": "default"
      },
      "versionCheck": { "command": "agent-cli", "args": ["--version"] },
      "promptTemplate": "agent-cli \""
    }"#;
    let config: ProviderConfig = serde_json::from_str(json).unwrap();
    assert!(config.allow_unbound_mcp);
}

#[test]
fn test_local_codex_config_offers_auto_review() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dynamic-providers/codex.json");
    let Ok(content) = fs::read_to_string(&path) else {
        eprintln!("skipping: no local {}", path.display());
        return;
    };
    let provider = DynamicProvider::new(
        serde_json::from_str(&content)
            .unwrap_or_else(|e| panic!("local {} is not valid JSON: {e}", path.display())),
    );
    assert_eq!(provider.info().id, "codex");
    assert!(
        provider
            .info()
            .permission_modes
            .iter()
            .any(|m| m.value == "auto"),
        "the auto-review mode must be offered in the pickers"
    );
    let cmd = provider.build_spawn_command("auto", "task", Some("auto"), false, false, true);
    assert_eq!(
        cmd.command,
        "codex exec \"task\" --sandbox workspace-write -c approval_policy=on-request \
         -c approvals_reviewer=auto_review"
    );
}

// ── Untrusted request values never reach the shell as code ────────
//
// `model` and `task` arrive from MCP callers (request_agent_launch). The
// spawn command is run through `sh -c` / `zsh -c`, so each value has to stay
// exactly one inert argument. These tests run the built command in a real
// shell with a harmless executable and check that the payload never ran.

const INJECTION_PAYLOADS: &[&str] = &[
    "x; touch {marker} #",
    "x && touch {marker}",
    "x | touch {marker}",
    "$(touch {marker})",
    "`touch {marker}`",
    "x\ntouch {marker}",
    "x'; touch {marker}; echo '",
    "x\"; touch {marker}; echo \"",
];

fn echo_config(task_quote: bool) -> ProviderConfig {
    let json = format!(
        r#"{{
      "id": "echo",
      "name": "Echo",
      "executable": "printf '[%s]'",
      "arguments": [
        {{ "type": "model", "flag": "--model", "ignoreIfAuto": true }},
        {{ "type": "task", "quote": {task_quote} }}
      ],
      "info": {{ "models": [], "permissionModes": [], "defaultModel": "auto",
                 "defaultPermissionMode": "default" }},
      "versionCheck": {{ "command": "printf", "args": [] }},
      "promptTemplate": ""
    }}"#
    );
    serde_json::from_str(&json).unwrap()
}

/// Runs `command` in `sh -c` and returns stdout; panics if the marker file
/// appeared, which would mean part of a value was executed as code.
fn run_and_assert_inert(command: &str, marker: &std::path::Path) -> String {
    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg(command)
        .output()
        .expect("sh runs");
    assert!(
        !marker.exists(),
        "payload executed as shell code: {command}"
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn marker_path(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("auric-inject-{}-{}", std::process::id(), name));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir.join("pwned")
}

#[test]
fn a_hostile_model_name_stays_one_inert_argument_in_a_dynamic_provider() {
    let provider = DynamicProvider::new(echo_config(true));
    for (index, template) in INJECTION_PAYLOADS.iter().enumerate() {
        let marker = marker_path(&format!("dyn-model-{index}"));
        let model = template.replace("{marker}", &marker.display().to_string());
        let cmd = provider.build_spawn_command(&model, "task", None, false, false, false);
        let stdout = run_and_assert_inert(&cmd.command, &marker);
        assert!(
            stdout.contains(&format!("[{model}]")),
            "model must arrive verbatim as one argument, got {stdout:?} from {}",
            cmd.command
        );
    }
}

#[test]
fn a_hostile_model_name_stays_one_inert_argument_for_crush() {
    for (index, template) in INJECTION_PAYLOADS.iter().enumerate() {
        let marker = marker_path(&format!("crush-model-{index}"));
        let model = template.replace("{marker}", &marker.display().to_string());
        let cmd = CrushProvider.build_spawn_command(&model, "task", None, false, false, false);
        // Swap the real binary for printf; the rest of the command is what
        // the shell would see.
        let command = cmd.command.replacen("crush", "printf '[%s]'", 1);
        let stdout = run_and_assert_inert(&command, &marker);
        assert!(
            stdout.contains(&format!("[{model}]")),
            "model must arrive verbatim as one argument, got {stdout:?} from {command}"
        );
    }
}

#[test]
fn a_hostile_task_stays_one_inert_argument_even_when_the_config_says_quote_false() {
    for quote in [true, false] {
        let provider = DynamicProvider::new(echo_config(quote));
        for (index, template) in INJECTION_PAYLOADS.iter().enumerate() {
            let marker = marker_path(&format!("dyn-task-{quote}-{index}"));
            let task = template.replace("{marker}", &marker.display().to_string());
            let cmd = provider.build_spawn_command("auto", &task, None, false, false, false);
            let stdout = run_and_assert_inert(&cmd.command, &marker);
            assert_eq!(stdout, format!("[{task}]"), "from {}", cmd.command);
        }
    }
}

#[test]
fn an_ordinary_model_name_is_left_unquoted() {
    let provider = DynamicProvider::new(get_claude_config());
    for model in [
        "opus",
        "gpt-5.1-codex",
        "moonshotai/kimi-k2-thinking",
        "grok-4:fast",
    ] {
        let cmd = provider.build_spawn_command(model, "task", None, false, false, false);
        assert!(
            cmd.command.contains(&format!("--model {model} ")),
            "{}",
            cmd.command
        );
    }
}

// ── Write sandbox (Antigravity-shaped config) ─────────────────────

fn sandboxed_config() -> ProviderConfig {
    serde_json::from_str(
        r#"{
      "id": "antigravity",
      "name": "Antigravity CLI",
      "executable": "agy",
      "arguments": [
        { "type": "headless", "flag": "--print-timeout 1h -p", "interactiveFlag": "-i" },
        { "type": "task", "quote": true },
        { "type": "permission", "map": {
            "auto": "--dangerously-skip-permissions",
            "bypassPermissions": "--dangerously-skip-permissions",
            "default": ""
          }, "fallback": "" }
      ],
      "writeSandbox": {
        "writable": ["~/.gemini"],
        "exemptPermissionModes": ["bypassPermissions"]
      },
      "info": { "models": [], "permissionModes": [], "defaultModel": "auto", "defaultPermissionMode": "auto" },
      "versionCheck": { "command": "agy", "args": ["--version"] },
      "promptTemplate": "agy -p \""
    }"#,
    )
    .unwrap()
}

#[test]
fn write_sandbox_follows_the_resolved_permission_mode() {
    let provider = DynamicProvider::new(sandboxed_config());
    // No mode requested (the conductor): the default `auto` is confined.
    assert_eq!(
        provider.write_sandbox(None, false, false),
        Some(vec!["~/.gemini".to_string()])
    );
    assert!(provider
        .write_sandbox(Some("default"), false, false)
        .is_some());
    // The explicit no-guardrails mode, by name or by the legacy flag, is not.
    assert_eq!(
        provider.write_sandbox(Some("bypassPermissions"), false, false),
        None
    );
    assert_eq!(provider.write_sandbox(None, true, false), None);
}

#[test]
fn a_provider_without_write_sandbox_runs_unconfined() {
    let provider = DynamicProvider::new(get_gemini_config());
    assert_eq!(provider.write_sandbox(None, false, false), None);
}

#[test]
fn headless_print_timeout_precedes_the_task_and_stays_out_of_interactive() {
    let provider = DynamicProvider::new(sandboxed_config());
    let headless = provider.build_spawn_command("auto", "task", None, false, false, true);
    assert_eq!(
        headless.command,
        "agy --print-timeout 1h -p \"task\" --dangerously-skip-permissions"
    );
    let interactive = provider.build_spawn_command("auto", "task", None, false, false, false);
    assert_eq!(
        interactive.command,
        "agy -i \"task\" --dangerously-skip-permissions"
    );
}

/// A CLI with only a global MCP config (the Antigravity CLI) binds through the
/// environment alone: `AURIC_MCP_CONFIG` names the per-project config that the
/// global `auric-mcp/bridge.mjs` entry then serves. That counts as a binding,
/// so the spawn is not refused, and the command line is left alone.
#[test]
fn an_environment_only_binding_is_a_binding() {
    let mut value: serde_json::Value = serde_json::from_str(
        r#"{
      "id": "antigravity", "name": "Antigravity CLI", "executable": "agy",
      "arguments": [{ "type": "task", "quote": true }],
      "projectBinding": { "environment": { "AURIC_MCP_CONFIG": "{mcpConfigPath}" } },
      "info": { "models": [], "permissionModes": [], "defaultModel": "auto", "defaultPermissionMode": "auto" },
      "versionCheck": { "command": "agy", "args": ["--version"] },
      "promptTemplate": "agy -p \""
    }"#,
    )
    .unwrap();
    value["allowUnboundMcp"] = serde_json::Value::Bool(false);
    let provider = DynamicProvider::new(serde_json::from_value(value).unwrap());
    let binding = ProviderProjectBinding::new("/repo/A", "/repo/A/.auric/project.db")
        .with_mcp_config_path("/app data/project-a.mcp.json");
    let injection = project_binding_injection_for("antigravity", &provider, &binding).unwrap();
    assert!(injection.arguments.is_empty());
    assert_eq!(
        injection.env_vars,
        vec![(
            "AURIC_MCP_CONFIG".to_string(),
            "/app data/project-a.mcp.json".to_string()
        )]
    );
}
