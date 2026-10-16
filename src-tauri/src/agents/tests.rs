use super::project_binding::resolve_project_binding;
use super::*;
use crate::provider_policy::ProviderPolicy;
use crate::providers::SpawnInjection;

#[test]
fn general_agents_strip_inherited_project_authority() {
    assert!(super::manager::is_reserved_auric_env("AURIC_PROJECT_ROOT"));
    assert!(super::manager::is_reserved_auric_env("AURIC_MCP_DB_PATH"));
    assert!(super::manager::is_reserved_auric_env(
        "AURIC_NOTIFICATIONS_DB"
    ));
    assert!(!super::manager::is_reserved_auric_env("PATH"));
}
use crate::providers::{new_provider_registry, ProviderRegistryState};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

// The registry's contents depend on which dynamic-providers directory is
// reachable, so these tests pin nothing but "crush is always there" and
// whatever the registry itself calls its default.
fn registry_and_default() -> (ProviderRegistryState, String) {
    let registry = new_provider_registry(None);
    let default_id = registry.default_provider().info().id;
    (registry, default_id)
}

fn deny(ids: &[&str]) -> ProviderPolicy {
    ProviderPolicy {
        allow: None,
        deny: ids.iter().map(|id| id.to_string()).collect(),
    }
}

#[test]
fn permits_a_provider_when_no_policy_is_set() {
    let (registry, _) = registry_and_default();

    let (id, _) = resolve_permitted_provider(Some("crush"), &registry, &ProviderPolicy::default())
        .expect("an unconfigured project permits everything");

    assert_eq!(id, "crush");
}

#[test]
fn refuses_a_denied_provider() {
    let (registry, _) = registry_and_default();

    let error = resolve_permitted_provider(Some("crush"), &registry, &deny(&["crush"]))
        .err()
        .expect("a denied provider must not spawn");

    // The message has to name the provider — it surfaces in an agent's
    // error row, where "not permitted" alone would say nothing.
    assert!(error.contains("crush"), "unhelpful message: {}", error);
}

#[test]
fn refuses_the_default_when_no_provider_was_requested() {
    let (registry, default_id) = registry_and_default();

    assert!(
        resolve_permitted_provider(None, &registry, &deny(&[&default_id])).is_err(),
        "falling back to the default must not dodge the policy"
    );
}

#[test]
fn an_unknown_provider_name_cannot_slip_past_a_deny_list() {
    // The heart of the gate. An unknown id falls back to the registry
    // default, so checking the *requested* name would let any caller past a
    // deny list by naming a provider that does not exist.
    let (registry, default_id) = registry_and_default();

    assert!(
        resolve_permitted_provider(
            Some("not-a-real-provider"),
            &registry,
            &deny(&[&default_id])
        )
        .is_err(),
        "the resolved provider is what must be checked"
    );
}

#[test]
fn an_allow_list_admits_its_members_and_no_one_else() {
    let (registry, default_id) = registry_and_default();
    let only_default = ProviderPolicy {
        allow: Some(vec![default_id.clone()]),
        deny: Vec::new(),
    };

    let (id, _) = resolve_permitted_provider(None, &registry, &only_default)
        .expect("the allowed provider spawns");
    assert_eq!(id, default_id);

    if default_id != "crush" {
        assert!(
            resolve_permitted_provider(Some("crush"), &registry, &only_default).is_err(),
            "a provider outside the allow list must not spawn"
        );
    }
}

#[test]
fn reports_the_provider_that_actually_resolved() {
    // What gets persisted and shown must be what ran, or Retry relaunches
    // something other than the row the user clicked.
    let (registry, default_id) = registry_and_default();

    let (id, _) = resolve_permitted_provider(None, &registry, &ProviderPolicy::default())
        .expect("no request resolves to the default");

    assert_eq!(id, default_id);
}

#[test]
fn refuses_an_unknown_provider_by_name_instead_of_falling_back() {
    // Naming a provider is a choice; running a different one in its place
    // would be a silent substitution the caller never sees.
    let (registry, _) = registry_and_default();

    let error = resolve_permitted_provider(
        Some("not-a-real-provider"),
        &registry,
        &ProviderPolicy::default(),
    )
    .err()
    .expect("an unknown provider must not spawn");

    assert!(
        error.contains("not-a-real-provider"),
        "unhelpful message: {}",
        error
    );
    assert!(
        error.contains("not installed"),
        "unhelpful message: {}",
        error
    );
}

