use super::dynamic_tests::get_claude_config;
use super::*;
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, RwLock};

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
