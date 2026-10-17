use super::*;
use crate::supervisor_link::test_support::{diagram_type, draw_kind};

const FIXTURES: &str = include_str!("../../../src/lib/agents/supervisorLink.fixtures.json");

fn fixtures() -> serde_json::Value {
    serde_json::from_str(FIXTURES).unwrap()
}

fn real(path: &Path) -> String {
    path.canonicalize().unwrap().to_str().unwrap().to_string()
}

fn entry() -> ProjectEntry {
    ProjectEntry {
        document_types: vec![diagram_type()],
        job_kinds: vec![draw_kind()],
        ..ProjectEntry::default()
    }
}

fn config() -> ProjectConfig {
    ProjectConfig {
        document_types: vec![diagram_type()],
        job_kinds: vec![draw_kind()],
    }
}

fn listing(path: &str, entry: ProjectEntry) -> StoredPolicy {
    StoredPolicy {
        projects: [(path.to_string(), entry)].into(),
        ..StoredPolicy::default()
    }
}

#[test]
fn file_name_and_limits_are_the_fixture() {
    let fixtures = fixtures();
    assert_eq!(fixtures["policyFileName"], POLICY_FILE_NAME);
    assert_eq!(fixtures["policyVersion"], POLICY_VERSION);
    assert_eq!(fixtures["jobs"]["defaultDailyLimit"], DEFAULT_DAILY_LIMIT);
    assert_eq!(fixtures["jobs"]["maxDailyLimit"], MAX_DAILY_LIMIT);
    assert_eq!(fixtures["globalInstructions"]["dirName"], JOB_KINDS_DIR);
}

#[test]
fn a_written_policy_reads_back_canonical_with_its_configuration() {
    let app = tempfile::tempdir().unwrap();
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let mut projects = BTreeMap::new();
    projects.insert(
        b.path().to_str().unwrap().to_string(),
        ProjectEntry::default(),
    );
    projects.insert(a.path().to_str().unwrap().to_string(), entry());
    let limits = JobLimits {
        daily_limit: 5,
        per_project_daily_limit: Some(2),
    };
    let stored = write_stored(
        app.path(),
        &StoredPolicy {
            projects,
            jobs: limits,
            ..StoredPolicy::default()
        },
    )
    .unwrap();
    assert_eq!(stored.projects.len(), 2);
    assert_eq!(stored.projects[&real(a.path())], entry());
    assert_eq!(read_stored(app.path()), stored);
    let effective = read_policy(app.path());
    assert_eq!(effective.projects[&real(a.path())], config());
    assert_eq!(effective.jobs, limits);
    assert_eq!(
        effective.job_kinds_dir,
        Some(app.path().join(JOB_KINDS_DIR))
    );

    let on_disk: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(policy_path_in(app.path())).unwrap())
            .unwrap();
    assert_eq!(on_disk["version"], 3);
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
fn version_two_reads_as_the_fixture_version_three() {
    let example = &fixtures()["migration"]["v2Example"];
    let stored = parse_stored(&example["file"].to_string());
    let written: serde_json::Value =
        serde_json::from_slice(&stored_payload(&stored).unwrap()).unwrap();
    assert_eq!(written, example["stored"]);
    // Version 3 written from it reads back to the same policy.
    assert_eq!(parse_stored(&written.to_string()), stored);
}

#[test]
fn a_version_two_file_with_defaults_is_not_version_two() {
    let text = r#"{ "version": 2, "defaults": { "documentTypes": [] }, "projects": {} }"#;
    assert_eq!(parse_stored(text), StoredPolicy::default());
}

#[test]
fn the_migrations_are_idempotent_and_a_save_makes_it_version_three() {
    for old in [1, 2] {
        let app = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let listed = project.path().to_str().unwrap();
        let path = policy_path_in(app.path());
        let text = if old == 1 {
            format!(r#"{{ "version": 1, "scenes": {{ "projects": ["{listed}"] }} }}"#)
        } else {
            format!(
                r#"{{ "version": 2, "projects": {{ "{listed}": {{ "documentTypes":
                [{{ "name": "diagram", "globs": ["docs/*.json"] }}] }} }} }}"#
            )
        };
        std::fs::write(&path, &text).unwrap();
        // Reading does not write: an old file reads the same every time.
        let first = read_stored(app.path());
        assert_eq!(read_stored(app.path()), first);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);

        // Saving what was read writes version 3 with the same meaning, and
        // saving that again changes nothing.
        let effective = read_policy(app.path());
        assert_eq!(write_stored(app.path(), &first).unwrap(), first);
        let once = std::fs::read_to_string(&path).unwrap();
        assert_eq!(read_policy(app.path()), effective);
        write_stored(app.path(), &read_stored(app.path())).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), once);
        let on_disk: serde_json::Value = serde_json::from_str(&once).unwrap();
        assert_eq!(on_disk["version"], 3, "from version {old}");
    }
}