#[test]
fn a_blank_provider_name_means_no_request() {
    let (registry, default_id) = registry_and_default();

    let (id, _) = resolve_permitted_provider(Some("  "), &registry, &ProviderPolicy::default())
        .expect("blank is treated as absent");

    assert_eq!(id, default_id);
}

/// A registry holding claude, codex and grok, the way an install with those
/// three provider configs sees it.
fn cross_registry() -> ProviderRegistryState {
    let dir = std::env::temp_dir().join(format!(
        "auric-cross-providers-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    for id in ["claude", "codex", "grok"] {
        let json = format!(
            r#"{{
              "id": "{id}", "name": "{id}", "executable": "{id}",
              "arguments": [ {{ "type": "task", "quote": true }} ],
              "info": {{ "models": [], "permissionModes": [],
                         "defaultModel": "m", "defaultPermissionMode": "default" }},
              "versionCheck": {{ "command": "{id}", "args": ["--version"] }},
              "promptTemplate": "{id}"
            }}"#
        );
        std::fs::write(dir.join(format!("{id}.json")), json).unwrap();
    }
    let loaded = crate::providers::ProviderRegistry::load_configs_from(&[dir.clone()]);
    let _ = std::fs::remove_dir_all(&dir);
    let registry = new_provider_registry(None);
    registry.providers.write().unwrap().extend(loaded);
    registry
}

#[test]
fn any_provider_can_start_any_other_across_the_board() {
    // The caller's own provider plays no part in the decision: a Claude agent
    // asking for Codex, a Codex agent asking for Claude, either asking for
    // Grok — each resolves to exactly the provider that was named.
    let registry = cross_registry();
    for (caller, target) in [
        ("claude", "codex"),
        ("codex", "claude"),
        ("claude", "grok"),
        ("codex", "grok"),
        ("grok", "claude"),
    ] {
        let (id, _) =
            resolve_permitted_provider(Some(target), &registry, &ProviderPolicy::default())
                .unwrap_or_else(|e| panic!("{caller} -> {target}: {e}"));
        assert_eq!(id, target, "{caller} asked for {target}");
    }
}

#[test]
fn a_forbidden_provider_is_refused_whoever_asks() {
    let registry = cross_registry();
    let no_grok = deny(&["grok"]);

    let error = resolve_permitted_provider(Some("grok"), &registry, &no_grok)
        .err()
        .expect("denied grok must not spawn");
    assert!(
        error.contains("grok") && error.contains("not permitted"),
        "{}",
        error
    );

    let only_claude = ProviderPolicy {
        allow: Some(vec!["claude".to_string()]),
        deny: Vec::new(),
    };
    assert!(resolve_permitted_provider(Some("codex"), &registry, &only_claude).is_err());
    assert!(resolve_permitted_provider(Some("claude"), &registry, &only_claude).is_ok());
}

#[test]
fn test_agent_config_deserializes_camel_case() {
    let json = r#"{
        "name": "Test Agent",
        "model": "sonnet",
        "task": "do stuff",
        "cwd": "/tmp",
        "projectPath": "/tmp/project",
        "permissionMode": "bypassPermissions",
        "dangerouslyIgnorePermissions": true,
        "autoAcceptEdits": false,
        "provider": "claude",
        "headless": true
    }"#;
    let config: AgentConfig = serde_json::from_str(json).unwrap();
    assert_eq!(config.name, "Test Agent");
    assert_eq!(config.model, "sonnet");
    assert_eq!(config.task, "do stuff");
    assert_eq!(config.cwd.as_deref(), Some("/tmp"));
    assert_eq!(config.project_path.as_deref(), Some("/tmp/project"));
    assert_eq!(config.permission_mode.as_deref(), Some("bypassPermissions"));
    assert_eq!(config.dangerously_ignore_permissions, Some(true));
    assert_eq!(config.auto_accept_edits, Some(false));
    assert_eq!(config.provider.as_deref(), Some("claude"));
    assert_eq!(config.headless, Some(true));
}

