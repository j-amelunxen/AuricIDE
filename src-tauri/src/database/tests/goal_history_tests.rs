use super::*;
use crate::database::*;

fn history(conn: &rusqlite::Connection, goal_id: &str) -> Vec<(Option<String>, String, String)> {
    goal_status_history_load_impl(conn, Some(goal_id))
        .unwrap()
        .into_iter()
        .map(|e| (e.from_status, e.to_status, e.source))
        .collect()
}

fn set_status(conn: &rusqlite::Connection, goal_id: &str, status: &str) {
    conn.execute(
        "UPDATE pm_goals SET status = ?1 WHERE id = ?2",
        rusqlite::params![status, goal_id],
    )
    .unwrap();
}

#[test]
fn test_migration_24_creates_goal_status_history_table() {
    let conn = setup_in_memory_db();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='pm_goal_status_history'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn test_migration_24_backfills_one_snapshot_per_existing_goal() {
    // Roll the schema back to just before 24 and seed goals as an older app
    // would have left them.
    let conn = setup_in_memory_db();
    conn.execute_batch(
        "DROP TABLE pm_goal_status_history;
         DELETE FROM _migrations WHERE id = 24;
         INSERT INTO pm_goals (id, name, status, updated_at) \
           VALUES ('open', 'Open', 'in_progress', '2026-09-01 10:00:00');
         INSERT INTO pm_goals (id, name, status, achieved_at, updated_at) \
           VALUES ('done', 'Done', 'achieved', '2026-08-01 09:00:00', '2026-08-05 09:00:00');",
    )
    .unwrap();
    crate::database::migrations::run_migrations(&conn).unwrap();

    let open = goal_status_history_load_impl(&conn, Some("open")).unwrap();
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].from_status, None);
    assert_eq!(open[0].to_status, "in_progress");
    assert_eq!(open[0].source, "backfill");
    assert_eq!(open[0].changed_at, "2026-09-01 10:00:00");

    // An achieved goal's snapshot is dated to when it was achieved.
    let done = goal_status_history_load_impl(&conn, Some("done")).unwrap();
    assert_eq!(done[0].changed_at, "2026-08-01 09:00:00");
}

#[test]
fn test_goals_sync_records_creation_of_a_new_goal() {
    let conn = setup_in_memory_db();
    goals_sync_impl(
        &conn,
        &sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]),
    )
    .unwrap();
    assert_eq!(
        history(&conn, "g1"),
        vec![(None, "draft".into(), "ui".into())]
    );
}

#[test]
fn test_goals_sync_records_a_status_change_and_nothing_else() {
    let conn = setup_in_memory_db();
    let base = make_test_goal("g1", None);
    goals_sync_impl(&conn, &sync_payload(vec![base.clone()], vec![], vec![])).unwrap();

    // A rename is not a status change.
    let mut renamed = base.clone();
    renamed.name = "Renamed".into();
    let mut payload = sync_payload(vec![renamed.clone()], vec![], vec![]);
    payload.base_goals = vec![base.clone()];
    goals_sync_impl(&conn, &payload).unwrap();
    assert_eq!(history(&conn, "g1").len(), 1);

    let mut active = renamed.clone();
    active.status = "active".into();
    let mut payload = sync_payload(vec![active], vec![], vec![]);
    payload.base_goals = vec![renamed];
    goals_sync_impl(&conn, &payload).unwrap();
    assert_eq!(
        history(&conn, "g1").last().unwrap(),
        &(Some("draft".into()), "active".into(), "ui".into())
    );
}

#[test]
fn test_goals_sync_logs_no_change_when_the_write_is_a_conflict() {
    let conn = setup_in_memory_db();
    let base = make_test_goal("g1", None);
    goals_sync_impl(&conn, &sync_payload(vec![base.clone()], vec![], vec![])).unwrap();

    // Someone else moved the goal on since the UI loaded it.
    set_status(&conn, "g1", "in_review");

    let mut mine = base.clone();
    mine.status = "achieved".into();
    let mut payload = sync_payload(vec![mine], vec![], vec![]);
    payload.base_goals = vec![base];
    let result = goals_sync_impl(&conn, &payload).unwrap();
    assert_eq!(result.conflicts.len(), 1);

    // Only the creation row: the rejected write is not an event, and the
    // outside UPDATE was not made through a writer that logs.
    assert_eq!(history(&conn, "g1").len(), 1);
}

#[test]
fn test_deleting_a_goal_drops_its_history() {
    let conn = setup_in_memory_db();
    goals_sync_impl(
        &conn,
        &sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]),
    )
    .unwrap();
    let payload = GoalsSyncPayload {
        deleted_goal_ids: vec!["g1".into()],
        ..Default::default()
    };
    goals_sync_impl(&conn, &payload).unwrap();
    assert!(goal_status_history_load_impl(&conn, None)
        .unwrap()
        .is_empty());
}

#[test]
fn test_goals_clear_also_clears_goal_history() {
    let conn = setup_in_memory_db();
    goals_sync_impl(
        &conn,
        &sync_payload(vec![make_test_goal("g1", None)], vec![], vec![]),
    )
    .unwrap();
    goals_clear_impl(&conn).unwrap();
    assert!(goal_status_history_load_impl(&conn, None)
        .unwrap()
        .is_empty());
}
