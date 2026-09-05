use super::*;
use crate::provider_policy::ProviderPolicy;
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

    let (id, _) = resolve_permitted_provider(
        Some("not-a-real-provider"),
        &registry,
        &ProviderPolicy::default(),
    )
    .expect("an unknown name still falls back");

    assert_eq!(id, default_id);
}

#[test]
fn test_agent_config_deserializes_camel_case() {
    let json = r#"{
        "name": "Test Agent",
        "model": "sonnet",
        "task": "do stuff",
        "cwd": "/tmp",
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
    assert_eq!(config.permission_mode.as_deref(), Some("bypassPermissions"));
    assert_eq!(config.dangerously_ignore_permissions, Some(true));
    assert_eq!(config.auto_accept_edits, Some(false));
    assert_eq!(config.provider.as_deref(), Some("claude"));
    assert_eq!(config.headless, Some(true));
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
        permission_mode: Some("acceptEdits".to_string()),
        dangerously_ignore_permissions: None,
        auto_accept_edits: Some(true),
        provider: Some("claude".to_string()),
        headless: Some(false),
        spawned_by_ticket_id: Some("ticket-7".to_string()),
        spawned_by_goal_id: None,
    };
    let persisted = persisted_from_config(&config, "agent-4", "claude", 123);
    assert_eq!(persisted.id, "agent-4");
    assert_eq!(persisted.name, "Agent (alpha)");
    assert_eq!(persisted.model, "opus");
    assert_eq!(persisted.provider, "claude");
    assert_eq!(persisted.task, "fix the login flow");
    assert_eq!(persisted.cwd.as_deref(), Some("/repo"));
    assert_eq!(persisted.permission_mode.as_deref(), Some("acceptEdits"));
    assert!(!persisted.dangerously_ignore_permissions);
    assert!(persisted.auto_accept_edits);
    assert!(!persisted.headless);
    assert_eq!(persisted.started_at, 123);
    assert_eq!(persisted.spawned_by_ticket_id.as_deref(), Some("ticket-7"));
    assert!(persisted.spawned_by_goal_id.is_none());
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