#[test]
fn an_agent_config_carries_the_attribution_the_usage_row_needs() {
    let json = r#"{
        "name": "Reviewer", "model": "auto", "task": "review",
        "runSource": "conductor", "runKind": "review", "reviewOfTicketId": "ticket-9"
    }"#;
    let config: AgentConfig = serde_json::from_str(json).unwrap();
    assert_eq!(config.run_source.as_deref(), Some("conductor"));
    assert_eq!(config.run_kind.as_deref(), Some("review"));
    assert_eq!(config.review_of_ticket_id.as_deref(), Some("ticket-9"));

    let bare: AgentConfig =
        serde_json::from_str(r#"{ "name": "n", "model": "auto", "task": "t" }"#).unwrap();
    assert!(bare.run_source.is_none() && bare.run_kind.is_none());
    assert!(bare.review_of_ticket_id.is_none());
}

#[test]
fn test_agent_config_optional_fields_default_to_none() {
    let json = r#"{
        "name": "Minimal",
        "model": "auto",
        "task": "hello"
    }"#;
    let config: AgentConfig = serde_json::from_str(json).unwrap();
    assert_eq!(config.name, "Minimal");
    assert_eq!(config.model, "auto");
    assert_eq!(config.task, "hello");
    assert!(config.cwd.is_none());
    assert!(config.project_path.is_none());
    assert!(config.permission_mode.is_none());
    assert!(config.dangerously_ignore_permissions.is_none());
    assert!(config.auto_accept_edits.is_none());
    assert!(config.provider.is_none());
    assert!(config.headless.is_none());
}

#[test]
fn test_persisted_from_config_captures_all_spawn_fields() {
    let config = AgentConfig {
        name: "Agent (alpha)".to_string(),
        model: "opus".to_string(),
        task: "fix the login flow".to_string(),
        cwd: Some("/repo".to_string()),
        project_path: Some("/repo".to_string()),
        permission_mode: Some("acceptEdits".to_string()),
        dangerously_ignore_permissions: None,
        auto_accept_edits: Some(true),
        provider: Some("claude".to_string()),
        headless: Some(false),
        spawned_by_ticket_id: Some("ticket-7".to_string()),
        spawned_by_goal_id: None,
        launch_request_uid: None,
        agent_notification_uid: None,
        agent_notification_action_id: None,
        run_source: None,
        run_kind: None,
        review_of_ticket_id: None,
        role: None,
        spawned_by_agent_id: None,
    };
    let persisted = persisted_from_config(&config, "agent-4", "claude", 123);
    assert_eq!(persisted.id, "agent-4");
    assert_eq!(persisted.name, "Agent (alpha)");
    assert_eq!(persisted.model, "opus");
    assert_eq!(persisted.provider, "claude");
    assert_eq!(persisted.task, "fix the login flow");
    assert_eq!(persisted.cwd.as_deref(), Some("/repo"));
    assert_eq!(persisted.project_path.as_deref(), Some("/repo"));
    assert_eq!(persisted.permission_mode.as_deref(), Some("acceptEdits"));
    assert!(!persisted.dangerously_ignore_permissions);
    assert!(persisted.auto_accept_edits);
    assert!(!persisted.headless);
    assert_eq!(persisted.started_at, 123);
    assert_eq!(persisted.spawned_by_ticket_id.as_deref(), Some("ticket-7"));
    assert!(persisted.spawned_by_goal_id.is_none());
}

#[test]
fn project_binding_is_explicit_and_does_not_fall_back_to_execution_cwd() {
    let config: AgentConfig = serde_json::from_str(
        r#"{
            "name": "General Agent",
            "model": "auto",
            "task": "triage inbox",
            "cwd": "/tmp",
            "projectPath": null
        }"#,
    )
    .unwrap();

    assert_eq!(config.cwd.as_deref(), Some("/tmp"));
    assert!(config.project_path.is_none());
    assert!(resolve_project_binding(config.project_path.as_deref())
        .unwrap()
        .is_none());
}

