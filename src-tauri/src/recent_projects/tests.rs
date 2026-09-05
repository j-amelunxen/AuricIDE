use super::legacy::decode_webkit_value;
use super::store::*;
use super::types::*;
use std::fs;

fn project(path: &str, opened_at: u64) -> RecentProject {
    RecentProject {
        path: path.into(),
        name: path.trim_start_matches('/').into(),
        opened_at,
    }
}

#[test]
fn merge_keeps_latest_entry_and_orders_descending() {
    let merged = merge_projects(vec![project("/a", 1), project("/b", 2), project("/a", 3)]);
    assert_eq!(merged, vec![project("/a", 3), project("/b", 2)]);
}

#[test]
fn decodes_webkit_utf16_values() {
    let text = "[{\"path\":\"/a\"}]";
    let encoded: Vec<u8> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
    assert_eq!(decode_webkit_value(&encoded), text);
}

#[test]
fn atomic_write_keeps_previous_version_as_backup() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recent-projects.json");
    write_store_atomic(&path, &[project("/old", 1)]).unwrap();
    write_store_atomic(&path, &[project("/new", 2)]).unwrap();
    let backup = read_store(&path.with_extension("json.bak"))
        .unwrap()
        .unwrap();
    assert_eq!(backup, vec![project("/old", 1)]);
    assert_eq!(
        read_store(&path).unwrap().unwrap(),
        vec![project("/new", 2)]
    );
}

fn starred(path: &str, starred_at: u64) -> StarredProject {
    StarredProject {
        path: path.into(),
        name: path.trim_start_matches('/').into(),
        starred_at,
        icon: None,
        skills: Vec::new(),
        combos: Vec::new(),
        wheel_slots: Vec::new(),
    }
}

fn combo(id: &str, steps: Vec<QuickAccessSkill>) -> QuickAccessCombo {
    QuickAccessCombo {
        id: id.into(),
        label: id.into(),
        steps,
    }
}

fn skill(id: &str) -> QuickAccessSkill {
    QuickAccessSkill {
        id: id.into(),
        label: id.into(),
        prompt: format!("/{id}"),
        provider_id: None,
        model: None,
        permission_mode: None,
        headless: None,
        auric_skill_id: None,
    }
}

#[test]
fn starred_merge_preserves_star_order_and_deduplicates() {
    let projects = vec![starred("/b", 2), starred("/a", 1), starred("/a", 3)];
    let merged = merge_starred_projects(projects);
    assert_eq!(
        merged
            .iter()
            .map(|project| project.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/a", "/b"]
    );
}

#[test]
fn starred_store_reads_pre_settings_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("starred-projects.json");
    fs::write(
        &path,
        r#"{"version":1,"projects":[{"path":"/a","name":"a","starredAt":1}]}"#,
    )
    .unwrap();

    let loaded = read_starred_store(&path).unwrap().unwrap();

    assert_eq!(loaded, vec![starred("/a", 1)]);
    assert!(loaded[0].icon.is_none());
    assert!(loaded[0].skills.is_empty());
}

#[test]
fn starred_store_round_trips_icon_and_skills() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("starred-projects.json");
    let mut project = starred("/a", 1);
    project.icon = Some(ProjectIconOverride {
        kind: "glyph".into(),
        value: "rocket_launch".into(),
    });
    project.skills = vec![QuickAccessSkill {
        provider_id: Some("claude".into()),
        model: Some("opus".into()),
        permission_mode: Some("plan".into()),
        headless: Some(true),
        auric_skill_id: Some("review".into()),
        ..skill("changelog")
    }];

    write_starred_store_atomic(&path, std::slice::from_ref(&project)).unwrap();

    assert_eq!(read_starred_store(&path).unwrap().unwrap(), vec![project]);
}

