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
        badge: None,
        description: None,
        dock_index: None,
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
    assert!(
        loaded[0].description.is_none(),
        "files from before descriptions read"
    );
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
            badge: None,
            description: None,
            dock_index: None,
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

fn fe_badge() -> ProjectBadge {
    ProjectBadge {
        text: "fe".into(),
        color: "blue".into(),
    }
}

#[test]
fn apply_settings_sets_a_badge_and_collapses_it_like_the_frontend() {
    let mut projects = vec![starred("/a", 1)];

    apply_starred_settings(
        &mut projects,
        "/a",
        StarredProjectSettings {
            badge: Some(Some(ProjectBadge {
                text: "  fe  ".into(),
                color: "green".into(),
            })),
            ..StarredProjectSettings::default()
        },
    );

    assert_eq!(
        projects[0].badge,
        Some(ProjectBadge {
            text: "fe".into(),
            color: "green".into(),
        })
    );
}

#[test]
fn apply_settings_caps_a_badge_at_six_characters() {
    let mut projects = vec![starred("/a", 1)];

    apply_starred_settings(
        &mut projects,
        "/a",
        StarredProjectSettings {
            badge: Some(Some(ProjectBadge {
                text: "lane-twelve".into(),
                color: "blue".into(),
            })),
            ..StarredProjectSettings::default()
        },
    );
    assert_eq!(projects[0].badge.as_ref().unwrap().text, "lane-t");

    apply_starred_settings(
        &mut projects,
        "/a",
        StarredProjectSettings {
            badge: Some(Some(ProjectBadge {
                text: "abcde fghi".into(),
                color: "blue".into(),
            })),
            ..StarredProjectSettings::default()
        },
    );
    // The cut lands on the space between the words. That space does not stay.
    assert_eq!(projects[0].badge.as_ref().unwrap().text, "abcde");

    apply_starred_settings(
        &mut projects,
        "/a",
        StarredProjectSettings {
            badge: Some(Some(ProjectBadge {
                text: "überlang".into(),
                color: "blue".into(),
            })),
            ..StarredProjectSettings::default()
        },
    );
    assert_eq!(projects[0].badge.as_ref().unwrap().text, "überla");
}

#[test]
fn apply_settings_clears_a_blank_badge_and_fills_a_blank_colour() {
    let mut projects = vec![starred("/a", 1)];
    projects[0].badge = Some(fe_badge());

    apply_starred_settings(
        &mut projects,
        "/a",
        StarredProjectSettings {
            badge: Some(Some(ProjectBadge {
                text: "   ".into(),
                color: "blue".into(),
            })),
            ..StarredProjectSettings::default()
        },
    );
    assert!(projects[0].badge.is_none());

    apply_starred_settings(
        &mut projects,
        "/a",
        StarredProjectSettings {
            badge: Some(Some(ProjectBadge {
                text: "fe".into(),
                color: "   ".into(),
            })),
            ..StarredProjectSettings::default()
        },
    );
    assert_eq!(projects[0].badge.as_ref().unwrap().color, "blue");
}

#[test]
fn apply_settings_keeps_a_badge_the_payload_does_not_mention() {
    let mut projects = vec![starred("/a", 1)];
    projects[0].badge = Some(fe_badge());

    apply_starred_settings(
        &mut projects,
        "/a",
        StarredProjectSettings {
            icon: Some(ProjectIconOverride {
                kind: "glyph".into(),
                value: "bolt".into(),
            }),
            ..StarredProjectSettings::default()
        },
    );

    assert_eq!(projects[0].badge, Some(fe_badge()));
    assert_eq!(projects[0].icon.as_ref().unwrap().value, "bolt");
}

#[test]
fn apply_settings_clears_a_badge_on_explicit_null() {
    let mut projects = vec![starred("/a", 1)];
    projects[0].badge = Some(fe_badge());

    apply_starred_settings(
        &mut projects,
        "/a",
        StarredProjectSettings {
            badge: Some(None),
            ..StarredProjectSettings::default()
        },
    );

    assert!(projects[0].badge.is_none());
}