#[test]
fn project_binding_canonicalizes_the_logical_root_independently_of_execution_cwd() {
    let temp = tempfile::tempdir().unwrap();
    let logical_root = temp.path().join("project");
    let execution_worktree = temp.path().join("worktrees").join("feature");
    std::fs::create_dir_all(&logical_root).unwrap();
    std::fs::create_dir_all(logical_root.join(".auric")).unwrap();
    std::fs::write(logical_root.join(".auric/project.db"), []).unwrap();
    std::fs::create_dir_all(&execution_worktree).unwrap();
    let non_canonical_root = logical_root.join("..").join("project");

    let binding = resolve_project_binding(non_canonical_root.to_str())
        .unwrap()
        .expect("an explicit project path creates a binding");

    assert_eq!(binding.project_root(), logical_root.canonicalize().unwrap());
    assert_eq!(
        binding.database_path(),
        logical_root
            .canonicalize()
            .unwrap()
            .join(".auric")
            .join("project.db")
    );
    assert_ne!(binding.project_root(), execution_worktree);
}

#[test]
fn project_binding_exports_the_explicit_mcp_launcher_environment() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::create_dir_all(root.join(".auric")).unwrap();
    std::fs::write(root.join(".auric/project.db"), []).unwrap();
    let binding = resolve_project_binding(root.to_str()).unwrap().unwrap();

    assert_eq!(
        binding.environment(),
        vec![
            (
                "AURIC_PROJECT_ROOT".to_string(),
                root.to_string_lossy().into_owned()
            ),
            (
                "AURIC_MCP_DB_PATH".to_string(),
                root.join(".auric")
                    .join("project.db")
                    .to_string_lossy()
                    .into_owned()
            ),
        ]
    );
}

#[test]
fn project_binding_fails_closed_for_missing_or_non_directory_paths() {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("not-a-project");
    std::fs::write(&file, "x").unwrap();

    let file_error = resolve_project_binding(file.to_str()).unwrap_err();
    assert!(file_error.contains("directory"), "{file_error}");

    let missing = temp.path().join("missing");
    let missing_error = resolve_project_binding(missing.to_str()).unwrap_err();
    assert!(
        missing_error.contains("resolve project path"),
        "{missing_error}"
    );

    let uninitialized = temp.path().join("uninitialized-project");
    std::fs::create_dir(&uninitialized).unwrap();
    let uninitialized_error = resolve_project_binding(uninitialized.to_str()).unwrap_err();
    assert!(
        uninitialized_error.contains("not initialized")
            && uninitialized_error.contains(".auric/project.db"),
        "{uninitialized_error}"
    );
}

#[cfg(unix)]
#[test]
fn project_binding_rejects_a_database_symlink_outside_the_project() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    std::fs::create_dir_all(project.join(".auric")).unwrap();
    let outside = temp.path().join("other-project.db");
    std::fs::write(&outside, []).unwrap();
    symlink(&outside, project.join(".auric/project.db")).unwrap();

    let error = resolve_project_binding(project.to_str()).unwrap_err();
    assert!(error.contains("escapes project root"), "{error}");
}

#[test]
fn test_resume_task_prompt_embeds_original_task_and_continuation_hint() {
    let prompt = resume_task_prompt("build the parser");
    assert!(prompt.contains("build the parser"));
    assert!(prompt.contains("interrupted by an IDE restart"));
    assert!(prompt.contains("continue from where the previous run left off"));
}

#[test]
fn test_parse_env_output_splits_nul_separated_pairs() {
    let raw = b"FOO=bar\0PATH=/usr/bin:/bin\0EMPTY=\0";
    let parsed = parse_env_output(raw);
    assert_eq!(
        parsed,
        vec![
            ("FOO".to_string(), "bar".to_string()),
            ("PATH".to_string(), "/usr/bin:/bin".to_string()),
            ("EMPTY".to_string(), "".to_string()),
        ]
    );
}

#[test]
fn test_parse_env_output_keeps_equals_signs_in_value() {
    let raw = b"CONNSTRING=user=admin;pass=1\0";
    let parsed = parse_env_output(raw);
    assert_eq!(
        parsed,
        vec![("CONNSTRING".to_string(), "user=admin;pass=1".to_string())]
    );
}

#[test]
fn test_parse_env_output_skips_entries_without_equals() {
    let raw = b"MALFORMED\0FOO=bar\0";
    let parsed = parse_env_output(raw);
    assert_eq!(parsed, vec![("FOO".to_string(), "bar".to_string())]);
}

