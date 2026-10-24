use super::*;
use crate::providers::{AgentProvider, DynamicProvider, ProviderProjectBinding};
use crate::supervisor::policy::{parse, ProjectRules, SupervisorPolicy};
use serde_json::{json, Value};
use std::{
    io::Write,
    process::{Command, Stdio},
};

fn setup() -> (tempfile::TempDir, SupervisorPolicy, PathBuf, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/stdio-connector");
    let path = temp.path().join("auric-connector.yaml");
    let text = std::fs::read_to_string(fixture.join("auric-connector.yaml"))
        .unwrap()
        .replace(
            "./fake-mcp.py",
            &fixture.join("fake-mcp.py").to_string_lossy(),
        );
    std::fs::write(&path, text).unwrap();
    let entry = inspect(&path).unwrap();
    let a = temp.path().join("project a");
    let b = temp.path().join("project b");
    for root in [&a, &b] {
        std::fs::create_dir_all(root.join(".auric")).unwrap();
        std::fs::write(root.join(".auric/project.db"), "").unwrap();
    }
    let a = a.canonicalize().unwrap();
    let b = b.canonicalize().unwrap();
    let mut policy = SupervisorPolicy::default();
    for root in [&a, &b] {
        policy.projects.insert(
            root.to_string_lossy().into_owned(),
            ProjectRules {
                allowed: true,
                ..Default::default()
            },
        );
    }
    policy
        .connectors
        .registry
        .insert(entry.manifest.id.clone(), entry);
    policy.connectors.bindings.insert(
        a.to_string_lossy().into_owned(),
        BTreeMap::from([("test-catalog".into(), vec!["catalog.read".into()])]),
    );
    (temp, policy, a, b)
}
fn provider(id: &str, binding: bool) -> DynamicProvider {
    DynamicProvider::new(serde_json::from_value(json!({
        "id": id, "name": id, "executable": "printf", "arguments": [{"type": "task", "quote": true}],
        "allowUnboundMcp": true,
        "projectBinding": if binding { json!({"arguments": ["--mcp-config", "{mcpConfigPath}", "--strict-mcp-config"]}) } else { Value::Null },
        "info": { "models": [], "permissionModes": [], "defaultModel": "auto", "defaultPermissionMode": "default" },
        "versionCheck": {"command": "printf", "args": []}, "promptTemplate": "printf "
    })).unwrap())
}
fn binding(root: &Path) -> ProviderProjectBinding {
    ProviderProjectBinding::new(
        root.to_string_lossy(),
        root.join(".auric/project.db").to_string_lossy(),
    )
    .with_runtime_entrypoint("/runtime/server.mjs")
}
#[test]
fn project_a_gets_connector_and_briefing_b_gets_neither_for_each_adapter() {
    let (temp, policy, a, b) = setup();
    let runtime = Path::new("/runtime/server.mjs");
    for root in [&a, &b] {
        let resolved = resolve(&policy, root);
        let expected = root == &a;
        assert_eq!(!resolved.is_empty(), expected);
        assert_eq!(
            launch_context("task", &resolved).contains("Use catalog_list"),
            expected
        );
        let configs = crate::mcp::write_agent_mcp_configs_with_connectors(
            temp.path(),
            runtime,
            "node",
            root,
            &BTreeMap::new(),
            &resolved,
            &[],
        )
        .unwrap();
        for (path, key) in [(&configs.standard, "mcpServers"), (&configs.crush, "mcp")] {
            let config: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            assert_eq!(
                config[key].get("connector-test-catalog").is_some(),
                expected
            );
            assert!(config[key].get("auric-pm").is_some());
            if expected && key == "mcp" {
                assert_eq!(
                    config[key]["connector-test-catalog"]["enabled_tools"],
                    json!(["catalog_list"])
                );
                assert_eq!(
                    config[key]["connector-test-catalog"]["disabled_tools"],
                    json!(["catalog_change"])
                );
            }
        }
        let mut codex_binding = binding(root);
        codex_binding.connectors = resolved.clone();
        let injection = crate::providers::codex_project_binding_injection(&codex_binding).unwrap();
        assert_eq!(
            injection
                .arguments
                .iter()
                .any(|a| a.contains("connector-test-catalog")),
            expected
        );
        if expected {
            assert!(injection
                .arguments
                .iter()
                .any(|a| a.contains("enabled_tools=[\"catalog_list\"]")));
        }
        for id in ["claude", "custom"] {
            let adapter = provider(id, true);
            let effective = for_provider(resolved.clone(), id, &adapter, binding(root)).unwrap();
            let command = adapter.build_spawn_command(
                "auto",
                &launch_context("task", &effective),
                None,
                false,
                false,
                false,
            );
            assert_eq!(command.command.contains("Use catalog_list"), expected);
        }
        let claude_filter = crate::providers::connector_tool_filter_injection("claude", &resolved);
        assert_eq!(!claude_filter.is_empty(), expected);
        if expected {
            assert!(
                claude_filter.arguments[1].contains("mcp__connector-test-catalog__catalog_change")
            );
            assert!(!claude_filter.arguments[1].contains("catalog_list"));
        }
        let crush = for_provider(
            resolved.clone(),
            "crush",
            &crate::providers::CrushProvider,
            binding(root),
        )
        .unwrap();
        assert_eq!(!crush.is_empty(), expected);
        let grok = for_provider(resolved, "grok", &provider("grok", false), binding(root)).unwrap();
        assert!(grok.is_empty());
        assert_eq!(launch_context("task", &grok), "task");
    }
}
#[test]
fn generated_config_launches_real_stdio_fixture_with_host_project_arguments() {
    let (temp, policy, a, _) = setup();
    let connectors = resolve(&policy, &a);
    let configs = crate::mcp::write_agent_mcp_configs_with_connectors(
        temp.path(),
        Path::new("/runtime"),
        "node",
        &a,
        &BTreeMap::new(),
        &connectors,
        &[],
    )
    .unwrap();
    let config: Value = serde_json::from_slice(&std::fs::read(configs.standard).unwrap()).unwrap();
    let server = &config["mcpServers"]["connector-test-catalog"];
    let mut child = Command::new(server["command"].as_str().unwrap())
        .args(
            server["args"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| s.as_str().unwrap()),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    for message in [
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"catalog_list","arguments":{}}}),
    ] {
        writeln!(stdin, "{message}").unwrap();
    }
    drop(stdin);
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let results: Vec<Value> = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(results[1]["result"]["tools"][0]["name"], "catalog_list");
    let args: Value =
        serde_json::from_str(results[2]["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(args, json!(["project a", a]));
}
#[test]
fn manifest_startup_timeout_defaults_and_flows_into_stdio_mcp_configurations() {
    let (temp, mut policy, a, _) = setup();
    assert_eq!(
        policy.connectors.registry["test-catalog"]
            .manifest
            .launch
            .startup_timeout_s,
        30
    );
    assert!(
        serde_json::to_value(&policy.connectors.registry["test-catalog"].manifest).unwrap()
            ["launch"]
            .get("startup_timeout_s")
            .is_none()
    );

    let assert_timeout = |policy: &SupervisorPolicy, expected| {
        let connectors = resolve(policy, &a);
        let configs = crate::mcp::write_agent_mcp_configs_with_connectors(
            temp.path(),
            Path::new("/runtime"),
            "node",
            &a,
            &BTreeMap::new(),
            &connectors,
            &[],
        )
        .unwrap();
        for (path, key) in [(&configs.standard, "mcpServers"), (&configs.crush, "mcp")] {
            let config: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            assert_eq!(config[key]["connector-test-catalog"]["timeout"], expected);
        }
        let mut codex_binding = binding(&a);
        codex_binding.connectors = connectors;
        let injection = crate::providers::codex_project_binding_injection(&codex_binding).unwrap();
        assert!(injection
            .arguments
            .iter()
            .any(|argument| argument.contains(&format!("startup_timeout_sec={expected}"))));
    };

    assert_timeout(&policy, json!(30));
    let path = policy.connectors.registry["test-catalog"].path.clone();
    let manifest = std::fs::read_to_string(&path).unwrap().replace(
        "  env: { CONNECTOR_MODE: fixture }",
        "  env: { CONNECTOR_MODE: fixture }\n  startup_timeout_s: 47",
    );
    std::fs::write(&path, manifest).unwrap();
    policy
        .connectors
        .registry
        .insert("test-catalog".into(), inspect(&path).unwrap());
    assert_timeout(&policy, json!(47));
}
#[test]
fn digest_drift_disables_until_explicit_reapproval_and_old_snapshot_stays_fixed() {
    let (temp, mut pinned_policy, a2, _) = setup();
    let before = resolve(&pinned_policy, &a2);
    let entry = pinned_policy
        .connectors
        .registry
        .get_mut("test-catalog")
        .unwrap();
    let content = std::fs::read_to_string(&entry.path).unwrap();
    std::fs::write(
        &entry.path,
        content.replace("Use catalog_list", "Changed briefing"),
    )
    .unwrap();
    assert!(resolve(&pinned_policy, &a2).is_empty());
    assert!(before[0].briefing.contains("Use catalog_list"));
    *pinned_policy
        .connectors
        .registry
        .get_mut("test-catalog")
        .unwrap() = inspect(&temp.path().join("auric-connector.yaml")).unwrap();
    assert!(resolve(&pinned_policy, &a2)[0]
        .briefing
        .contains("Changed briefing"));
}
#[test]
fn host_policy_roundtrip_scopes_and_denial() {
    let (_temp, mut policy, a, b) = setup();
    policy.connectors.validate().unwrap();
    let parsed = parse(Some(&serde_json::to_string(&policy).unwrap()));
    assert!(parsed.rejected.is_empty());
    assert_eq!(parsed.policy, policy);
    assert_eq!(resolve(&policy, &a)[0].allowed_tools, vec!["catalog_list"]);
    policy
        .connectors
        .bindings
        .get_mut(a.to_str().unwrap())
        .unwrap()
        .get_mut("test-catalog")
        .unwrap()
        .push("catalog.write".into());
    assert_eq!(resolve(&policy, &a)[0].allowed_tools.len(), 2);
    policy
        .projects
        .get_mut(a.to_str().unwrap())
        .unwrap()
        .allowed = false;
    assert!(resolve(&policy, &a).is_empty());
    assert!(resolve(&policy, &b).is_empty());
    policy.connectors.registry.clear();
    assert!(policy.connectors.validate().is_err());
    assert!(!parse(Some(&serde_json::to_string(&policy).unwrap()))
        .rejected
        .is_empty());
}
#[test]
fn manifest_validation_rejects_unsupported_auth_duplicate_inventory_and_unknown_scopes() {
    let (_temp, policy, _, _) = setup();
    let manifest = &policy.connectors.registry["test-catalog"].manifest;
    for field in ["auth", "schema", "transport", "version", "id"] {
        let mut value = serde_json::to_value(manifest).unwrap();
        value[field] = json!("invalid!");
        assert!(
            serde_json::from_value::<Manifest>(value)
                .unwrap()
                .validate()
                .is_err(),
            "{field}"
        );
    }
    let mut changed = manifest.clone();
    changed.tools.push(changed.tools[0].clone());
    assert!(changed.validate().is_err());
    let mut changed = manifest.clone();
    changed.tools[0].scopes = vec!["unknown".into()];
    assert!(changed.validate().is_err());
    let mut changed = manifest.clone();
    changed.launch.args.push("${AGENT_CHOICE}".into());
    assert!(changed.validate().is_err());
    let mut changed = manifest.clone();
    changed
        .launch
        .env
        .insert("AURIC_PROJECT_ROOT".into(), "/wrong".into());
    assert!(changed.validate().is_err());
}

#[test]
fn environment_only_core_bridge_never_gets_connector_or_briefing() {
    let (_temp, policy, a, _) = setup();
    let adapter = DynamicProvider::new(serde_json::from_value(json!({
        "id": "antigravity", "name": "env bridge", "executable": "printf", "arguments": [],
        "projectBinding": { "environment": { "AURIC_MCP_CONFIG": "{mcpConfigPath}" } },
        "info": { "models": [], "permissionModes": [], "defaultModel": "auto", "defaultPermissionMode": "default" },
        "versionCheck": { "command": "printf", "args": [] }, "promptTemplate": "printf "
    })).unwrap());
    let effective =
        for_provider(resolve(&policy, &a), "antigravity", &adapter, binding(&a)).unwrap();
    assert!(effective.is_empty());
    assert_eq!(launch_context("task", &effective), "task");
}
#[test]
fn removed_manifest_disables_and_unrelated_save_keeps_disabled_registration() {
    let (_temp, policy, a, _) = setup();
    std::fs::remove_file(&policy.connectors.registry["test-catalog"].path).unwrap();
    assert!(resolve(&policy, &a).is_empty());
    assert!(validate_registration_changes(&policy.connectors, &policy.connectors).is_ok());
    assert!(
        validate_registration_changes(&ConnectorPolicy::default(), &policy.connectors).is_err()
    );
}
#[test]
fn approval_race_cannot_pin_reviewed_bytes_to_a_different_definition() {
    let (_temp, policy, _, _) = setup();
    assert!(validate_registration_changes(&ConnectorPolicy::default(), &policy.connectors).is_ok());
    let path = &policy.connectors.registry["test-catalog"].path;
    std::fs::write(
        path,
        std::fs::read_to_string(path)
            .unwrap()
            .replace("Use catalog_list", "Changed briefing"),
    )
    .unwrap();
    assert!(
        validate_registration_changes(&ConnectorPolicy::default(), &policy.connectors).is_err()
    );
}
#[test]
fn placeholders_in_host_paths_are_not_expanded_again() {
    assert_eq!(
        substitute_arg(
            "${AURIC_PROJECT_NAME}|${AURIC_PROJECT_ROOT}",
            "${AURIC_PROJECT_ROOT}",
            "/root/${AURIC_PROJECT_NAME}"
        ),
        "${AURIC_PROJECT_ROOT}|/root/${AURIC_PROJECT_NAME}"
    );
}
#[cfg(unix)]
#[test]
fn canonical_logical_project_grants_follow_neither_cwd_nor_project_database_changes() {
    use std::os::unix::fs::symlink;
    let (temp, policy, a, b) = setup();
    let alias = temp.path().join("logical-alias");
    symlink(&a, &alias).unwrap();
    let binding =
        crate::agents::project_binding::resolve_project_binding(Some(alias.to_str().unwrap()))
            .unwrap()
            .unwrap();
    std::fs::write(
        b.join(".auric/project.db"),
        serde_json::to_string(&policy).unwrap(),
    )
    .unwrap();
    let worktree_cwd = temp.path().join("execution-worktree");
    std::fs::create_dir(&worktree_cwd).unwrap();
    assert_eq!(
        resolve(&policy, binding.project_root())[0].args,
        vec!["project a".to_string(), a.to_string_lossy().into_owned()]
    );
    assert!(resolve(&policy, &b).is_empty());
    assert!(resolve(&policy, &worktree_cwd).is_empty());
}
