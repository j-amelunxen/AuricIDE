use super::*;
use serde_json::Value;

fn row(name: &str) -> &'static Dependency {
    dependency(name).expect("declared row")
}

fn at(path: &str, outside_path: bool) -> Option<Resolved> {
    Some(Resolved {
        path: PathBuf::from(path),
        outside_path,
    })
}

fn judged(name: &str, resolved: Option<Resolved>, probe: Option<VersionProbe>) -> Check {
    row(name).judge(&Observation { resolved, probe }, false)
}

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../src/lib/agents/supervisorManagers.fixtures.json"
    ))
    .unwrap()
}

fn triple(value: &Value) -> Version {
    let text = value.as_str().unwrap();
    parse_version(&format!("v{text}"), r"^v(\d+)\.(\d+)\.(\d+)").unwrap()
}

#[test]
fn the_table_declares_the_four_tools_in_order() {
    let names: Vec<_> = DEPENDENCIES.iter().map(|row| row.name).collect();
    assert_eq!(names, ["ffmpeg", "ffprobe", "go", "okf"]);
}

#[test]
fn every_version_pattern_compiles() {
    for row in DEPENDENCIES {
        assert!(
            regex::Regex::new(row.version_pattern).is_ok(),
            "{} has a broken pattern",
            row.name
        );
    }
}