#[test]
fn a_missing_broken_or_foreign_file_shows_nothing() {
    let app = tempfile::tempdir().unwrap();
    assert_eq!(
        read_policy(app.path()),
        LinkPolicy {
            job_kinds_dir: Some(app.path().join(JOB_KINDS_DIR)),
            ..LinkPolicy::default()
        }
    );
    for text in [
        "",
        "not json",
        "[]",
        r#"{ "version": 4, "projects": {} }"#,
        r#"{ "projects": {} }"#,
        r#"{ "version": 1 }"#,
        r#"{ "version": 2, "projects": [] }"#,
        r#"{ "version": 3, "projects": [] }"#,
        r#"{ "version": "3", "projects": {} }"#,
    ] {
        assert_eq!(parse_policy(text), LinkPolicy::default(), "{text}");
    }
}

#[test]
fn an_invalid_project_entry_is_dropped_and_the_others_kept() {
    let good = tempfile::tempdir().unwrap();
    let bad = tempfile::tempdir().unwrap();
    let text = format!(
        r#"{{ "version": 3, "projects": {{
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
fn invalid_defaults_are_dropped_as_a_whole() {
    let project = tempfile::tempdir().unwrap();
    let text = format!(
        r#"{{ "version": 3,
            "defaults": {{ "documentTypes": [
                {{ "name": "good", "globs": ["a/*.json"] }},
                {{ "name": "bad", "globs": ["/etc/*"] }}
            ] }},
            "projects": {{ "{}": {{}} }} }}"#,
        project.path().display()
    );
    let policy = parse_policy(&text);
    let config = &policy.projects[&real(project.path())];
    assert!(config.document_types.is_empty());
}

#[test]
fn the_resolution_cases_hold() {
    let resolution = &fixtures()["resolution"];
    let defaults: LinkDefaults = serde_json::from_value(resolution["defaults"].clone()).unwrap();
    for case in resolution["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let entry: ProjectEntry = serde_json::from_value(case["entry"].clone()).unwrap();
        let stored = StoredPolicy {
            defaults: defaults.clone(),
            projects: [("/nonexistent/example-project".to_string(), entry.clone())].into(),
            ..StoredPolicy::default()
        };
        let policy = resolve(&stored, None);
        if case["visible"] == false {
            assert!(policy.projects.is_empty(), "{name}");
            assert!(
                check_stored(&stored).is_err(),
                "{name}: a save is refused too"
            );
            continue;
        }
        let origins = policy
            .origins_of("/nonexistent/example-project")
            .unwrap_or_else(|| panic!("{name}: not visible"));
        assert_eq!(
            serde_json::to_value(&origins.document_types).unwrap(),
            case["documentTypes"],
            "{name}"
        );
        assert_eq!(
            serde_json::to_value(&origins.job_kinds).unwrap(),
            case["jobKinds"],
            "{name}"
        );
        let (config, _) = effective_project(&defaults, &entry);
        assert_eq!(policy.projects["/nonexistent/example-project"], config);
    }
}

#[test]
fn an_override_replaces_the_whole_global_definition() {
    let defaults = LinkDefaults {
        document_types: vec![diagram_type()],
        job_kinds: vec![draw_kind()],
    };
    let narrow = DocumentType {
        globs: vec!["own/*.json".into()],
        ..diagram_type()
    };
    let entry = ProjectEntry {
        document_types: vec![narrow.clone()],
        ..ProjectEntry::default()
    };
    let (config, origins) = effective_project(&defaults, &entry);
    assert_eq!(config.document_types, vec![narrow]);
    assert_eq!(origins.document_types["diagram"], Origin::Override);
    // The inherited kind now writes the overriding type's globs.
    assert_eq!(config.writes_of(&draw_kind()), vec!["own/*.json"]);
}

