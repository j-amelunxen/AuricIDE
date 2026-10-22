use super::*;

fn check(id: &str, ok: bool) -> Check {
    Check {
        id: id.to_string(),
        label: id.to_string(),
        ok,
        found: None,
        requirement: String::new(),
        detail: String::new(),
        fix: None,
    }
}

#[test]
fn reads_the_version_uv_actually_prints() {
    assert_eq!(
        parse_uv_version("uv 0.6.6 (c1a0bb85e 2025-03-12)"),
        Some((0, 6, 6))
    );
}

#[test]
fn reads_a_prerelease_version() {
    assert_eq!(parse_uv_version("uv 0.9.0-alpha.1"), Some((0, 9, 0)));
}

#[test]
fn unreadable_version_output_is_none_rather_than_a_guess() {
    assert_eq!(parse_uv_version(""), None);
    assert_eq!(parse_uv_version("uv"), None);
    assert_eq!(parse_uv_version("command not found: uv"), None);
}

#[test]
fn version_comparison_orders_by_component_not_by_string() {
    assert!(meets_minimum((0, 10, 0), (0, 9, 0)));
    assert!(meets_minimum((0, 5, 0), MIN_UV_VERSION));
    assert!(!meets_minimum((0, 4, 30), MIN_UV_VERSION));
}

#[test]
fn only_the_runtime_check_may_fail_and_still_allow_installing() {
    let checks = vec![
        check("platform", true),
        check("uv", true),
        check(RUNTIME_CHECK_ID, false),
    ];
    assert_eq!(summarise(&checks), (false, true));
}

#[test]
fn a_failing_dependency_blocks_installing() {
    let checks = vec![
        check("platform", true),
        check("uv", false),
        check(RUNTIME_CHECK_ID, false),
    ];
    assert_eq!(summarise(&checks), (false, false));
}

#[test]
fn everything_green_is_ready() {
    let checks = vec![check("uv", true), check(RUNTIME_CHECK_ID, true)];
    assert_eq!(summarise(&checks), (true, true));
}

#[tokio::test]
#[ignore = "depends on what is installed on the machine running it"]
async fn inspects_this_machine() {
    let dir = std::env::temp_dir().join("auric-preflight-probe");
    let report = inspect(&dir).await;
    for check in &report.checks {
        println!(
            "{:<16} ok={:<5} found={:?} detail={}",
            check.label, check.ok, check.found, check.detail
        );
    }
    println!("ready={} can_install={}", report.ready, report.can_install);
    assert!(!report.checks.is_empty());
    for check in &report.checks {
        assert!(!check.detail.is_empty(), "{} has no detail", check.label);
        assert!(
            !check.requirement.is_empty(),
            "{} states no requirement",
            check.label
        );
    }
}

// The wire shape and wording the Video Import settings render. These pin the
// answer so moving the mechanism into `machine/` cannot change a byte of it.
#[test]
fn a_found_media_tool_serialises_exactly_as_before() {
    let check = media_tool_check("ffmpeg", Some(PathBuf::from("/opt/homebrew/bin/ffmpeg")));
    assert_eq!(
        serde_json::to_string(&check).unwrap(),
        r#"{"id":"ffmpeg","label":"ffmpeg","ok":true,"found":"/opt/homebrew/bin/ffmpeg","requirement":"on PATH","detail":"Found.","fix":null}"#
    );
}

#[test]
fn a_missing_media_tool_serialises_exactly_as_before() {
    let check = media_tool_check("ffprobe", None);
    assert_eq!(
        serde_json::to_string(&check).unwrap(),
        r#"{"id":"ffprobe","label":"ffprobe","ok":false,"found":null,"requirement":"on PATH","detail":"Not found. Video import needs it to read the video and extract its audio.","fix":"brew install ffmpeg"}"#
    );
}

#[test]
fn the_report_keeps_its_camel_case_fields() {
    let report = Preflight {
        ready: false,
        can_install: true,
        checks: vec![check("uv", true)],
        runtime_dir: "/runtime".to_string(),
        executable: None,
    };
    assert_eq!(
        serde_json::to_string(&report).unwrap(),
        r#"{"ready":false,"canInstall":true,"checks":[{"id":"uv","label":"uv","ok":true,"found":null,"requirement":"","detail":"","fix":null}],"runtimeDir":"/runtime","executable":null}"#
    );
}