#[test]
fn starred_store_survives_unknown_icon_kind() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("starred-projects.json");
    fs::write(
        &path,
        r#"{"version":1,"projects":[{"path":"/a","name":"a","starredAt":1,
           "icon":{"kind":"sticker","value":"x"}}]}"#,
    )
    .unwrap();

    let loaded = read_starred_store(&path).unwrap().unwrap();

    assert_eq!(loaded[0].icon.as_ref().unwrap().kind, "sticker");
}

#[test]
fn merge_starred_absorbs_settings_from_a_bare_winner() {
    let mut rich = starred("/a", 5);
    rich.icon = Some(ProjectIconOverride {
        kind: "emoji".into(),
        value: "🚀".into(),
    });
    rich.skills = vec![skill("changelog")];

    let merged = merge_starred_projects(vec![starred("/a", 1), rich]);

    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].icon.as_ref().unwrap().value, "🚀");
    assert_eq!(merged[0].skills, vec![skill("changelog")]);
    assert_eq!(merged[0].starred_at, 1);
}

#[test]
fn merge_starred_never_resurrects_deleted_skills() {
    let mut current = starred("/a", 1);
    current.skills = vec![skill("kept")];
    let mut stale = starred("/a", 2);
    stale.skills = vec![skill("kept"), skill("deleted"), skill("also-deleted")];

    let merged = merge_starred_projects(vec![current, stale]);

    assert_eq!(merged[0].skills, vec![skill("kept")]);
}

#[test]
fn apply_settings_updates_only_the_named_project() {
    let mut projects = vec![starred("/a", 1), starred("/b", 2)];

    let applied = apply_starred_settings(
        &mut projects,
        "/b",
        StarredProjectSettings {
            icon: Some(ProjectIconOverride {
                kind: "glyph".into(),
                value: "bolt".into(),
            }),
            skills: vec![skill("seo")],
            combos: Vec::new(),
            wheel_slots: None,
        },
    );

    assert!(applied);
    assert_eq!(projects[0], starred("/a", 1));
    assert_eq!(projects[1].icon.as_ref().unwrap().value, "bolt");
    assert_eq!(projects[1].skills, vec![skill("seo")]);
}

#[test]
fn apply_settings_refuses_an_unstarred_path() {
    let mut projects = vec![starred("/a", 1)];

    let applied = apply_starred_settings(&mut projects, "/nope", StarredProjectSettings::default());

    assert!(!applied);
    assert_eq!(projects, vec![starred("/a", 1)]);
}

#[test]
fn add_does_not_reset_existing_settings() {
    let mut configured = starred("/a", 1);
    configured.skills = vec![skill("changelog")];
    let mut projects = vec![configured.clone()];

    push_starred_project(&mut projects, "/a".into(), 999);

    assert_eq!(projects, vec![configured]);
}

#[test]
fn normalize_skills_caps_dedupes_and_drops_blanks() {
    let mut skills = vec![
        skill("  keep  "),
        QuickAccessSkill {
            label: "   ".into(),
            ..skill("blank-label")
        },
        QuickAccessSkill {
            id: "  ".into(),
            ..skill("blank-id")
        },
        QuickAccessSkill {
            label: "duplicate".into(),
            ..skill("keep")
        },
    ];
    skills.extend((0..30).map(|i| skill(&format!("bulk-{i}"))));

    let normalized = normalize_skills(skills);

    assert_eq!(normalized.len(), MAX_SKILLS_PER_PROJECT);
    assert_eq!(normalized[0].id, "keep");
    assert_eq!(
        normalized.iter().filter(|s| s.id == "keep").count(),
        1,
        "a duplicate id must not survive"
    );
    assert!(normalized.iter().all(|s| !s.label.trim().is_empty()));
}

#[test]
fn starred_store_round_trips_combos() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("starred-projects.json");
    let mut project = starred("/a", 1);
    project.combos = vec![combo(
        "blog-write",
        vec![skill("finalize"), skill("rewrite")],
    )];

    write_starred_store_atomic(&path, std::slice::from_ref(&project)).unwrap();

    assert_eq!(read_starred_store(&path).unwrap().unwrap(), vec![project]);
}