#[test]
fn test_parse_env_output_skips_rc_noise_with_invalid_keys() {
    // Interactive shells may print rc-file noise (echos, prompt setup)
    // to stdout before `env -0` output. Anything whose key is not a
    // valid env var name must be dropped.
    let raw = b"welcome message\0not a var=oops\09LEADING=x\0FOO=bar\0_UNDER=1\0";
    let parsed = parse_env_output(raw);
    assert_eq!(
        parsed,
        vec![
            ("FOO".to_string(), "bar".to_string()),
            ("_UNDER".to_string(), "1".to_string()),
        ]
    );
}

#[test]
fn test_merge_path_unions_and_dedupes_preserving_harvested_order() {
    assert_eq!(merge_path(Some("/a:/b:/c"), Some("/b:/d")), "/a:/b:/c:/d");
}

#[test]
fn test_merge_path_falls_back_to_inherited_when_harvest_missing() {
    assert_eq!(merge_path(None, Some("/x:/y")), "/x:/y");
}

#[test]
fn test_merge_path_keeps_harvested_when_inherited_missing() {
    assert_eq!(merge_path(Some("/a:/b"), None), "/a:/b");
}

#[test]
fn test_merge_path_skips_empty_segments() {
    assert_eq!(merge_path(Some("/a::/b:"), Some(":/c")), "/a:/b:/c");
}

#[test]
fn test_apply_inherited_path_extends_harvested_path_entry() {
    let mut env = vec![
        ("FOO".to_string(), "bar".to_string()),
        ("PATH".to_string(), "/harvest/bin".to_string()),
    ];
    apply_inherited_path(&mut env, Some("/harvest/bin:/proc/bin"));
    assert_eq!(
        env.iter()
            .find(|(k, _)| k == "PATH")
            .map(|(_, v)| v.as_str()),
        Some("/harvest/bin:/proc/bin")
    );
}

#[test]
fn test_apply_inherited_path_inserts_path_when_harvest_lacks_one() {
    let mut env = vec![("FOO".to_string(), "bar".to_string())];
    apply_inherited_path(&mut env, Some("/proc/bin"));
    assert_eq!(
        env.iter()
            .find(|(k, _)| k == "PATH")
            .map(|(_, v)| v.as_str()),
        Some("/proc/bin")
    );
}

#[cfg(target_os = "macos")]
#[test]
fn test_login_shell_invocation_uses_interactive_flag_on_macos() {
    // .zshrc (where user PATH entries like ~/.local/bin typically live)
    // is only sourced by *interactive* shells, so the harvest must be
    // able to run one.
    assert_eq!(login_shell_invocation(true), Some(("/bin/zsh", "-ilc")));
    assert_eq!(login_shell_invocation(false), Some(("/bin/zsh", "-lc")));
}