#[test]
fn okf_and_go_rows_agree_with_the_contract_fixture() {
    let machine = &fixture()["machine"];
    for name in ["okf", "go"] {
        let declared = &machine[name];
        let table = row(name);
        assert_eq!(
            table.minimum,
            Some(triple(&declared["minVersion"])),
            "{name} minimum"
        );
        assert_eq!(table.fix, declared["fix"].as_str().unwrap(), "{name} fix");
        let args: Vec<_> = declared["versionArgs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|arg| arg.as_str().unwrap())
            .collect();
        assert_eq!(table.version_args, args.as_slice(), "{name} args");
        assert_eq!(
            table.version_pattern,
            declared["versionPattern"].as_str().unwrap(),
            "{name} pattern"
        );
    }
    assert_eq!(row("okf").extra_dirs, ["~/go/bin"]);
}

#[test]
fn okf_reads_the_captured_version_and_not_an_older_one() {
    let captured = include_str!("testdata/okf-version.txt")
        .lines()
        .last()
        .unwrap();
    let okf = row("okf");
    assert_eq!(
        parse_version(captured, okf.version_pattern),
        Some((0, 7, 0))
    );
    assert_eq!(
        parse_version(
            "okf version v0.4.4 (OKF v0.1 specification)",
            okf.version_pattern
        ),
        Some((0, 4, 4))
    );
}

#[test]
fn ffmpeg_and_go_read_what_their_tools_print() {
    assert_eq!(
        parse_version(
            "ffmpeg version 7.1.1 Copyright (c) 2000-2025 the FFmpeg developers",
            row("ffmpeg").version_pattern
        ),
        Some((7, 1, 1))
    );
    assert_eq!(
        parse_version(
            "ffprobe version n6.0 Copyright",
            row("ffprobe").version_pattern
        ),
        Some((6, 0, 0))
    );
    assert_eq!(
        parse_version(
            "go version go1.25.6 darwin/arm64",
            row("go").version_pattern
        ),
        Some((1, 25, 6))
    );
}

#[test]
fn a_missing_tool_names_the_fix() {
    let check = judged("go", None, None);
    assert!(!check.ok);
    assert_eq!(check.found, None);
    assert_eq!(check.requirement, "go 1.21.0 or newer");
    assert_eq!(check.fix.as_deref(), Some("brew install go"));
    assert_eq!(check.detail, "go was not found.");
}

#[test]
fn okf_missing_with_go_present_offers_the_install_line() {
    let check = row("okf").judge(
        &Observation {
            resolved: None,
            probe: None,
        },
        false,
    );
    assert_eq!(check.fix.as_deref(), Some(row("okf").fix));
}

#[test]
fn okf_missing_without_go_offers_go_first() {
    let check = row("okf").judge(
        &Observation {
            resolved: None,
            probe: None,
        },
        true,
    );
    assert_eq!(check.fix.as_deref(), Some("brew install go"));
}

#[test]
fn a_current_version_passes_and_shows_the_version() {
    let check = judged(
        "okf",
        at("/usr/local/bin/okf", false),
        Some(VersionProbe::Version((0, 7, 0))),
    );
    assert!(check.ok);
    assert_eq!(check.found.as_deref(), Some("0.7.0"));
    assert_eq!(check.requirement, "okf 0.7.0 or newer");
    assert_eq!(check.fix, None);
}

#[test]
fn an_older_version_fails_with_the_fix() {
    let check = judged(
        "okf",
        at("/usr/local/bin/okf", false),
        Some(VersionProbe::Version((0, 4, 4))),
    );
    assert!(!check.ok);
    assert_eq!(check.found.as_deref(), Some("0.4.4"));
    assert_eq!(check.fix.as_deref(), Some(row("okf").fix));
}

#[test]
fn a_binary_outside_path_is_ok_and_says_where() {
    let check = judged(
        "okf",
        at("/Users/dev/go/bin/okf", true),
        Some(VersionProbe::Version((0, 7, 0))),
    );
    assert!(check.ok);
    assert_eq!(
        check.found.as_deref(),
        Some("0.7.0 (found outside PATH, at /Users/dev/go/bin/okf)")
    );
}

#[test]
fn a_tool_that_does_not_answer_fails_without_a_fix() {
    let check = judged("go", at("/usr/local/bin/go", false), None);
    assert!(!check.ok);
    assert_eq!(check.found.as_deref(), Some("/usr/local/bin/go"));
    assert_eq!(
        check.detail,
        "go was found but did not respond to 'go version'."
    );
    assert_eq!(check.fix, None);
}

#[test]
fn an_unreadable_version_fails_when_a_minimum_applies() {
    let check = judged(
        "okf",
        at("/usr/local/bin/okf", false),
        Some(VersionProbe::Unreadable),
    );
    assert!(!check.ok);
    assert!(check.detail.contains("could not be read"));
}

#[test]
fn an_unreadable_version_is_fine_when_no_minimum_applies() {
    let check = judged(
        "ffmpeg",
        at("/opt/homebrew/bin/ffmpeg", false),
        Some(VersionProbe::Unreadable),
    );
    assert!(check.ok);
    assert_eq!(check.found.as_deref(), Some("/opt/homebrew/bin/ffmpeg"));
}

#[test]
fn the_report_adds_the_features_to_the_check_on_the_wire() {
    let report = DependencyReport {
        check: judged("ffmpeg", None, None),
        features: vec!["Video import".to_string()],
        version: None,
        path: None,
        outside_path: false,
    };
    let json: Value = serde_json::to_value(&report).unwrap();
    assert_eq!(json["id"], "ffmpeg");
    assert_eq!(json["ok"], false);
    assert_eq!(json["features"][0], "Video import");
    assert_eq!(json["outsidePath"], false);
}

#[test]
fn the_location_is_structured_not_a_display_string() {
    let observation = Observation {
        resolved: at("/Users/dev/go/bin/okf", true),
        probe: Some(VersionProbe::Version((0, 7, 0))),
    };
    assert_eq!(
        observation.location(),
        (
            Some("0.7.0".to_string()),
            Some("/Users/dev/go/bin/okf".to_string()),
            true
        )
    );
}

#[test]
fn an_unreadable_version_still_has_a_path_and_a_missing_tool_has_nothing() {
    let unreadable = Observation {
        resolved: at("/opt/homebrew/bin/ffmpeg", false),
        probe: Some(VersionProbe::Unreadable),
    };
    assert_eq!(
        unreadable.location(),
        (None, Some("/opt/homebrew/bin/ffmpeg".to_string()), false)
    );
    let missing = Observation {
        resolved: None,
        probe: None,
    };
    assert_eq!(missing.location(), (None, None, false));
}

#[tokio::test]
#[ignore = "depends on what is installed on the machine running it"]
async fn inspects_every_declared_tool_on_this_machine() {
    let reports = inspect_all().await;
    for report in &reports {
        println!(
            "{:<8} ok={:<5} found={:?} fix={:?} detail={}",
            report.check.id,
            report.check.ok,
            report.check.found,
            report.check.fix,
            report.check.detail
        );
    }
    assert_eq!(reports.len(), DEPENDENCIES.len());
    for report in &reports {
        assert!(!report.check.detail.is_empty());
        assert!(!report.check.requirement.is_empty());
        assert!(!report.features.is_empty());
    }
}
