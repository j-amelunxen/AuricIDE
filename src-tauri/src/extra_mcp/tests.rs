use super::*;
use serde_json::json;
use std::path::Path;

fn project(file: Option<&str>) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    if let Some(content) = file {
        std::fs::write(dir.path().join(FILE_NAME), content).unwrap();
    }
    dir
}

fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

const SAMPLE: &str = r#"{"mcpServers":{
  "motion": {"command":"npx","args":["-y","motion-mcp"],"env":{"TOKEN":"secret-value"}},
  "docs": {"type":"http","url":"https://example.test/mcp","headers":{"Authorization":"Bearer secret-value"}},
  "legacy": {"type":"sse","url":"https://example.test/sse"},
  "broken": {"args":["x"]},
  "bad env": {"command":"x"},
  "auric-pm": {"command":"evil"},
  "typed": {"command":"x","env":{"A":1}}
}}"#;

#[test]
fn missing_file_skips_every_name_without_failing() {
    let dir = project(None);
    let resolved = resolve_names(&names(&["motion"]), dir.path());
    assert!(resolved.servers.is_empty());
    assert_eq!(resolved.skipped[0].reason, "not found in .mcp.json");
}

#[test]
fn no_names_reads_nothing() {
    let dir = project(Some("not json"));
    assert_eq!(resolve_names(&[], dir.path()), Resolved::default());
}

#[test]
fn invalid_json_skips_all_with_a_reason_that_holds_no_content() {
    let dir = project(Some("{ \"mcpServers\": secret-value"));
    let resolved = resolve_names(&names(&["a", "b"]), dir.path());
    assert_eq!(resolved.skipped.len(), 2);
    assert!(resolved
        .skipped
        .iter()
        .all(|s| !s.reason.contains("secret")));
    assert!(resolved.skipped[0].reason.contains("not valid JSON"));
}

#[test]
fn picks_only_the_named_servers_and_classifies_transports() {
    let dir = project(Some(SAMPLE));
    let resolved = resolve_names(&names(&["motion", "docs", "legacy"]), dir.path());
    assert!(resolved.skipped.is_empty());
    assert!(matches!(
        resolved.servers[0].transport,
        ExtraTransport::Stdio { .. }
    ));
    assert!(matches!(
        resolved.servers[1].transport,
        ExtraTransport::Remote {
            kind: RemoteKind::Http,
            ..
        }
    ));
    assert!(matches!(
        resolved.servers[2].transport,
        ExtraTransport::Remote {
            kind: RemoteKind::Sse,
            ..
        }
    ));
}

#[test]
fn invalid_entries_reserved_and_unknown_names_are_skipped_with_reasons() {
    let dir = project(Some(SAMPLE));
    let resolved = resolve_names(
        &names(&["broken", "bad env", "auric-pm", "typed", "ghost", "motion"]),
        dir.path(),
    );
    assert_eq!(resolved.servers.len(), 1);
    let reasons: Vec<_> = resolved.skipped.iter().map(|s| s.reason.as_str()).collect();
    assert_eq!(
        reasons,
        [
            "neither command nor url",
            "the name is not letters, digits, _ or -",
            "the name is reserved by the IDE",
            "env must be strings",
            "not found in .mcp.json",
        ]
    );
}

#[test]
fn merge_keeps_built_in_servers_on_a_name_clash() {
    let mut servers = serde_json::Map::new();
    servers.insert("auric-pm".into(), json!({"command":"builtin"}));
    let extras = [
        parse_definition("auric-pm", &json!({"command":"evil"})).unwrap(),
        parse_definition("motion", &json!({"command":"npx","args":["a"]})).unwrap(),
    ];
    let added = merge_into(&mut servers, &extras);
    assert_eq!(added, ["motion"]);
    assert_eq!(servers["auric-pm"]["command"], "builtin");
    assert_eq!(servers["motion"]["args"], json!(["a"]));
}

#[test]
fn config_value_passes_env_and_headers_through_unchanged() {
    let stdio = parse_definition("a", &json!({"command":"c","env":{"K":"${HOME}/x"}})).unwrap();
    assert_eq!(config_value(&stdio)["env"]["K"], "${HOME}/x");
    let remote = parse_definition(
        "b",
        &json!({"type":"http","url":"https://h.test","headers":{"X":"v"}}),
    )
    .unwrap();
    let value = config_value(&remote);
    assert_eq!(value["type"], "http");
    assert_eq!(value["headers"]["X"], "v");
}

#[test]
fn codex_drops_sse_servers_and_says_so() {
    let dir = project(Some(SAMPLE));
    let resolved = for_provider(
        "codex",
        resolve_names(&names(&["motion", "legacy"]), dir.path()),
    );
    assert_eq!(resolved.servers.len(), 1);
    assert_eq!(resolved.skipped[0].name, "legacy");
    let claude = for_provider("claude", resolve_names(&names(&["legacy"]), dir.path()));
    assert_eq!(claude.servers.len(), 1);
}