/// Regression test: dropping an `AgentProcess` (e.g. after removing it
/// from the manager's map) must NOT be relied upon to terminate the
/// underlying PTY child. `kill_agent_impl` must explicitly call
/// `.kill()`, otherwise "killed" agents keep running as orphaned
/// processes indefinitely.
#[test]
fn test_child_kill_terminates_the_process() {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("failed to open pty");

    let mut cmd = CommandBuilder::new("sleep");
    cmd.arg("30");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .expect("failed to spawn sleep");
    drop(pair.slave);

    assert!(
        child.try_wait().expect("try_wait failed").is_none(),
        "process should still be running right after spawn"
    );

    child.kill().expect("kill should succeed");

    let mut terminated = false;
    for _ in 0..100 {
        if child.try_wait().expect("try_wait failed").is_some() {
            terminated = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }

    assert!(
        terminated,
        "process should have exited after calling kill() on the child handle"
    );
}

#[test]
fn a_provider_without_binding_material_is_refused_by_default() {
    let error = binding_injection_for("grok", SpawnInjection::default(), false).unwrap_err();
    assert!(error.contains("'grok'"), "{error}");
}

#[test]
fn a_provider_that_opts_in_starts_without_binding_material() {
    let injection = binding_injection_for("grok", SpawnInjection::default(), true).unwrap();
    assert!(injection.is_empty());
}

#[test]
fn declared_binding_material_is_used_regardless_of_the_opt_in() {
    let declared = SpawnInjection {
        arguments: vec!["--mcp-config".to_string()],
        env_vars: Vec::new(),
    };
    let injection = binding_injection_for("claude", declared, false).unwrap();
    assert_eq!(injection.arguments, vec!["--mcp-config".to_string()]);
}

/// The frontend reads `headless` off the agent itself to decide that a silent
/// run is not a stalled one; the spawn config it could also read is lost on a
/// restart, the agent list is not.
#[test]
fn agent_info_tells_the_frontend_the_run_is_headless() {
    let info = AgentInfo {
        id: "agent-h".to_string(),
        name: "Conductor".to_string(),
        model: "auto".to_string(),
        provider: "claude".to_string(),
        status: AgentStatus::Running,
        current_task: None,
        started_at: 1,
        last_activity_at: Some(1),
        project_path: None,
        repo_path: None,
        spawned_by_ticket_id: None,
        spawned_by_goal_id: None,
        headless: true,
        role: AgentRole::Worker,
        spawned_by_agent_id: None,
    };
    let json = serde_json::to_value(&info).expect("serializes");
    assert_eq!(json["headless"], serde_json::Value::Bool(true));
}

const CONTROL_FIXTURES: &str = include_str!("../../../src/lib/agents/agentControl.fixtures.json");

fn control_fixtures() -> serde_json::Value {
    serde_json::from_str(CONTROL_FIXTURES).unwrap()
}

#[test]
fn every_agent_process_carries_the_ide_agent_marker() {
    let fixtures = control_fixtures();
    assert_eq!(fixtures["environment"]["ideAgentMarker"], IDE_AGENT_MARKER);

    let mut cmd = CommandBuilder::new("true");
    let shell = [(IDE_AGENT_MARKER.to_string(), "0".to_string())];
    let spawn = [(IDE_AGENT_MARKER.to_string(), String::new())];
    super::manager::apply_agent_env(&mut cmd, &shell, &spawn);
    assert_eq!(
        cmd.get_env(IDE_AGENT_MARKER),
        Some(std::ffi::OsStr::new("1")),
        "neither the login shell nor a provider may clear the marker"
    );
}

#[test]
fn spawn_refusals_carry_the_sentences_the_control_bridge_maps() {
    let fixtures = control_fixtures();
    let pattern = |code: &str| {
        fixtures["spawnRefusals"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["code"] == code)
            .and_then(|r| r["pattern"].as_str())
            .unwrap_or_else(|| panic!("no spawnRefusals entry for {code}"))
            .to_string()
    };
    let (registry, _) = registry_and_default();

    let denied = resolve_permitted_provider(Some("crush"), &registry, &deny(&["crush"]))
        .err()
        .unwrap();
    assert!(denied.contains(&pattern("provider_denied")), "{denied}");

    let missing = resolve_permitted_provider(
        Some("not-a-real-provider"),
        &registry,
        &ProviderPolicy::default(),
    )
    .err()
    .unwrap();
    assert!(missing.contains(&pattern("invalid_params")), "{missing}");
}

#[test]
fn a_resumed_agent_keeps_the_attribution_its_cost_is_booked_under() {
    let config: AgentConfig = serde_json::from_str(
        r#"{ "name": "n", "model": "auto", "task": "t", "spawnedByTicketId": "t1",
             "runSource": "conductor", "runKind": "review", "reviewOfTicketId": "t9" }"#,
    )
    .unwrap();
    let persisted = persisted_from_config(&config, "agent-1", "claude", 1);

    let resumed = resumed_config(persisted, None);

    assert_eq!(resumed.run_source.as_deref(), Some("conductor"));
    assert_eq!(resumed.run_kind.as_deref(), Some("review"));
    assert_eq!(resumed.review_of_ticket_id.as_deref(), Some("t9"));
    assert_eq!(resumed.spawned_by_ticket_id.as_deref(), Some("t1"));
}

#[test]
fn a_persistence_file_from_before_attribution_still_loads() {
    let old = r#"{ "id": "agent-1", "name": "n", "model": "m", "provider": "claude",
                   "task": "t", "cwd": null, "permissionMode": null, "startedAt": 1 }"#;

    let agent: crate::agent_persistence::PersistedAgent = serde_json::from_str(old).unwrap();

    assert!(agent.run_source.is_none() && agent.run_kind.is_none());
    assert!(agent.review_of_ticket_id.is_none());
}

