use super::*;
use crate::database::*;
use rusqlite::Connection;
use std::fs;
use tempfile::TempDir;

#[test]
fn test_ensure_auric_dir_creates_directory_and_gitignore() {
    let dir = TempDir::new().unwrap();
    let project_path = dir.path().to_str().unwrap();

    let auric_dir = ensure_auric_dir(project_path).unwrap();

    assert!(auric_dir.exists());
    assert!(auric_dir.is_dir());

    let gitignore = auric_dir.join(".gitignore");
    assert!(gitignore.exists());
    assert_eq!(fs::read_to_string(gitignore).unwrap(), "*\n");
}

#[test]
fn test_ensure_auric_dir_idempotent() {
    let dir = TempDir::new().unwrap();
    let project_path = dir.path().to_str().unwrap();

    ensure_auric_dir(project_path).unwrap();
    ensure_auric_dir(project_path).unwrap();

    let gitignore = dir.path().join(".auric/.gitignore");
    assert_eq!(fs::read_to_string(gitignore).unwrap(), "*\n");
}

#[test]
fn test_run_migrations_creates_tables() {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();

    // _migrations table should exist with entries
    let count: i32 = conn
        .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 21);

    // kv_store table should exist
    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='kv_store'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(table_exists);
}

#[test]
fn test_run_migrations_idempotent() {
    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    run_migrations(&conn).unwrap();

    let count: i32 = conn
        .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 21);
}

#[test]
fn test_init_db_creates_db_file() {
    let dir = TempDir::new().unwrap();
    let project_path = dir.path().to_str().unwrap();

    let conn = init_db(project_path).unwrap();

    // DB file should exist
    let db_path = dir.path().join(".auric/project.db");
    assert!(db_path.exists());

    // Tables should be created
    let count: i32 = conn
        .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 21);
}

// --- pm_goal_reviews (migration 21) ---
// The contract is shared with src/mcp/__tests__/goalReviewsSchema.test.ts, so the
// Rust migration and the MCP migration cannot build two different tables.
const GOAL_REVIEWS_CONTRACT: &str =
    include_str!("../../../../src/lib/goals/goalReviewsSchema.fixtures.json");

fn goal_reviews_contract() -> serde_json::Value {
    serde_json::from_str(GOAL_REVIEWS_CONTRACT).expect("goalReviewsSchema.fixtures.json parses")
}

fn migrated_with_goal() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    run_migrations(&conn).unwrap();
    conn.execute("INSERT INTO pm_goals (id, name) VALUES ('goal-1', 'G')", [])
        .unwrap();
    conn
}

fn to_sql(value: &serde_json::Value) -> rusqlite::types::Value {
    match value {
        serde_json::Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap()),
        serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
        other => panic!("unexpected contract value {other}"),
    }
}