#[test]
fn a_project_limit_replaces_the_shared_one() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let mut stored = listing(
        a.path().to_str().unwrap(),
        ProjectEntry {
            daily_limit: Some(0),
            ..ProjectEntry::default()
        },
    );
    stored
        .projects
        .insert(b.path().to_str().unwrap().into(), ProjectEntry::default());
    stored.jobs = JobLimits {
        daily_limit: 10,
        per_project_daily_limit: Some(3),
    };
    let policy = resolve(&check_stored(&stored).unwrap(), None);
    assert_eq!(
        policy.limits_for(a.path().to_str().unwrap()),
        JobLimits {
            daily_limit: 10,
            per_project_daily_limit: Some(0),
        }
    );
    assert_eq!(
        policy
            .limits_for(b.path().to_str().unwrap())
            .per_project_daily_limit,
        Some(3)
    );
}

#[test]
fn invalid_configurations_are_refused_by_name_and_nothing_is_written() {
    let app = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    let path = project.path().to_str().unwrap().to_string();
    for case in fixtures()["policyRejects"].as_array().unwrap() {
        let entry: ProjectEntry = serde_json::from_value(case["config"].clone()).unwrap();
        let expected = case["mentions"].as_str().unwrap();
        let error = write_stored(app.path(), &listing(&path, entry.clone())).unwrap_err();
        assert!(error.contains(expected), "{}: {error}", case["name"]);
        // The same entry as global defaults is refused as well, unless the
        // rule is about what a project ends up with.
        let as_defaults = StoredPolicy {
            defaults: LinkDefaults {
                document_types: entry.document_types,
                job_kinds: entry.job_kinds,
            },
            projects: [(path.clone(), ProjectEntry::default())].into(),
            ..StoredPolicy::default()
        };
        assert!(
            write_stored(app.path(), &as_defaults).is_err(),
            "{}",
            case["name"]
        );
        assert!(!policy_path_in(app.path()).exists());
    }
    let relative = listing("projects/accounting", ProjectEntry::default());
    assert!(write_stored(app.path(), &relative)
        .unwrap_err()
        .contains("projects/accounting"));
    let too_many = StoredPolicy {
        jobs: JobLimits {
            daily_limit: MAX_DAILY_LIMIT + 1,
            per_project_daily_limit: None,
        },
        ..StoredPolicy::default()
    };
    assert!(write_stored(app.path(), &too_many).is_err());
    let project_too_many = listing(
        &path,
        ProjectEntry {
            daily_limit: Some(MAX_DAILY_LIMIT + 1),
            ..ProjectEntry::default()
        },
    );
    assert!(write_stored(app.path(), &project_too_many).is_err());
    assert!(!policy_path_in(app.path()).exists());
}

#[test]
fn a_job_kind_needs_instructions_of_one_form() {
    let project = tempfile::tempdir().unwrap();
    let path = project.path().to_str().unwrap();
    let with = |instructions: Option<&str>, global: Option<&str>| {
        listing(
            path,
            ProjectEntry {
                document_types: vec![diagram_type()],
                job_kinds: vec![JobKind {
                    instructions: instructions.map(str::to_string),
                    global_instructions: global.map(str::to_string),
                    ..draw_kind()
                }],
                ..ProjectEntry::default()
            },
        )
    };
    for (instructions, global, ok) in [
        (Some("docs/a.md"), None, true),
        (None, Some("scene.draw.md"), true),
        (None, Some("kinds/scene.draw.md"), true),
        (None, Some("/opt/shared/scene.draw.md"), true),
        (Some("docs/a.md"), Some("scene.draw.md"), true),
        (None, None, false),
        (Some("/abs/a.md"), None, false),
        (None, Some("../escape.md"), false),
        (None, Some("/opt/../etc/passwd"), false),
        (None, Some(""), false),
    ] {
        assert_eq!(
            check_stored(&with(instructions, global)).is_ok(),
            ok,
            "{instructions:?} {global:?}"
        );
    }
}

#[test]
fn a_hand_edited_counter_above_the_maximum_is_clamped() {
    let policy =
        parse_policy(r#"{ "version": 3, "projects": {}, "jobs": { "dailyLimit": 99999 } }"#);
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
    write_stored(app.path(), &StoredPolicy::default()).unwrap();
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
    let stored = write_stored(
        app.path(),
        &listing(link.to_str().unwrap(), ProjectEntry::default()),
    )
    .unwrap();
    assert!(stored.projects.contains_key(&real(target.path())));
    assert!(stored.entry(link.to_str().unwrap()).is_some());
    let policy = resolve(&stored, None);
    assert!(policy.project(link.to_str().unwrap()).is_some());
    assert!(policy.project(target.path().to_str().unwrap()).is_some());
    assert!(policy.project(links.path().to_str().unwrap()).is_none());
}
