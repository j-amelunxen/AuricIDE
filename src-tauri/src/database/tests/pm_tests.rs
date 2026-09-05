use super::*;
use crate::database::*;
use std::fs;
use tempfile::TempDir;

#[test]
fn test_pm_migration_creates_tables() {
    let conn = setup_in_memory_db();

    let tables = [
        "pm_epics",
        "pm_tickets",
        "pm_test_cases",
        "pm_dependencies",
        "pm_status_history",
        "blueprints",
        "pm_requirements",
        "pm_requirement_test_links",
        "pm_goals",
        "pm_goal_runs",
        "pm_goal_requirement_links",
        "pm_goal_stations",
        "pm_ticket_reviews",
    ];
    for table in &tables {
        let exists: bool = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='{}'",
                    table
                ),
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(exists, "Table {} should exist", table);
    }

    let migration_count: i32 = conn
        .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
        .unwrap();
    assert_eq!(migration_count, 19);
}

#[test]
fn test_pm_save_and_load_roundtrip() {
    let conn = setup_in_memory_db();
    let payload = make_test_payload();

    pm_save_impl(&conn, &payload).unwrap();
    let state = pm_load_impl(&conn).unwrap();

    assert_eq!(state.epics.len(), 1);
    assert_eq!(state.epics[0].id, "e1");
    assert_eq!(state.epics[0].name, "Epic One");

    assert_eq!(state.tickets.len(), 1);
    assert_eq!(state.tickets[0].id, "t1");
    assert_eq!(state.tickets[0].epic_id, "e1");
    assert_eq!(state.tickets[0].context.as_ref().unwrap().len(), 1);
    assert_eq!(
        state.tickets[0].context.as_ref().unwrap()[0].value,
        "some context"
    );
    assert_eq!(state.tickets[0].model_power, Some("high".to_string()));
    assert_eq!(state.tickets[0].due_date, Some("2026-08-20".to_string()));
    assert_eq!(
        state.tickets[0].skills,
        vec!["/tdd".to_string(), "/review".to_string()]
    );

    assert_eq!(state.test_cases.len(), 1);
    assert_eq!(state.test_cases[0].id, "tc1");
    assert_eq!(state.test_cases[0].ticket_id, "t1");

    assert_eq!(state.dependencies.len(), 1);
    assert_eq!(state.dependencies[0].source_id, "t1");
    assert_eq!(state.dependencies[0].target_id, "t2");
}

#[test]
fn test_pm_save_replaces_existing() {
    let conn = setup_in_memory_db();

    let payload1 = make_test_payload();
    pm_save_impl(&conn, &payload1).unwrap();

    let payload2 = PmSavePayload {
        epics: vec![PmEpic {
            id: "e2".to_string(),
            name: "Epic Two".to_string(),
            description: "Second epic".to_string(),
            sort_order: 0,
            created_at: "2026-02-01 00:00:00".to_string(),
            updated_at: "2026-02-01 00:00:00".to_string(),
        }],
        tickets: vec![],
        test_cases: vec![],
        dependencies: vec![],
    };
    pm_save_impl(&conn, &payload2).unwrap();

    let state = pm_load_impl(&conn).unwrap();
    assert_eq!(state.epics.len(), 1);
    assert_eq!(state.epics[0].id, "e2");
    assert_eq!(state.tickets.len(), 0);
    assert_eq!(state.test_cases.len(), 0);
    assert_eq!(state.dependencies.len(), 0);
}

#[test]
fn test_pm_clear_empties_tables() {
    let conn = setup_in_memory_db();
    let payload = make_test_payload();
    pm_save_impl(&conn, &payload).unwrap();

    // Verify not empty
    let state_before = pm_load_impl(&conn).unwrap();
    assert!(!state_before.epics.is_empty());

    pm_clear_impl(&conn).unwrap();

    let state_after = pm_load_impl(&conn).unwrap();
    assert_eq!(state_after.epics.len(), 0);
    assert_eq!(state_after.tickets.len(), 0);
    assert_eq!(state_after.test_cases.len(), 0);
    assert_eq!(state_after.dependencies.len(), 0);
}