// ── Supervisor spawns (ADR 0004) ────────────────────────────────────────────

fn supervisor_test_config(extra: serde_json::Value) -> AgentConfig {
    let mut base = serde_json::json!({
        "name": "a", "model": "haiku", "task": "t", "cwd": "/somewhere",
        "permissionMode": null, "dangerouslyIgnorePermissions": null,
        "autoAcceptEdits": null, "provider": "claude", "headless": true
    });
    for (key, value) in extra.as_object().unwrap() {
        base[key] = value.clone();
    }
    serde_json::from_value(base).unwrap()
}

/// An app data dir whose policy allows `haiku` headless in one project, and
/// that project (initialised, no provider policy of its own).
fn supervisor_test_world() -> (tempfile::TempDir, tempfile::TempDir, String) {
    let app_data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    std::fs::create_dir(project.path().join(".auric")).unwrap();
    std::fs::write(project.path().join(".auric/project.db"), b"").unwrap();
    let path = crate::supervisor::canonical_project_path(&project.path().to_string_lossy());
    let policy = crate::supervisor::validate_for_write(serde_json::json!({
        "projects": { path.clone(): {
            "allowed": true, "providers": ["claude"], "models": { "claude": ["haiku"] },
            "maxRunning": 1 } }
    }))
    .unwrap();
    crate::supervisor::write_policy_atomic(
        &crate::supervisor::policy_path_in(app_data.path()),
        &policy,
    )
    .unwrap();
    (app_data, project, path)
}

fn no_modes(
    _: &crate::supervisor::policy::SupervisorPolicy,
) -> std::collections::BTreeMap<String, crate::supervisor::policy::ProviderModes> {
    std::collections::BTreeMap::new()
}

fn offered_claude() -> std::collections::BTreeMap<String, Vec<String>> {
    std::collections::BTreeMap::from([(
        "claude".to_string(),
        vec!["haiku".to_string(), "opus".to_string()],
    )])
}

#[test]
fn a_spawn_naming_a_supervisor_is_checked_against_the_policy_again() {
    let (app_data, _project, path) = supervisor_test_world();
    let child = |model: &str| {
        supervisor_test_config(serde_json::json!({
            "model": model, "projectPath": path, "spawnedByAgentId": "agent-sup",
            "runSource": "ui"
        }))
    };
    let admitted = admit_spawn(
        child("haiku"),
        Some(app_data.path()),
        &[],
        &offered_claude(),
        &no_modes,
    )
    .expect("inside the policy");
    assert_eq!(
        admitted.run_source.as_deref(),
        Some("supervisor"),
        "booked as the supervisor's, whatever the frontend said"
    );

    let refused = admit_spawn(
        child("opus"),
        Some(app_data.path()),
        &[],
        &offered_claude(),
        &no_modes,
    );
    assert!(refused.unwrap_err().contains("model_not_allowed"));

    let busy = AgentInfo {
        id: "agent-busy".into(),
        project_path: Some(path.clone()),
        spawned_by_agent_id: Some("agent-sup".into()),
        ..crate::control_socket::protocol::tests::sample_agent()
    };
    let full = admit_spawn(
        child("haiku"),
        Some(app_data.path()),
        &[busy],
        &offered_claude(),
        &no_modes,
    );
    assert!(full.unwrap_err().contains("project_limit_reached"));

    let unchecked = admit_spawn(child("haiku"), None, &[], &offered_claude(), &no_modes);
    assert!(
        unchecked.is_err(),
        "no app data dir: refused, not run unchecked"
    );
}

#[test]
fn a_spawn_without_a_supervisor_is_left_alone() {
    let config = supervisor_test_config(serde_json::json!({ "model": "opus" }));
    let admitted = admit_spawn(config, None, &[], &offered_claude(), &no_modes).unwrap();
    assert_eq!(admitted.model, "opus");
    assert_eq!(admitted.cwd.as_deref(), Some("/somewhere"));
}