#[test]
fn settings_json_distinguishes_a_missing_badge_from_null() {
    let missing: StarredProjectSettings = serde_json::from_str("{}").unwrap();
    assert!(missing.badge.is_none());

    let clear: StarredProjectSettings = serde_json::from_str(r#"{"badge":null}"#).unwrap();
    assert_eq!(clear.badge, Some(None));

    let set: StarredProjectSettings =
        serde_json::from_str(r#"{"badge":{"text":"fe","color":"blue"}}"#).unwrap();
    assert_eq!(set.badge, Some(Some(fe_badge())));
}

#[test]
fn absorb_fills_a_missing_badge_and_does_not_overwrite_one() {
    let mut kept = starred("/a", 1);
    kept.badge = Some(fe_badge());
    let mut other = starred("/a", 2);
    other.badge = Some(ProjectBadge {
        text: "qa".into(),
        color: "red".into(),
    });
    kept.absorb(other);
    assert_eq!(kept.badge.as_ref().unwrap().text, "fe");

    let mut empty = starred("/a", 1);
    let mut donor = starred("/a", 2);
    donor.badge = Some(ProjectBadge {
        text: "qa".into(),
        color: "red".into(),
    });
    empty.absorb(donor);
    assert_eq!(empty.badge.as_ref().unwrap().text, "qa");
}

#[test]
fn a_badge_roundtrips_through_the_starred_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("starred-projects.json");
    let mut project = starred("/a", 1);
    project.badge = Some(fe_badge());

    write_starred_store_atomic(&path, std::slice::from_ref(&project)).unwrap();

    assert_eq!(read_starred_store(&path).unwrap().unwrap(), vec![project]);
}

fn set_description(projects: &mut [StarredProject], description: Option<Option<String>>) {
    apply_starred_settings(
        projects,
        "/a",
        StarredProjectSettings {
            description,
            ..StarredProjectSettings::default()
        },
    );
}

#[test]
fn a_user_description_is_trimmed_capped_cleared_when_blank_and_kept_when_unmentioned() {
    let mut projects = vec![starred("/a", 1)];

    set_description(&mut projects, Some(Some("  Customer portal.  ".into())));
    assert_eq!(projects[0].description.as_deref(), Some("Customer portal."));

    // Another settings save that does not mention it leaves it alone.
    set_description(&mut projects, None);
    assert_eq!(projects[0].description.as_deref(), Some("Customer portal."));

    set_description(&mut projects, Some(Some("x".repeat(400))));
    assert_eq!(
        projects[0].description.as_ref().map(|d| d.chars().count()),
        Some(USER_DESCRIPTION_MAX_CHARS)
    );

    set_description(&mut projects, Some(Some("   ".into())));
    assert_eq!(projects[0].description, None);
}

#[test]
fn the_settings_payload_tells_an_absent_description_from_a_cleared_one() {
    let absent: StarredProjectSettings = serde_json::from_str("{}").unwrap();
    assert_eq!(absent.description, None);
    let cleared: StarredProjectSettings = serde_json::from_str(r#"{"description":null}"#).unwrap();
    assert_eq!(cleared.description, Some(None));
}

#[test]
fn a_user_description_is_capped_on_a_character_boundary() {
    let mut projects = vec![starred("/a", 1)];
    set_description(&mut projects, Some(Some("ä".repeat(400))));
    assert_eq!(
        projects[0].description,
        Some("ä".repeat(USER_DESCRIPTION_MAX_CHARS))
    );
}

/// The path `starred_projects_update_settings` takes, with the payload as the
/// frontend sends it and the record as it comes back.
#[test]
fn the_settings_command_path_accepts_and_returns_the_description_in_camel_case() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("starred-projects.json");
    write_starred_store_atomic(&path, &[starred("/a", 1)]).unwrap();
    let state = StarredProjectsState::initialize(path.clone());

    let settings: StarredProjectSettings =
        serde_json::from_str(r#"{"description":"  Customer portal.  "}"#).unwrap();
    let returned = state
        .update(|projects| {
            assert!(apply_starred_settings(projects, "/a", settings));
        })
        .unwrap();
    let wire = serde_json::to_value(&returned).unwrap();
    assert_eq!(wire[0]["description"], "Customer portal.");

    // Persisted, and cleared again by an explicit null.
    assert_eq!(
        read_starred_store(&path).unwrap().unwrap()[0]
            .description
            .as_deref(),
        Some("Customer portal.")
    );
    let clear: StarredProjectSettings = serde_json::from_str(r#"{"description":null}"#).unwrap();
    let returned = state
        .update(|projects| {
            apply_starred_settings(projects, "/a", clear);
        })
        .unwrap();
    let wire = serde_json::to_value(&returned).unwrap();
    assert!(
        wire[0].get("description").is_none(),
        "an absent description is left out, like the badge"
    );
}

fn dock(projects: &mut [StarredProject], path: &str, update: Option<u32>) {
    apply_starred_settings(
        projects,
        path,
        StarredProjectSettings {
            dock_index: Some(update),
            ..StarredProjectSettings::default()
        },
    );
}

fn dock_order(projects: &[StarredProject]) -> Vec<(String, u32)> {
    let mut docked: Vec<_> = projects
        .iter()
        .filter_map(|p| p.dock_index.map(|i| (p.path.clone(), i)))
        .collect();
    docked.sort_by_key(|(_, i)| *i);
    docked
}

#[test]
fn docking_inserts_at_the_given_place_and_renumbers() {
    let mut projects = vec![starred("/a", 1), starred("/b", 2), starred("/c", 3)];
    dock(&mut projects, "/a", Some(0));
    dock(&mut projects, "/b", Some(1));
    dock(&mut projects, "/c", Some(0));

    assert_eq!(
        dock_order(&projects),
        vec![("/c".into(), 0), ("/a".into(), 1), ("/b".into(), 2)]
    );
}

#[test]
fn moving_inside_the_dock_reorders_without_growing_it() {
    let mut projects = vec![starred("/a", 1), starred("/b", 2), starred("/c", 3)];
    dock(&mut projects, "/a", Some(0));
    dock(&mut projects, "/b", Some(1));
    dock(&mut projects, "/c", Some(2));
    dock(&mut projects, "/c", Some(0));

    assert_eq!(
        dock_order(&projects),
        vec![("/c".into(), 0), ("/a".into(), 1), ("/b".into(), 2)]
    );
}

#[test]
fn undocking_closes_the_gap() {
    let mut projects = vec![starred("/a", 1), starred("/b", 2), starred("/c", 3)];
    for (i, p) in ["/a", "/b", "/c"].iter().enumerate() {
        dock(&mut projects, p, Some(i as u32));
    }
    dock(&mut projects, "/a", None);

    assert_eq!(
        dock_order(&projects),
        vec![("/b".into(), 0), ("/c".into(), 1)]
    );
    assert!(projects[0].dock_index.is_none());
}

#[test]
fn a_full_dock_refuses_a_ninth_project_but_still_reorders() {
    let mut projects: Vec<_> = (0..9).map(|i| starred(&format!("/p{i}"), i)).collect();
    for i in 0..8 {
        dock(&mut projects, &format!("/p{i}"), Some(i as u32));
    }
    dock(&mut projects, "/p8", Some(0));
    assert!(projects[8].dock_index.is_none());
    assert_eq!(dock_order(&projects).len(), DOCK_MAX);

    dock(&mut projects, "/p7", Some(0));
    assert_eq!(dock_order(&projects)[0].0, "/p7");
}

#[test]
fn a_settings_save_that_does_not_mention_the_dock_leaves_it_alone() {
    let mut projects = vec![starred("/a", 1)];
    dock(&mut projects, "/a", Some(0));

    apply_starred_settings(&mut projects, "/a", StarredProjectSettings::default());

    assert_eq!(projects[0].dock_index, Some(0));
}

#[test]
fn settings_json_distinguishes_a_missing_dock_index_from_null() {
    let missing: StarredProjectSettings = serde_json::from_str("{}").unwrap();
    assert!(missing.dock_index.is_none());
    let clear: StarredProjectSettings = serde_json::from_str(r#"{"dockIndex":null}"#).unwrap();
    assert_eq!(clear.dock_index, Some(None));
    let set: StarredProjectSettings = serde_json::from_str(r#"{"dockIndex":2}"#).unwrap();
    assert_eq!(set.dock_index, Some(Some(2)));
}

#[test]
fn absorb_keeps_an_own_dock_place_and_fills_a_missing_one() {
    let mut kept = starred("/a", 1);
    kept.dock_index = Some(1);
    let mut other = starred("/a", 2);
    other.dock_index = Some(3);
    kept.absorb(other);
    assert_eq!(kept.dock_index, Some(1));

    let mut empty = starred("/a", 1);
    let mut donor = starred("/a", 2);
    donor.dock_index = Some(3);
    empty.absorb(donor);
    assert_eq!(empty.dock_index, Some(3));
}