fn insert_goal_review(
    conn: &Connection,
    row: &serde_json::Map<String, serde_json::Value>,
) -> rusqlite::Result<usize> {
    let keys: Vec<&String> = row.keys().collect();
    let sql = format!(
        "INSERT INTO pm_goal_reviews ({}) VALUES ({})",
        keys.iter()
            .map(|k| k.as_str())
            .collect::<Vec<_>>()
            .join(", "),
        (1..=keys.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    let values: Vec<rusqlite::types::Value> = keys.iter().map(|k| to_sql(&row[*k])).collect();
    conn.execute(&sql, rusqlite::params_from_iter(values))
}

fn valid_goal_review() -> serde_json::Map<String, serde_json::Value> {
    goal_reviews_contract()["validRow"]
        .as_object()
        .unwrap()
        .clone()
}

#[test]
fn goal_reviews_table_matches_the_shared_contract() {
    let conn = migrated_with_goal();
    let contract = goal_reviews_contract();
    let mut stmt = conn.prepare("PRAGMA table_info(pm_goal_reviews)").unwrap();
    let columns: Vec<serde_json::Value> = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "name": row.get::<_, String>(1)?,
                "type": row.get::<_, String>(2)?,
                "notnull": row.get::<_, i64>(3)? == 1,
                "pk": row.get::<_, i64>(5)? > 0,
            }))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(serde_json::Value::Array(columns), contract["columns"]);

    let name: String = conn
        .query_row(
            "SELECT name FROM _migrations WHERE id = ?1",
            [contract["migration"]["id"].as_i64().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(name, contract["migration"]["name"].as_str().unwrap());
}

#[test]
fn goal_reviews_accepts_the_valid_row_and_rejects_every_contract_violation() {
    let contract = goal_reviews_contract();
    let conn = migrated_with_goal();
    insert_goal_review(&conn, &valid_goal_review()).expect("valid row is stored");

    for case in contract["rejectedRows"].as_array().unwrap() {
        let conn = migrated_with_goal();
        let mut row = valid_goal_review();
        for (key, value) in case["set"].as_object().unwrap() {
            row.insert(key.clone(), value.clone());
        }
        assert!(
            insert_goal_review(&conn, &row).is_err(),
            "row with {} was stored",
            case["case"]
        );
    }
}

#[test]
fn goal_reviews_keep_one_row_per_goal_and_attempt_and_go_with_their_goal() {
    let conn = migrated_with_goal();
    insert_goal_review(&conn, &valid_goal_review()).unwrap();
    let mut second = valid_goal_review();
    second.insert("id".into(), "rev-2".into());
    assert!(insert_goal_review(&conn, &second).is_err());
    second.insert("attempt".into(), 2.into());
    insert_goal_review(&conn, &second).unwrap();

    conn.execute("DELETE FROM pm_goals WHERE id = 'goal-1'", [])
        .unwrap();
    let left: i64 = conn
        .query_row("SELECT COUNT(*) FROM pm_goal_reviews", [], |r| r.get(0))
        .unwrap();
    assert_eq!(left, 0);
}

#[test]
fn goal_reviews_migration_upgrades_an_existing_database_without_touching_ticket_reviews() {
    let conn = migrated_with_goal();
    // Roll back to what an existing project database looks like today.
    conn.execute_batch(
        "DROP TABLE pm_goal_reviews; DELETE FROM _migrations WHERE id = 21;
         INSERT INTO pm_epics (id, name) VALUES ('e1', 'E');
         INSERT INTO pm_tickets (id, epic_id, name) VALUES ('t1', 'e1', 'T');
         INSERT INTO pm_ticket_reviews (id, ticket_id, verdict, reason) VALUES ('tr1', 't1', 1, 'ok');",
    )
    .unwrap();
    run_migrations(&conn).unwrap();
    run_migrations(&conn).unwrap();
    insert_goal_review(&conn, &valid_goal_review()).unwrap();

    let goal: String = conn
        .query_row("SELECT name FROM pm_goals WHERE id = 'goal-1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(goal, "G");
    let ticket_review: (i64, String) = conn
        .query_row(
            "SELECT verdict, reason FROM pm_ticket_reviews WHERE id = 'tr1'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(ticket_review, (1, "ok".to_string()));
}

/// Fault injection: the process died after migration 21 created its schema but
/// before `_migrations` recorded it (the DDL and the marker are two statements).
/// The next start must finish the migration instead of failing on "already
/// exists" and keeping the project database from opening.
#[test]
fn goal_reviews_migration_recovers_from_a_crash_before_its_marker() {
    for (label, leftover) in [
        ("table and index", "DROP INDEX IF EXISTS __none__;"),
        ("table without index", "DROP INDEX idx_goal_reviews_goal;"),
    ] {
        let conn = migrated_with_goal();
        conn.execute_batch(&format!(
            "{leftover} DELETE FROM _migrations WHERE id = 21;"
        ))
        .unwrap();

        run_migrations(&conn).unwrap_or_else(|e| panic!("{label}: rerun failed: {e}"));

        let markers: i64 = conn
            .query_row("SELECT COUNT(*) FROM _migrations WHERE id = 21", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(markers, 1, "{label}: exactly one marker 21");
        let index: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_goal_reviews_goal'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(index, 1, "{label}: index present");
        insert_goal_review(&conn, &valid_goal_review()).expect("schema still honours the contract");
        let mut bad = valid_goal_review();
        bad.insert("id".into(), "rev-bad".into());
        bad.insert("criteria_met".into(), 0.into());
        assert!(
            insert_goal_review(&conn, &bad).is_err(),
            "{label}: constraints still hold"
        );
    }
}