#[test]
fn a_supervisor_runs_interactive_unbound_in_its_own_folder_in_default_mode() {
    let app_data = tempfile::tempdir().unwrap();
    let config = supervisor_test_config(serde_json::json!({
        "role": "supervisor", "projectPath": "/some/project",
        "permissionMode": "bypassPermissions", "dangerouslyIgnorePermissions": true,
        "autoAcceptEdits": true, "headless": true, "launchRequestUid": "req-1"
    }));
    let admitted = admit_spawn(
        config,
        Some(app_data.path()),
        &[],
        &offered_claude(),
        &no_modes,
    )
    .unwrap();
    let folder = app_data.path().join(crate::supervisor::SUPERVISOR_DIR_NAME);
    assert!(folder.is_dir());
    assert_eq!(
        admitted.cwd.as_deref(),
        Some(folder.to_string_lossy().as_ref())
    );
    assert_eq!(admitted.project_path, None);
    assert_eq!(admitted.headless, Some(false));
    assert_eq!(admitted.permission_mode.as_deref(), Some("default"));
    assert_eq!(admitted.dangerously_ignore_permissions, Some(false));
    assert_eq!(admitted.auto_accept_edits, Some(false));
    assert_eq!(admitted.launch_request_uid, None);

    let nested = supervisor_test_config(serde_json::json!({
        "role": "supervisor", "spawnedByAgentId": "agent-sup"
    }));
    assert!(admit_spawn(
        nested,
        Some(app_data.path()),
        &[],
        &offered_claude(),
        &no_modes
    )
    .is_err());
}

#[test]
fn a_supervisor_runs_on_claude_with_only_its_own_tools_preapproved() {
    assert!(check_supervisor_provider("claude").is_ok());
    assert!(check_supervisor_provider("codex")
        .unwrap_err()
        .contains("Claude Code"));
    assert_eq!(
        supervisor_claude_arguments("/data/agent-bindings/sup $1.mcp.json"),
        vec![
            "--mcp-config",
            "\"/data/agent-bindings/sup \\$1.mcp.json\"",
            "--strict-mcp-config",
            "--tools",
            "\"\"",
            "--restricted",
            "--allowedTools",
            "\"mcp__auric-supervisor__*\"",
            "--permission-mode",
            "default",
        ]
    );
}

#[test]
fn the_supervisor_flags_land_behind_the_executable_and_before_the_task() {
    let config: crate::providers::ProviderConfig = serde_json::from_str(
        r#"{
          "id": "claude", "name": "Claude Code", "executable": "claude",
          "arguments": [
            { "type": "model", "flag": "--model", "ignoreIfAuto": true },
            { "type": "headless", "flag": "-p" },
            { "type": "task", "quote": true },
            { "type": "permission", "map": { "default": "" }, "fallback": "" }
          ],
          "info": { "models": [], "permissionModes": [], "defaultModel": "sonnet",
                    "defaultPermissionMode": "default" },
          "versionCheck": { "command": "claude", "args": ["--version"] },
          "promptTemplate": "claude -p \""
        }"#,
    )
    .unwrap();
    let provider = crate::providers::DynamicProvider::new(config);
    let cmd = crate::providers::AgentProvider::build_spawn_command(
        &provider,
        "opus",
        "plan the week",
        Some("default"),
        false,
        false,
        false,
    )
    .with_injection(SpawnInjection {
        arguments: supervisor_claude_arguments("/c.json"),
        env_vars: Vec::new(),
    });
    assert_eq!(
        cmd.command,
        "claude --mcp-config \"/c.json\" --strict-mcp-config --tools \"\" --restricted \
         --allowedTools \"mcp__auric-supervisor__*\" --permission-mode default --model opus \
         \"plan the week\""
    );
}

#[test]
fn role_and_supervisor_survive_a_restart() {
    let config = supervisor_test_config(serde_json::json!({
        "spawnedByAgentId": "agent-sup", "role": "worker"
    }));
    let persisted = persisted_from_config(&config, "agent-9", "claude", 1);
    let resumed = resumed_config(persisted, None);
    assert_eq!(resumed.role, Some(AgentRole::Worker));
    assert_eq!(resumed.spawned_by_agent_id.as_deref(), Some("agent-sup"));
}

#[test]
fn a_launch_file_goes_when_the_agent_entry_goes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("supervisor-x.mcp.json");
    std::fs::write(&path, b"{}").unwrap();
    let owned = OwnedFile(path.clone());
    assert!(path.exists());
    drop(owned);
    assert!(
        !path.exists(),
        "a supervisor's MCP config does not outlive it"
    );
}
