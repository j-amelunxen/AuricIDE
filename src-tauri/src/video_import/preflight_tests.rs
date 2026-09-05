use super::*;

fn check(id: &str, ok: bool) -> PreflightCheck {
    PreflightCheck {
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

#[test]
fn path_lookup_walks_entries_in_order() {
    let exists = |path: &Path| path == Path::new("/opt/homebrew/bin/ffmpeg");
    assert_eq!(
        resolve_in_path("ffmpeg", "/usr/bin:/opt/homebrew/bin", &exists),
        Some(PathBuf::from("/opt/homebrew/bin/ffmpeg"))
    );
}

#[test]
fn path_lookup_reports_absence_rather_than_a_bare_name() {
    let exists = |_: &Path| false;
    assert_eq!(resolve_in_path("ffmpeg", "/usr/bin:/bin", &exists), None);
    assert_eq!(resolve_in_path("ffmpeg", "", &exists), None);
}

#[test]
fn an_explicit_path_is_checked_not_searched() {
    let exists = |path: &Path| path == Path::new("/custom/parakeet");
    assert_eq!(
        resolve_in_path("/custom/parakeet", "/usr/bin", &exists),
        Some(PathBuf::from("/custom/parakeet"))
    );
    assert_eq!(
        resolve_in_path("/missing/parakeet", "/usr/bin", &exists),
        None
    );
}
