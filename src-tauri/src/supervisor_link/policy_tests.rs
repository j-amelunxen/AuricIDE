use super::*;
use crate::supervisor_link::test_support::{diagram_type, draw_kind};

const FIXTURES: &str = include_str!("../../../src/lib/agents/supervisorLink.fixtures.json");

fn fixtures() -> serde_json::Value {
    serde_json::from_str(FIXTURES).unwrap()
}

fn real(path: &Path) -> String {
    path.canonicalize().unwrap().to_str().unwrap().to_string()
}

fn config() -> ProjectConfig {
    ProjectConfig {
        document_types: vec![diagram_type()],
        job_kinds: vec![draw_kind()],
    }
}

#[test]
fn file_name_and_limits_are_the_fixture() {
    let fixtures = fixtures();
    assert_eq!(fixtures["policyFileName"], POLICY_FILE_NAME);
    assert_eq!(fixtures["policyVersion"], POLICY_VERSION);
    assert_eq!(fixtures["jobs"]["defaultDailyLimit"], DEFAULT_DAILY_LIMIT);
    assert_eq!(fixtures["jobs"]["maxDailyLimit"], MAX_DAILY_LIMIT);
}

#[test]
fn a_written_policy_reads_back_canonical_with_its_configuration() {
    let app = tempfile::tempdir().unwrap();
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let mut projects = BTreeMap::new();
    projects.insert(
        b.path().to_str().unwrap().to_string(),
        ProjectConfig::default(),
    );
    projects.insert(a.path().to_str().unwrap().to_string(), config());
    let limits = JobLimits {
        daily_limit: 5,
        per_project_daily_limit: Some(2),
    };
    let stored = write_policy(
        app.path(),
        &LinkPolicy {
            projects,
            jobs: limits,
        },
    )
    .unwrap();
    assert_eq!(stored.projects.len(), 2);
    assert_eq!(stored.projects[&real(a.path())], config());
    assert_eq!(stored.jobs, limits);
    assert_eq!(read_policy(app.path()), stored);

    let on_disk: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(policy_path_in(app.path())).unwrap())
            .unwrap();
    assert_eq!(on_disk["version"], 2);
    assert_eq!(on_disk["jobs"]["dailyLimit"], 5);
}

#[test]
fn version_one_migrates_to_its_one_document_type() {
    let project = tempfile::tempdir().unwrap();
    let listed = project.path().to_str().unwrap();
    let policy = parse_policy(&format!(
        r#"{{ "version": 1, "scenes": {{ "projects": ["{listed}", "relative/dir"] }} }}"#
    ));
    let migrated = &fixtures()["migration"]["v1DocumentType"];
    assert_eq!(policy.projects.len(), 1);
    let config = &policy.projects[&real(project.path())];
    assert_eq!(
        serde_json::to_value(&config.document_types[0]).unwrap(),
        *migrated
    );
    assert!(config.job_kinds.is_empty());
    assert_eq!(policy.jobs, JobLimits::default());
}

#[test]
fn the_migration_is_idempotent_and_a_save_makes_it_version_two() {
    let app = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let listed = project.path().to_str().unwrap();
    let path = policy_path_in(app.path());
    std::fs::write(
        &path,
        format!(r#"{{ "version": 1, "scenes": {{ "projects": ["{listed}"] }} }}"#),
    )
    .unwrap();
    // Reading does not write: a version-1 file reads the same every time.
    let first = read_policy(app.path());
    assert_eq!(read_policy(app.path()), first);
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("\"version\": 1"));

    // Saving what was read writes version 2 with the same meaning, and saving
    // that again changes nothing.
    let stored = write_policy(app.path(), &first).unwrap();
    assert_eq!(stored, first);
    let once = std::fs::read_to_string(&path).unwrap();
    assert_eq!(read_policy(app.path()), first);
    write_policy(app.path(), &read_policy(app.path())).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), once);
    let on_disk: serde_json::Value = serde_json::from_str(&once).unwrap();
    assert_eq!(on_disk["version"], 2);
}

