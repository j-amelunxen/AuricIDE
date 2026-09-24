use super::*;
use rusqlite::Connection;
use std::fs;

fn input(root: &std::path::Path) -> CreateMissionInput {
    CreateMissionInput {
        project_path: root.to_string_lossy().to_string(),
        project_name: Some("project".into()),
        name: "Weekly Product Review".into(),
        objective: "Review customer signals and ship the next improvement.".into(),
        recurrence: MissionRecurrence::Weekly {
            weekday: 3,
            time_of_day: "09:00".into(),
        },
        timezone: "Europe/Berlin".into(),
    }
}

#[test]
fn slug_is_safe_bounded_and_deterministic() {
    assert_eq!(
        derive_slug("  Weekly / Product Review! "),
        "weekly-product-review"
    );
    assert_eq!(derive_slug("../../"), "mission");
    assert!(derive_slug(&"A".repeat(100)).len() <= 64);
}

#[test]
fn schedule_identity_is_stable_and_project_scoped() {
    let one = deterministic_schedule_id("/repo/one/", "weekly-review");
    assert_eq!(one, deterministic_schedule_id("/repo/one", "weekly-review"));
    assert_ne!(one, deterministic_schedule_id("/repo/two", "weekly-review"));
}

#[test]
fn create_input_accepts_the_camel_case_tauri_contract() {
    let parsed: CreateMissionInput = serde_json::from_value(serde_json::json!({
        "projectPath": "/repo",
        "projectName": "repo",
        "name": "Daily review",
        "objective": "Review",
        "timezone": "UTC",
        "recurrence": { "kind": "daily", "timeOfDay": "09:00" }
    }))
    .unwrap();
    assert_eq!(
        parsed.recurrence,
        MissionRecurrence::Daily {
            time_of_day: "09:00".into()
        }
    );
}

#[test]
fn creates_the_complete_markdown_first_scaffold() {
    let root = tempfile::tempdir().unwrap();
    let created = create_impl(&input(root.path())).unwrap();
    let dir = root.path().join(".auric/missions/weekly-product-review");

    assert_eq!(created.slug, "weekly-product-review");
    for relative in [
        "MISSION.md",
        "STATE.md",
        "runs/.gitkeep",
        "artifacts/.gitkeep",
        ".gitignore",
    ] {
        assert!(dir.join(relative).is_file(), "missing {relative}");
    }
    let markdown = fs::read_to_string(dir.join("MISSION.md")).unwrap();
    assert!(markdown.contains("Review customer signals"));
    assert!(markdown.contains("timezone: \"Europe/Berlin\""));
    assert!(markdown.contains("schedule: \"weekly on weekday 3 at 09:00\""));
}

#[test]
fn existing_mission_is_never_overwritten() {
    let root = tempfile::tempdir().unwrap();
    create_impl(&input(root.path())).unwrap();
    let state = root
        .path()
        .join(".auric/missions/weekly-product-review/STATE.md");
    fs::write(&state, "precious progress").unwrap();

    assert!(create_impl(&input(root.path()))
        .unwrap_err()
        .contains("already exists"));
    assert_eq!(fs::read_to_string(state).unwrap(), "precious progress");
}

#[test]
fn case_only_mission_collision_is_rejected() {
    let root = tempfile::tempdir().unwrap();
    let existing = root.path().join(".auric/missions/Weekly-Product-Review");
    fs::create_dir_all(&existing).unwrap();
    fs::write(existing.join("STATE.md"), "keep me").unwrap();

    assert!(create_impl(&input(root.path()))
        .unwrap_err()
        .contains("already exists"));
    assert_eq!(
        fs::read_to_string(existing.join("STATE.md")).unwrap(),
        "keep me"
    );
}

#[cfg(unix)]
#[test]
fn refuses_a_symlinked_auric_directory() {
    use std::os::unix::fs::symlink;

    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    symlink(outside.path(), root.path().join(".auric")).unwrap();

    assert!(create_impl(&input(root.path()))
        .unwrap_err()
        .contains("must not be a symlink"));
    assert!(!outside.path().join("missions").exists());
}

#[test]
fn rejects_a_missing_project_without_creating_any_scaffold() {
    let root = tempfile::tempdir().unwrap();
    let missing = root.path().join("missing");
    assert!(create_impl(&input(&missing)).is_err());
    assert!(!missing.exists());
}

#[test]
fn rejects_an_empty_objective() {
    let root = tempfile::tempdir().unwrap();
    let mut request = input(root.path());
    request.objective = "  ".into();
    assert_eq!(
        create_impl(&request).unwrap_err(),
        "Mission objective is required"
    );
}

#[test]
fn coordinated_create_persists_exactly_one_linked_schedule() {
    let root = tempfile::tempdir().unwrap();
    let conn = Connection::open_in_memory().unwrap();
    crate::notifications::run_migrations(&conn).unwrap();

    let result = create_with_schedule_impl(&conn, &input(root.path()), chrono::Utc::now()).unwrap();
    let schedules = crate::schedules::list_impl(&conn).unwrap();
    assert_eq!(schedules.len(), 1);
    assert_eq!(schedules[0].id, result.mission.schedule_id);
    assert_eq!(
        schedules[0].mission_slug.as_deref(),
        Some("weekly-product-review")
    );
    assert_eq!(schedules[0].catch_up, "coalesce");
}

#[test]
fn schedule_failure_removes_only_the_fresh_scaffold() {
    let root = tempfile::tempdir().unwrap();
    let conn = Connection::open_in_memory().unwrap(); // no schedules table
    let request = input(root.path());

    assert!(create_with_schedule_impl(&conn, &request, chrono::Utc::now()).is_err());
    assert!(!root
        .path()
        .join(".auric/missions/weekly-product-review")
        .exists());

    // A pre-existing mission never reaches compensation.
    let existing = root.path().join(".auric/missions/weekly-product-review");
    fs::create_dir_all(&existing).unwrap();
    fs::write(existing.join("STATE.md"), "keep me").unwrap();
    assert!(create_with_schedule_impl(&conn, &request, chrono::Utc::now()).is_err());
    assert_eq!(
        fs::read_to_string(existing.join("STATE.md")).unwrap(),
        "keep me"
    );
}