#[test]
fn inspect_lists_names_and_transports_but_no_values() {
    let dir = project(Some(SAMPLE));
    let found = inspect(dir.path());
    assert!(found.file_found);
    let by_name = |n: &str| found.servers.iter().find(|s| s.name == n).unwrap();
    assert_eq!(by_name("motion").transport, "stdio");
    assert_eq!(by_name("docs").transport, "http");
    assert_eq!(by_name("broken").transport, "invalid");
    assert!(by_name("auric-pm").problem.is_some());
    let text = serde_json::to_string(&found).unwrap();
    assert!(!text.contains("secret-value") && !text.contains("example.test"));
}

#[test]
fn inspect_without_file_or_with_broken_file() {
    assert_eq!(inspect(project(None).path()), Inspection::default());
    let broken = inspect(project(Some("[")).path());
    assert!(broken.file_found && broken.error.is_some() && broken.servers.is_empty());
    let wrong = inspect(project(Some(r#"{"mcpServers":[]}"#)).path());
    assert!(wrong.error.unwrap().contains("not an object"));
}

#[test]
fn oversized_or_directory_mcp_json_is_refused() {
    let dir = project(None);
    std::fs::create_dir(dir.path().join(FILE_NAME)).unwrap();
    assert!(read_project_servers(dir.path()).is_err());
    let big = project(Some(&" ".repeat(300_000)));
    assert!(read_project_servers(big.path()).is_err());
    let _ = Path::new("");
}

fn policy_with(
    root: &Path,
    allowed: bool,
    servers: &[&str],
) -> crate::supervisor::policy::SupervisorPolicy {
    let mut policy = crate::supervisor::policy::SupervisorPolicy::default();
    policy.projects.insert(
        root.to_string_lossy().into_owned(),
        crate::supervisor::policy::ProjectRules {
            allowed,
            extra_mcp_servers: names(servers),
            ..Default::default()
        },
    );
    policy
}

#[test]
fn resolve_needs_a_listed_allowed_project() {
    let dir = project(Some(SAMPLE));
    let root = dir.path().canonicalize().unwrap();
    assert_eq!(
        resolve(&policy_with(&root, true, &["motion"]), &root)
            .servers
            .len(),
        1
    );
    assert!(resolve(&policy_with(&root, false, &["motion"]), &root)
        .servers
        .is_empty());
    assert!(resolve(&Default::default(), &root).servers.is_empty());
}

#[test]
fn policy_file_round_trips_and_dedupes_extra_servers() {
    let raw =
        r#"{"version":1,"projects":{"/p":{"allowed":true,"extraMcpServers":["a"," a ","b",""]}}}"#;
    let parsed = crate::supervisor::policy::parse(Some(raw));
    assert!(parsed.rejected.is_empty());
    assert_eq!(parsed.policy.projects["/p"].extra_mcp_servers, ["a", "b"]);
    let bad = r#"{"version":1,"projects":{"/p":{"extraMcpServers":"a"}}}"#;
    assert_eq!(
        crate::supervisor::policy::parse(Some(bad)).rejected.len(),
        1
    );
    let written = serde_json::to_string(&parsed.policy).unwrap();
    assert!(written.contains("extraMcpServers"));
}

#[test]
fn agent_config_files_carry_extras_for_claude_and_crush_formats() {
    let dir = tempfile::tempdir().unwrap();
    let extras = resolve_names(&names(&["motion", "docs"]), project(Some(SAMPLE)).path()).servers;
    let configs = crate::mcp::write_agent_mcp_configs_with_connectors(
        dir.path(),
        Path::new("/rt"),
        "node",
        Path::new("/repo/p"),
        &Default::default(),
        &[],
        &extras,
    )
    .unwrap();
    let standard: Value =
        serde_json::from_slice(&std::fs::read(configs.standard).unwrap()).unwrap();
    assert!(standard["mcpServers"]["auric-pm"].is_object());
    assert_eq!(standard["mcpServers"]["motion"]["command"], "npx");
    assert_eq!(
        standard["mcpServers"]["docs"]["url"],
        "https://example.test/mcp"
    );
    let crush: Value = serde_json::from_slice(&std::fs::read(configs.crush).unwrap()).unwrap();
    assert_eq!(crush["mcp"]["motion"]["type"], "stdio");
    assert_eq!(crush["mcp"]["docs"]["type"], "http");
}

#[test]
fn codex_gets_command_line_overrides_and_nothing_for_no_extras() {
    let extras = resolve_names(&names(&["motion", "docs"]), project(Some(SAMPLE)).path()).servers;
    let mut binding =
        crate::providers::ProviderProjectBinding::new("/p", "/p/db").with_runtime_entrypoint("/rt");
    binding.extra_servers = extras;
    let args = crate::providers::codex_project_binding_injection(&binding)
        .unwrap()
        .arguments
        .join(" ");
    assert!(args.contains("mcp_servers.motion.command=\"npx\""));
    assert!(args.contains("mcp_servers.motion.env={\"TOKEN\"=\"secret-value\"}"));
    assert!(args.contains("mcp_servers.docs.url=\"https://example.test/mcp\""));
    assert!(args.contains("mcp_servers.docs.http_headers="));
    binding.extra_servers = Vec::new();
    let plain = crate::providers::codex_project_binding_injection(&binding)
        .unwrap()
        .arguments
        .join(" ");
    assert!(!plain.contains("motion"));
}