#[test]
fn merge_starred_absorbs_combos_from_a_bare_winner() {
    let mut rich = starred("/a", 5);
    rich.combos = vec![combo(
        "blog-write",
        vec![skill("finalize"), skill("rewrite")],
    )];

    let merged = merge_starred_projects(vec![starred("/a", 1), rich]);

    assert_eq!(merged[0].combos.len(), 1);
    assert_eq!(merged[0].combos[0].id, "blog-write");
    assert_eq!(merged[0].starred_at, 1);
}

#[test]
fn merge_starred_never_resurrects_deleted_combos() {
    let mut current = starred("/a", 1);
    current.combos = vec![combo("kept", vec![skill("a"), skill("b")])];
    let mut stale = starred("/a", 2);
    stale.combos = vec![
        combo("kept", vec![skill("a"), skill("b")]),
        combo("deleted", vec![skill("c"), skill("d")]),
    ];

    let merged = merge_starred_projects(vec![current, stale]);

    assert_eq!(merged[0].combos.len(), 1);
    assert_eq!(merged[0].combos[0].id, "kept");
}

#[test]
fn apply_settings_writes_combos() {
    let mut projects = vec![starred("/a", 1)];

    let applied = apply_starred_settings(
        &mut projects,
        "/a",
        StarredProjectSettings {
            combos: vec![combo(
                "blog-write",
                vec![skill("finalize"), skill("rewrite")],
            )],
            ..StarredProjectSettings::default()
        },
    );

    assert!(applied);
    assert_eq!(projects[0].combos[0].id, "blog-write");
}

#[test]
fn apply_settings_writes_wheel_slots_and_drops_unknown_ids() {
    let mut projects = vec![starred("/a", 1)];
    projects[0].skills = vec![skill("research")];

    let applied = apply_starred_settings(
        &mut projects,
        "/a",
        StarredProjectSettings {
            skills: vec![skill("research")],
            wheel_slots: Some(vec![None, Some("research".into()), Some("gone".into())]),
            ..StarredProjectSettings::default()
        },
    );

    assert!(applied);
    assert_eq!(projects[0].wheel_slots[1].as_deref(), Some("research"));
    assert!(
        projects[0]
            .wheel_slots
            .iter()
            .filter(|s| s.is_some())
            .count()
            == 1
    );
}

#[test]
fn apply_settings_keeps_the_wheel_when_the_payload_omits_it() {
    let mut projects = vec![starred("/a", 1)];
    projects[0].skills = vec![skill("research")];
    projects[0].wheel_slots = vec![Some("research".into())];

    apply_starred_settings(
        &mut projects,
        "/a",
        StarredProjectSettings {
            skills: vec![skill("research")],
            ..StarredProjectSettings::default()
        },
    );

    assert_eq!(projects[0].wheel_slots[0].as_deref(), Some("research"));
}

#[test]
fn apply_settings_scrubs_wheel_slots_when_the_skill_is_removed() {
    let mut projects = vec![starred("/a", 1)];
    projects[0].skills = vec![skill("research")];
    projects[0].wheel_slots = vec![Some("research".into())];

    apply_starred_settings(
        &mut projects,
        "/a",
        StarredProjectSettings {
            skills: Vec::new(),
            ..StarredProjectSettings::default()
        },
    );

    assert!(projects[0].wheel_slots.is_empty());
}

#[test]
fn apply_settings_keeps_a_combo_on_the_wheel() {
    let mut projects = vec![starred("/a", 1)];

    let applied = apply_starred_settings(
        &mut projects,
        "/a",
        StarredProjectSettings {
            combos: vec![combo("blog-write", vec![skill("finalize")])],
            wheel_slots: Some(vec![Some("combo:blog-write".into())]),
            ..StarredProjectSettings::default()
        },
    );

    assert!(applied);
    assert_eq!(
        projects[0].wheel_slots[0].as_deref(),
        Some("combo:blog-write")
    );
}
