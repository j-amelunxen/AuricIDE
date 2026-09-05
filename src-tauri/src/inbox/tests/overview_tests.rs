use super::*;
use crate::inbox::overview::projects_pm_overview_impl;
use rusqlite::{params, Connection};
use tempfile::TempDir;

#[test]
fn overview_reports_has_db_false_for_a_project_without_one() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().to_string_lossy().to_string();

    let overview = projects_pm_overview_impl(&[path]);
    assert_eq!(overview.len(), 1);
    assert!(!overview[0].has_db);
    assert!(overview[0].error.is_none());
    assert_eq!(overview[0].open, 0);
}

#[test]
fn overview_never_creates_a_project_database() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().to_string_lossy().to_string();

    projects_pm_overview_impl(&[path]);

    assert!(!dir.path().join(".auric").exists());
}

#[test]
fn overview_counts_tickets_by_status_excluding_archived() {
    let project = seeded_project();
    let conn = open_project_db(&project);
    conn.execute("INSERT INTO pm_epics (id, name) VALUES ('e1', 'Epic')", [])
        .unwrap();
    for (id, status) in [
        ("t1", "open"),
        ("t2", "open"),
        ("t3", "in_progress"),
        ("t4", "in_review"),
        ("t5", "done"),
        ("t6", "archived"),
        ("t7", "discarded"),
        ("t8", "to_test"),
    ] {
        conn.execute(
            "INSERT INTO pm_tickets (id, epic_id, name, status) VALUES (?1, 'e1', ?1, ?2)",
            params![id, status],
        )
        .unwrap();
    }
    drop(conn);

    let overview = projects_pm_overview_impl(&[project.path().to_string_lossy().to_string()]);
    assert!(overview[0].has_db);
    assert!(overview[0].error.is_none());
    assert_eq!(overview[0].open, 2);
    assert_eq!(overview[0].in_progress, 1);
    assert_eq!(overview[0].in_review, 1);
    assert_eq!(overview[0].done, 1);
}

#[test]
fn overview_lists_non_done_tickets_newest_updated_first() {
    let project = seeded_project();
    let conn = open_project_db(&project);
    conn.execute("INSERT INTO pm_epics (id, name) VALUES ('e1', 'Epic')", [])
        .unwrap();
    conn.execute(
        "INSERT INTO pm_tickets (id, epic_id, name, status, updated_at) \
         VALUES ('t1', 'e1', 'Older', 'open', '2026-01-01 00:00:00')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO pm_tickets (id, epic_id, name, status, updated_at) \
         VALUES ('t2', 'e1', 'Newer', 'in_progress', '2026-01-02 00:00:00')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO pm_tickets (id, epic_id, name, status, updated_at) \
         VALUES ('t3', 'e1', 'Finished', 'done', '2026-01-03 00:00:00')",
        [],
    )
    .unwrap();
    drop(conn);

    let overview = projects_pm_overview_impl(&[project.path().to_string_lossy().to_string()]);
    let tickets = &overview[0].tickets;
    assert_eq!(tickets.len(), 2);
    assert_eq!(tickets[0].name, "Newer");
    assert_eq!(tickets[1].name, "Older");
    assert_eq!(tickets[0].epic_name, "Epic");
}

#[test]
fn overview_opens_the_project_database_read_only() {
    let project = seeded_project();
    let db_path = project.path().join(".auric").join("project.db");
    let before = std::fs::metadata(&db_path).unwrap().modified().unwrap();

    projects_pm_overview_impl(&[project.path().to_string_lossy().to_string()]);

    let after = std::fs::metadata(&db_path).unwrap().modified().unwrap();
    assert_eq!(before, after);
}

#[test]
fn overview_reports_an_error_instead_of_crashing_on_an_old_schema() {
    let dir = TempDir::new().unwrap();
    let auric_dir = dir.path().join(".auric");
    std::fs::create_dir_all(&auric_dir).unwrap();
    let db_path = auric_dir.join("project.db");

    // A schema from before migration 5 (`add_ticket_priority`): pm_tickets
    // has no `priority` column yet.
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch(
        "CREATE TABLE pm_epics (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE pm_tickets (
             id TEXT PRIMARY KEY,
             epic_id TEXT NOT NULL,
             name TEXT NOT NULL,
             status TEXT NOT NULL DEFAULT 'open',
             updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         );",
    )
    .unwrap();
    drop(conn);

    let overview = projects_pm_overview_impl(&[dir.path().to_string_lossy().to_string()]);
    assert!(overview[0].has_db);
    assert!(overview[0].error.is_some());
    assert_eq!(overview[0].open, 0);
    assert!(overview[0].tickets.is_empty());
}

#[test]
fn overview_never_applies_migrations_through_its_read_only_open() {
    let project = seeded_project();
    let db_path = project.path().join(".auric").join("project.db");
    let migrations_before: i64 = {
        let conn = Connection::open(&db_path).unwrap();
        conn.query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))
            .unwrap()
    };

    projects_pm_overview_impl(&[project.path().to_string_lossy().to_string()]);

    let migrations_after: i64 = {
        let conn = Connection::open(&db_path).unwrap();
        conn.query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(
        migrations_before, migrations_after,
        "a read-only overview must never trigger a migration run"
    );
}

#[test]
fn overview_read_only_open_may_create_wal_side_files() {
    let project = seeded_project();
    let auric_dir = project.path().join(".auric");
    let wal_path = auric_dir.join("project.db-wal");
    let shm_path = auric_dir.join("project.db-shm");
    let _ = std::fs::remove_file(&wal_path);
    let _ = std::fs::remove_file(&shm_path);

    projects_pm_overview_impl(&[project.path().to_string_lossy().to_string()]);

    assert!(
        wal_path.exists() && shm_path.exists(),
        "a read-only WAL open is expected to create its side files; \
         if this starts failing, SQLite's behaviour has changed and the \
         module doc comment should be revisited"
    );
}

#[test]
fn overview_preserves_input_order_across_multiple_projects() {
    let a = TempDir::new().unwrap();
    let b = seeded_project();
    let paths = vec![
        a.path().to_string_lossy().to_string(),
        b.path().to_string_lossy().to_string(),
    ];

    let overview = projects_pm_overview_impl(&paths);
    assert_eq!(overview[0].project_path, paths[0]);
    assert_eq!(overview[1].project_path, paths[1]);
    assert!(!overview[0].has_db);
    assert!(overview[1].has_db);
}