#[test]
fn a_missing_broken_or_foreign_file_shows_nothing() {
    let app = tempfile::tempdir().unwrap();
    assert_eq!(read_policy(app.path()), LinkPolicy::default());
    for text in [
        "",
        "not json",
        "[]",
        r#"{ "version": 3, "projects": {} }"#,
        r#"{ "projects": {} }"#,
        r#"{ "version": 1 }"#,
        r#"{ "version": 2, "projects": [] }"#,
    ] {
        assert_eq!(parse_policy(text), LinkPolicy::default(), "{text}");
    }
}

#[test]
fn an_invalid_project_entry_is_dropped_and_the_others_kept() {
    let good = tempfile::tempdir().unwrap();
    let bad = tempfile::tempdir().unwrap();
    let text = format!(
        r#"{{ "version": 2, "projects": {{
            "{good}": {{ "documentTypes": [{{ "name": "diagram", "globs": ["docs/*.json"] }}] }},
            "{bad}": {{ "documentTypes": [{{ "name": "x", "globs": ["../outside/*.json"] }}] }},
            "relative": {{}}
        }} }}"#,
        good = good.path().display(),
        bad = bad.path().display()
    );
    let policy = parse_policy(&text);
    assert_eq!(
        policy.projects.keys().cloned().collect::<Vec<_>>(),
        vec![real(good.path())]
    );
}

#[test]
fn invalid_configurations_are_refused_by_name_and_nothing_is_written() {
    let app = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let path = project.path().to_str().unwrap().to_string();
    for case in fixtures()["policyRejects"].as_array().unwrap() {
        let config: ProjectConfig = serde_json::from_value(case["config"].clone()).unwrap();
        let policy = LinkPolicy {
            projects: [(path.clone(), config)].into(),
            ..LinkPolicy::default()
        };
        let error = write_policy(app.path(), &policy).unwrap_err();
        let expected = case["mentions"].as_str().unwrap();
        assert!(error.contains(expected), "{}: {error}", case["name"]);
        assert!(!policy_path_in(app.path()).exists());
    }
    let relative = LinkPolicy {
        projects: [("projects/accounting".to_string(), ProjectConfig::default())].into(),
        ..LinkPolicy::default()
    };
    assert!(write_policy(app.path(), &relative)
        .unwrap_err()
        .contains("projects/accounting"));
    let too_many = LinkPolicy {
        jobs: JobLimits {
            daily_limit: MAX_DAILY_LIMIT + 1,
            per_project_daily_limit: None,
        },
        ..LinkPolicy::default()
    };
    assert!(write_policy(app.path(), &too_many).is_err());
    assert!(!policy_path_in(app.path()).exists());
}

#[test]
fn a_hand_edited_counter_above_the_maximum_is_clamped() {
    let policy =
        parse_policy(r#"{ "version": 2, "projects": {}, "jobs": { "dailyLimit": 99999 } }"#);
    assert_eq!(policy.jobs.daily_limit, MAX_DAILY_LIMIT);
}

#[test]
fn a_kind_without_writes_may_write_the_document_types() {
    let config = config();
    assert_eq!(
        config.writes_of(&draw_kind()),
        vec!["docs/**/*.diagram.json"]
    );
    let narrow = JobKind {
        writes: vec!["docs/only/*.json".into()],
        ..draw_kind()
    };
    assert_eq!(config.writes_of(&narrow), vec!["docs/only/*.json"]);
}

#[cfg(unix)]
#[test]
fn the_file_is_private() {
    use std::os::unix::fs::PermissionsExt;
    let app = tempfile::tempdir().unwrap();
    write_policy(app.path(), &LinkPolicy::default()).unwrap();
    let mode = std::fs::metadata(policy_path_in(app.path()))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
}

#[cfg(unix)]
#[test]
fn a_symlinked_project_is_stored_and_matched_as_its_target() {
    let app = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let links = tempfile::tempdir().unwrap();
    let link = links.path().join("alias");
    std::os::unix::fs::symlink(target.path(), &link).unwrap();
    let stored = write_policy(
        app.path(),
        &LinkPolicy {
            projects: [(link.to_str().unwrap().to_string(), ProjectConfig::default())].into(),
            ..LinkPolicy::default()
        },
    )
    .unwrap();
    assert!(stored.projects.contains_key(&real(target.path())));
    assert!(stored.project(link.to_str().unwrap()).is_some());
    assert!(stored.project(target.path().to_str().unwrap()).is_some());
    assert!(stored.project(links.path().to_str().unwrap()).is_none());
}