#[test]
fn test_validate_no_cycles_ok() {
    let deps = vec![
        PmDependency {
            id: "d1".to_string(),
            source_type: "ticket".to_string(),
            source_id: "a".to_string(),
            target_type: "ticket".to_string(),
            target_id: "b".to_string(),
        },
        PmDependency {
            id: "d2".to_string(),
            source_type: "ticket".to_string(),
            source_id: "b".to_string(),
            target_type: "ticket".to_string(),
            target_id: "c".to_string(),
        },
    ];
    assert!(validate_no_cycles(&deps).is_ok());
}

#[test]
fn test_export_import_roundtrip_preserves_data() {
    let dir = TempDir::new().unwrap();
    let project_path = dir.path().to_str().unwrap();

    // 1. Initialize DB and add data
    let conn = init_db(project_path).unwrap();
    kv_set(&conn, "settings", "theme", "dark").unwrap();
    kv_set(&conn, "settings", "font", "mono").unwrap();
    let payload = make_test_payload();
    pm_save_impl(&conn, &payload).unwrap();

    // Verify data exists before export
    assert_eq!(
        kv_get(&conn, "settings", "theme").unwrap(),
        Some("dark".to_string())
    );
    let state = pm_load_impl(&conn).unwrap();
    assert_eq!(state.epics.len(), 1);
    assert_eq!(state.tickets.len(), 1);
    assert_eq!(state.test_cases.len(), 1);
    assert_eq!(state.dependencies.len(), 1);

    // 2. Export: checkpoint WAL and copy DB file (mirrors db_export)
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .unwrap();
    let db_path = dir.path().join(".auric/project.db");
    let export_path = dir.path().join("backup.db");
    fs::copy(&db_path, &export_path).unwrap();

    // 3. Import: close connection, delete files, copy, re-init (mirrors db_import)
    drop(conn);
    let _ = fs::remove_file(dir.path().join(".auric/project.db-wal"));
    let _ = fs::remove_file(dir.path().join(".auric/project.db-shm"));
    fs::remove_file(&db_path).unwrap();
    fs::copy(&export_path, &db_path).unwrap();
    let conn = init_db(project_path).unwrap();

    // 4. Verify ALL data survived the roundtrip
    let theme = kv_get(&conn, "settings", "theme").unwrap();
    assert_eq!(theme, Some("dark".to_string()), "KV data lost after import");

    let font = kv_get(&conn, "settings", "font").unwrap();
    assert_eq!(font, Some("mono".to_string()), "KV data lost after import");

    let state = pm_load_impl(&conn).unwrap();
    assert_eq!(state.epics.len(), 1, "Epics lost after import");
    assert_eq!(state.epics[0].id, "e1");
    assert_eq!(state.tickets.len(), 1, "Tickets lost after import");
    assert_eq!(state.tickets[0].id, "t1");
    assert_eq!(state.test_cases.len(), 1, "Test cases lost after import");
    assert_eq!(
        state.dependencies.len(),
        1,
        "Dependencies lost after import"
    );
}

#[test]
fn test_migration_8_creates_status_history_table() {
    let conn = setup_in_memory_db();

    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' \
                 AND name='pm_status_history'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(exists, "pm_status_history table should exist");
}

#[test]
fn test_pm_save_detects_status_change_inserts_history() {
    let conn = setup_in_memory_db();

    // First save: ticket with status "open"
    let payload1 = make_test_payload();
    pm_save_impl(&conn, &payload1).unwrap();

    // Second save: same ticket with status "in_progress"
    let mut payload2 = make_test_payload();
    payload2.tickets[0].status = "in_progress".to_string();
    pm_save_impl(&conn, &payload2).unwrap();

    let history = pm_load_history_impl(&conn).unwrap();
    // Should have: creation event from first save + change event from second save
    assert!(
        history.len() >= 2,
        "Expected at least 2 history entries, got {}",
        history.len()
    );

    // Find the status change entry
    let change = history
        .iter()
        .find(|h| h.from_status.as_deref() == Some("open") && h.to_status == "in_progress");
    assert!(
        change.is_some(),
        "Should have a status change from open to in_progress"
    );
}

#[test]
fn test_pm_save_detects_new_ticket_inserts_creation_event() {
    let conn = setup_in_memory_db();

    let payload = make_test_payload();
    pm_save_impl(&conn, &payload).unwrap();

    let history = pm_load_history_impl(&conn).unwrap();
    assert!(
        !history.is_empty(),
        "Should have at least one history entry"
    );

    // The creation event should have no from_status
    let creation = history
        .iter()
        .find(|h| h.ticket_id == "t1" && h.from_status.is_none());
    assert!(creation.is_some(), "Should have a creation event for t1");
    assert_eq!(creation.unwrap().to_status, "open");
    assert_eq!(creation.unwrap().source, "ui");
}

#[test]
fn test_pm_save_no_history_when_status_unchanged() {
    let conn = setup_in_memory_db();

    let payload = make_test_payload();
    pm_save_impl(&conn, &payload).unwrap();

    let history_after_first = pm_load_history_impl(&conn).unwrap();
    let count_after_first = history_after_first.len();

    // Save again with no status change
    pm_save_impl(&conn, &payload).unwrap();

    let history_after_second = pm_load_history_impl(&conn).unwrap();
    assert_eq!(
        history_after_second.len(),
        count_after_first,
        "No new history entries should be created when status is unchanged"
    );
}

#[test]
fn test_pm_load_history_returns_ordered_entries() {
    let conn = setup_in_memory_db();

    // Save with open status
    let payload1 = make_test_payload();
    pm_save_impl(&conn, &payload1).unwrap();

    // Change to in_progress
    let mut payload2 = make_test_payload();
    payload2.tickets[0].status = "in_progress".to_string();
    pm_save_impl(&conn, &payload2).unwrap();

    // Change to done
    let mut payload3 = make_test_payload();
    payload3.tickets[0].status = "done".to_string();
    pm_save_impl(&conn, &payload3).unwrap();

    let history = pm_load_history_impl(&conn).unwrap();
    assert!(
        history.len() >= 3,
        "Expected at least 3 history entries, got {}",
        history.len()
    );

    // Verify ordering by changed_at ASC
    for i in 1..history.len() {
        assert!(
            history[i].changed_at >= history[i - 1].changed_at,
            "History should be ordered by changed_at ASC"
        );
    }
}

#[test]
fn test_pm_clear_clears_history() {
    let conn = setup_in_memory_db();

    let payload = make_test_payload();
    pm_save_impl(&conn, &payload).unwrap();

    let history = pm_load_history_impl(&conn).unwrap();
    assert!(
        !history.is_empty(),
        "Should have history entries before clear"
    );

    pm_clear_impl(&conn).unwrap();

    let history_after = pm_load_history_impl(&conn).unwrap();
    assert!(
        history_after.is_empty(),
        "History should be empty after clear"
    );
}

#[test]
fn test_validate_no_cycles_detects_cycle() {
    let deps = vec![
        PmDependency {
            id: "d1".to_string(),
            source_type: "ticket".to_string(),
            source_id: "a".to_string(),
            target_type: "ticket".to_string(),
            target_id: "b".to_string(),
        },
        PmDependency {
            id: "d2".to_string(),
            source_type: "ticket".to_string(),
            source_id: "b".to_string(),
            target_type: "ticket".to_string(),
            target_id: "a".to_string(),
        },
    ];
    let result = validate_no_cycles(&deps);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Cycle"));
}
