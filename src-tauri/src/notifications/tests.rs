use super::operations::*;
use super::schema::*;
use super::types::*;
use super::watch::*;
use rusqlite::{params, Connection};

fn test_db() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory db");
    run_migrations(&conn).expect("migrations");
    conn
}

fn input(title: &str) -> NotificationInput {
    NotificationInput {
        uid: None,
        project_path: None,
        project_name: None,
        source: "ui".to_string(),
        origin: None,
        kind: None,
        severity: None,
        title: title.to_string(),
        body: None,
        actions: None,
        dedupe_key: None,
        ref_kind: None,
        ref_id: None,
        expires_at: None,
    }
}

#[test]
fn migrations_are_idempotent() {
    let conn = test_db();
    let before: i64 = conn
        .query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))
        .unwrap();

    run_migrations(&conn).expect("second run");

    let after: i64 = conn
        .query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))
        .unwrap();
    assert_eq!(before, after);
    assert!(before > 0, "expected at least one migration to be recorded");
}

#[test]
fn dispatch_returns_the_stored_row_with_defaults_applied() {
    let mut conn = test_db();
    let stored = dispatch_impl(&mut conn, &input("Hallo")).expect("dispatch");

    assert_eq!(stored.title, "Hallo");
    assert_eq!(stored.kind, "info");
    assert_eq!(stored.severity, "info");
    assert_eq!(stored.actions, serde_json::json!([]));
    assert!(stored.read_at.is_none());
    assert!(!stored.uid.is_empty());
}

#[test]
fn every_notification_insert_enqueues_one_pushover_snapshot_in_the_same_transaction() {
    struct Snapshot {
        row_id: i64,
        uid: String,
        title: String,
        body: Option<String>,
        severity: String,
        project_name: Option<String>,
        origin: Option<String>,
        status: String,
    }

    let mut conn = test_db();
    let mut notice = input("Build failed");
    notice.body = Some("The release build exited with code 1".to_string());
    notice.severity = Some("error".to_string());
    notice.project_name = Some("AuricIDE".to_string());
    notice.origin = Some("Release agent".to_string());

    let stored = dispatch_impl(&mut conn, &notice).expect("dispatch");
    let snapshot = conn
        .query_row(
            "SELECT notification_row_id, notification_uid, title, body, severity, project_name, origin, status
             FROM notification_delivery_outbox",
            [],
            |row| {
                Ok(Snapshot {
                    row_id: row.get(0)?,
                    uid: row.get(1)?,
                    title: row.get(2)?,
                    body: row.get(3)?,
                    severity: row.get(4)?,
                    project_name: row.get(5)?,
                    origin: row.get(6)?,
                    status: row.get(7)?,
                })
            },
        )
        .expect("outbox row");

    assert_eq!(snapshot.row_id, stored.id);
    assert_eq!(snapshot.uid, stored.uid);
    assert_eq!(snapshot.title, "Build failed");
    assert_eq!(
        snapshot.body.as_deref(),
        Some("The release build exited with code 1")
    );
    assert_eq!(snapshot.severity, "error");
    assert_eq!(snapshot.project_name.as_deref(), Some("AuricIDE"));
    assert_eq!(snapshot.origin.as_deref(), Some("Release agent"));
    assert_eq!(snapshot.status, "pending");
}

#[test]
fn the_outbox_trigger_covers_direct_database_writers_and_rolls_back_with_them() {
    let conn = test_db();
    let tx = conn.unchecked_transaction().expect("transaction");
    tx.execute(
        "INSERT INTO notifications (uid, source, title, severity) VALUES ('direct', 'mcp', 'Direct write', 'warn')",
        [],
    )
    .expect("direct insert");
    assert_eq!(
        tx.query_row(
            "SELECT COUNT(*) FROM notification_delivery_outbox",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    tx.rollback().expect("rollback");

    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM notification_delivery_outbox",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn dedupe_replacement_preserves_each_delivery_event_snapshot() {
    let mut conn = test_db();
    let mut first = input("Old");
    first.dedupe_key = Some("same".to_string());
    let old = dispatch_impl(&mut conn, &first).expect("first");
    let mut second = input("New");
    second.dedupe_key = Some("same".to_string());
    let new = dispatch_impl(&mut conn, &second).expect("second");

    let events: Vec<(i64, String)> = conn
        .prepare("SELECT notification_row_id, title FROM notification_delivery_outbox ORDER BY id")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        events,
        vec![(old.id, "Old".to_string()), (new.id, "New".to_string())]
    );
}

#[test]
fn exact_redispatch_of_a_logical_notification_does_not_duplicate_external_intent() {
    let mut conn = test_db();
    let mut first = input("Same");
    first.uid = Some("logical-notification".to_string());
    dispatch_impl(&mut conn, &first).expect("first");
    dispatch_impl(&mut conn, &first).expect("exact retry");

    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM notification_delivery_outbox",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );

    first.body = Some("Changed detail".to_string());
    dispatch_impl(&mut conn, &first).expect("changed retry");
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM notification_delivery_outbox",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        2
    );
}

#[test]
fn dispatch_mints_distinct_uids() {
    let mut conn = test_db();
    let a = dispatch_impl(&mut conn, &input("a")).expect("a");
    let b = dispatch_impl(&mut conn, &input("b")).expect("b");
    assert_ne!(a.uid, b.uid);
}

#[test]
fn dedupe_key_replaces_the_previous_row() {
    let mut conn = test_db();
    let mut first = input("Scan fällig");
    first.dedupe_key = Some("schedule:1".to_string());
    dispatch_impl(&mut conn, &first).expect("first");

    let mut second = input("Scan überfällig");
    second.dedupe_key = Some("schedule:1".to_string());
    dispatch_impl(&mut conn, &second).expect("second");

    let all = list_impl(&conn, None, None, None).expect("list");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].title, "Scan überfällig");
}

#[test]
fn a_deduped_row_gets_a_fresh_id_so_drained_clients_see_it_again() {
    let mut conn = test_db();
    let mut first = input("Scan fällig");
    first.dedupe_key = Some("schedule:1".to_string());
    let old = dispatch_impl(&mut conn, &first).expect("first");

    let mut second = input("Scan überfällig");
    second.dedupe_key = Some("schedule:1".to_string());
    let new = dispatch_impl(&mut conn, &second).expect("second");

    assert!(new.id > old.id);
    // A client that had drained up to the old id still receives the bump.
    let fresh = list_impl(&conn, Some(old.id), None, None).expect("list");
    assert_eq!(fresh.len(), 1);
}

#[test]
fn a_deduped_row_keeps_the_uid_it_replaced() {
    let mut conn = test_db();
    let mut first = input("Scan fällig");
    first.dedupe_key = Some("schedule:1".to_string());
    let old = dispatch_impl(&mut conn, &first).expect("first");

    let mut second = input("Scan überfällig");
    second.dedupe_key = Some("schedule:1".to_string());
    let new = dispatch_impl(&mut conn, &second).expect("second");

    // An agent polling on the uid it was handed must still find its question.
    assert_eq!(new.uid, old.uid);
}

#[test]
fn an_explicit_uid_wins_over_the_inherited_one() {
    let mut conn = test_db();
    let mut first = input("a");
    first.dedupe_key = Some("k".to_string());
    dispatch_impl(&mut conn, &first).expect("first");

    let mut second = input("b");
    second.dedupe_key = Some("k".to_string());
    second.uid = Some("chosen".to_string());
    let stored = dispatch_impl(&mut conn, &second).expect("second");

    assert_eq!(stored.uid, "chosen");
    assert_eq!(list_impl(&conn, None, None, None).unwrap().len(), 1);
}

#[test]
fn a_deduped_row_becomes_unread_again() {
    let mut conn = test_db();
    let mut first = input("Scan fällig");
    first.dedupe_key = Some("schedule:1".to_string());
    let stored = dispatch_impl(&mut conn, &first).expect("first");
    mark_read_impl(&conn, &[stored.uid.clone()]).expect("read");
    assert_eq!(unread_count_impl(&conn, None).unwrap(), 0);

    let mut second = input("Scan überfällig");
    second.dedupe_key = Some("schedule:1".to_string());
    dispatch_impl(&mut conn, &second).expect("second");

    assert_eq!(unread_count_impl(&conn, None).unwrap(), 1);
}

#[test]
fn rows_without_a_dedupe_key_never_collapse() {
    let mut conn = test_db();
    dispatch_impl(&mut conn, &input("a")).expect("a");
    dispatch_impl(&mut conn, &input("b")).expect("b");
    assert_eq!(list_impl(&conn, None, None, None).unwrap().len(), 2);
}

#[test]
fn list_filters_by_project() {
    let mut conn = test_db();
    let mut a = input("a");
    a.project_path = Some("/repo-a".to_string());
    dispatch_impl(&mut conn, &a).expect("a");
    let mut b = input("b");
    b.project_path = Some("/repo-b".to_string());
    dispatch_impl(&mut conn, &b).expect("b");

    let only_a = list_impl(&conn, None, None, Some("/repo-a")).expect("list");
    assert_eq!(only_a.len(), 1);
    assert_eq!(only_a[0].title, "a");
}

#[test]
fn list_returns_newest_first() {
    let mut conn = test_db();
    dispatch_impl(&mut conn, &input("alt")).expect("a");
    dispatch_impl(&mut conn, &input("neu")).expect("b");
    let all = list_impl(&conn, None, None, None).expect("list");
    assert_eq!(all[0].title, "neu");
}

#[test]
fn expired_rows_are_hidden_and_uncounted() {
    let mut conn = test_db();
    let mut expired = input("abgelaufen");
    expired.expires_at = Some("2000-01-01 00:00:00".to_string());
    dispatch_impl(&mut conn, &expired).expect("dispatch");

    assert!(list_impl(&conn, None, None, None).unwrap().is_empty());
    assert_eq!(unread_count_impl(&conn, None).unwrap(), 0);
}

#[test]
fn marking_read_twice_keeps_the_first_timestamp() {
    let mut conn = test_db();
    let stored = dispatch_impl(&mut conn, &input("a")).expect("dispatch");
    mark_read_impl(&conn, &[stored.uid.clone()]).expect("first");
    let first_at = list_impl(&conn, None, None, None).unwrap()[0]
        .read_at
        .clone();

    mark_read_impl(&conn, &[stored.uid.clone()]).expect("second");
    let second_at = list_impl(&conn, None, None, None).unwrap()[0]
        .read_at
        .clone();

    assert_eq!(first_at, second_at);
}

#[test]
fn answering_records_the_choice_and_marks_read() {
    let mut conn = test_db();
    let mut ask = input("Agent starten?");
    ask.kind = Some("ask".to_string());
    let stored = dispatch_impl(&mut conn, &ask).expect("dispatch");

    answer_impl(&conn, &stored.uid, "yes").expect("answer");

    let row = &list_impl(&conn, None, None, None).unwrap()[0];
    assert_eq!(row.answer.as_deref(), Some("yes"));
    assert!(row.answered_at.is_some());
    assert!(row.read_at.is_some());
}

#[test]
fn a_question_cannot_be_answered_twice() {
    let mut conn = test_db();
    let mut ask = input("Agent starten?");
    ask.kind = Some("ask".to_string());
    let stored = dispatch_impl(&mut conn, &ask).expect("dispatch");

    answer_impl(&conn, &stored.uid, "yes").expect("first");
    answer_impl(&conn, &stored.uid, "no").expect("second");

    assert_eq!(
        list_impl(&conn, None, None, None).unwrap()[0]
            .answer
            .as_deref(),
        Some("yes")
    );
}

#[test]
fn clear_spares_unanswered_questions() {
    let mut conn = test_db();
    let mut ask = input("offen?");
    ask.kind = Some("ask".to_string());
    dispatch_impl(&mut conn, &ask).expect("ask");
    dispatch_impl(&mut conn, &input("info")).expect("info");

    clear_impl(&conn, None).expect("clear");

    let left = list_impl(&conn, None, None, None).expect("list");
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].title, "offen?");
}

#[test]
fn delete_removes_only_the_named_rows_and_spares_open_questions() {
    let mut conn = test_db();
    let mut ask = input("offen?");
    ask.kind = Some("ask".to_string());
    let ask = dispatch_impl(&mut conn, &ask).expect("ask");
    let gone = dispatch_impl(&mut conn, &input("weg")).expect("gone");
    let kept = dispatch_impl(&mut conn, &input("bleibt")).expect("kept");

    delete_impl(&conn, &[ask.uid.clone(), gone.uid]).expect("delete");

    let left = list_impl(&conn, None, None, None).expect("list");
    let uids: Vec<&str> = left.iter().map(|n| n.uid.as_str()).collect();
    assert_eq!(uids.len(), 2);
    assert!(uids.contains(&ask.uid.as_str()));
    assert!(uids.contains(&kept.uid.as_str()));
}

#[test]
fn pruning_never_drops_unread_rows_even_past_the_cap() {
    let mut conn = test_db();
    for i in 0..(NOTIFICATION_CAP + 5) {
        dispatch_impl(&mut conn, &input(&format!("n{}", i))).expect("dispatch");
    }
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM notifications", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count as usize, NOTIFICATION_CAP + 5);
}

#[test]
fn pruning_trims_read_rows_back_to_the_cap() {
    let mut conn = test_db();
    for i in 0..NOTIFICATION_CAP {
        let stored = dispatch_impl(&mut conn, &input(&format!("n{}", i))).expect("dispatch");
        mark_read_impl(&conn, &[stored.uid]).expect("read");
    }
    dispatch_impl(&mut conn, &input("neueste")).expect("dispatch");

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM notifications", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count as usize, NOTIFICATION_CAP);
    // The newest survives; the oldest read row is the one that went.
    assert_eq!(
        list_impl(&conn, None, Some(1), None).unwrap()[0].title,
        "neueste"
    );
}

#[test]
fn a_malformed_actions_blob_degrades_to_no_buttons() {
    let mut conn = test_db();
    let stored = dispatch_impl(&mut conn, &input("a")).expect("dispatch");
    conn.execute(
        "UPDATE notifications SET actions = 'not json' WHERE uid = ?1",
        params![stored.uid],
    )
    .unwrap();

    let row = &list_impl(&conn, None, None, None).unwrap()[0];
    assert_eq!(row.actions, serde_json::json!([]));
}

#[test]
fn actions_survive_a_round_trip() {
    let mut conn = test_db();
    let mut with_actions = input("Agent starten?");
    with_actions.actions = Some(serde_json::json!([
        { "id": "yes", "label": "Ja", "kind": "answer", "value": "yes" }
    ]));
    let stored = dispatch_impl(&mut conn, &with_actions).expect("dispatch");

    assert_eq!(stored.actions[0]["id"], "yes");
}

#[test]
fn mark_all_read_can_be_scoped_to_one_project() {
    let mut conn = test_db();
    let mut a = input("a");
    a.project_path = Some("/repo-a".to_string());
    dispatch_impl(&mut conn, &a).expect("a");
    let mut b = input("b");
    b.project_path = Some("/repo-b".to_string());
    dispatch_impl(&mut conn, &b).expect("b");

    mark_all_read_impl(&conn, Some("/repo-a")).expect("mark");

    assert_eq!(unread_count_impl(&conn, None).unwrap(), 1);
    assert_eq!(unread_count_impl(&conn, Some("/repo-b")).unwrap(), 1);
}

// ── Launch runs: what became of an agent launch request ──────────────

fn launch_request(conn: &mut Connection, uid: &str) {
    let mut request = input("Agent requested");
    request.uid = Some(uid.to_string());
    request.source = "agent".to_string();
    request.origin = Some("request_agent_launch".to_string());
    request.dedupe_key = Some(format!("agent-launch:{uid}"));
    request.ref_kind = Some("goal".to_string());
    request.ref_id = Some("goal-1".to_string());
    request.project_path = Some("/repo".to_string());
    dispatch_impl(conn, &request).expect("dispatch");
}

fn run(uid: &str, status: &str) -> AgentLaunchRunInput {
    AgentLaunchRunInput {
        request_uid: uid.to_string(),
        agent_id: "agent-3".to_string(),
        agent_name: Some("Worker".to_string()),
        provider: Some("codex".to_string()),
        model: Some("gpt".to_string()),
        status: status.to_string(),
        summary: None,
        error: None,
        summary_only: false,
    }
}

fn stored(conn: &Connection, uid: &str) -> (String, String, Option<String>, Option<String>) {
    conn.query_row(
        "SELECT agent_id, status, summary, finished_at FROM agent_launch_runs WHERE request_uid = ?1",
        params![uid],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .expect("row")
}

#[test]
fn records_the_agent_a_launch_request_became() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");

    record_launch_run_impl(&conn, &run("req-1", "running")).expect("record");

    let (agent, status, _, finished) = stored(&conn, "req-1");
    assert_eq!((agent.as_str(), status.as_str()), ("agent-3", "running"));
    assert!(finished.is_none());
}

#[test]
fn a_finished_run_keeps_its_summary_and_end_time() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    record_launch_run_impl(&conn, &run("req-1", "running")).unwrap();

    let mut done = run("req-1", "completed");
    done.summary = Some("Tests green, PR ready".to_string());
    record_launch_run_impl(&conn, &done).unwrap();

    let (_, status, summary, finished) = stored(&conn, "req-1");
    assert_eq!(status, "completed");
    assert_eq!(summary.as_deref(), Some("Tests green, PR ready"));
    assert!(finished.is_some());
}

#[test]
fn a_finished_run_is_not_reopened() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    record_launch_run_impl(&conn, &run("req-1", "failed")).unwrap();

    record_launch_run_impl(&conn, &run("req-1", "running")).unwrap();

    assert_eq!(stored(&conn, "req-1").1, "failed");
}

// Goal 10, station 2: the backend owns the run's status; the frontend only
// adds the summary it derives from the logs, and may do so after the end.
#[test]
fn a_summary_from_the_frontend_lands_after_the_backend_finished_the_run() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    record_launch_run_impl(&conn, &run("req-1", "running")).unwrap();
    record_launch_run_impl(&conn, &run("req-1", "completed")).unwrap();

    // The store saw the exit as failed; the backend's verdict stands.
    let mut late = run("req-1", "failed");
    late.summary = Some("Tests green".to_string());
    record_launch_run_impl(&conn, &late).unwrap();

    let (_, status, summary, _) = stored(&conn, "req-1");
    assert_eq!(status, "completed");
    assert_eq!(summary.as_deref(), Some("Tests green"));
}

#[test]
fn a_summary_for_another_agent_does_not_land() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    record_launch_run_impl(&conn, &run("req-1", "completed")).unwrap();

    let mut other = run("req-1", "completed");
    other.agent_id = "agent-9".to_string();
    other.summary = Some("not mine".to_string());
    record_launch_run_impl(&conn, &other).unwrap();

    let (agent, _, summary, _) = stored(&conn, "req-1");
    assert_eq!(agent, "agent-3");
    assert!(summary.is_none());
}

/// An IDE restart leaves the run `interrupted`, not `running` forever; a
/// resume is a new agent on the same request and reopens it.
#[test]
fn an_interrupted_run_is_reopened_by_the_resumed_agent() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    record_launch_run_impl(&conn, &run("req-1", "running")).unwrap();
    record_launch_run_impl(&conn, &run("req-1", "interrupted")).unwrap();
    assert_eq!(stored(&conn, "req-1").1, "interrupted");

    let mut resumed = run("req-1", "running");
    resumed.agent_id = "agent-12".to_string();
    record_launch_run_impl(&conn, &resumed).unwrap();

    let (agent, status, _, finished) = stored(&conn, "req-1");
    assert_eq!((agent.as_str(), status.as_str()), ("agent-12", "running"));
    assert!(finished.is_none());
}

fn run_of(uid: &str, agent: &str, status: &str) -> AgentLaunchRunInput {
    AgentLaunchRunInput {
        agent_id: agent.to_string(),
        ..run(uid, status)
    }
}

fn identity(conn: &Connection, uid: &str) -> (Option<String>, Option<String>, Option<String>) {
    conn.query_row(
        "SELECT agent_name, provider, model FROM agent_launch_runs WHERE request_uid = ?1",
        params![uid],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .expect("row")
}

/// Review r1: the boot-time `interrupted` of the old agent arrives after the
/// resumed agent already reported `running`. It must not overwrite it.
#[test]
fn a_late_interrupted_of_the_old_agent_leaves_the_resumed_one_running() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    record_launch_run_impl(&conn, &run_of("req-1", "agent-2", "running")).unwrap();
    record_launch_run_impl(&conn, &run_of("req-1", "agent-2", "interrupted")).unwrap();
    record_launch_run_impl(&conn, &run_of("req-1", "agent-12", "running")).unwrap();

    record_launch_run_impl(&conn, &run_of("req-1", "agent-2", "interrupted")).unwrap();
    record_launch_run_impl(&conn, &run_of("req-1", "agent-2", "failed")).unwrap();

    let (agent, status, _, _) = stored(&conn, "req-1");
    assert_eq!((agent.as_str(), status.as_str()), ("agent-12", "running"));
}

/// A late verdict of an agent that no longer owns the run frees no slot.
#[test]
fn a_late_verdict_of_the_old_agent_keeps_the_slot() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    claim_at(&mut conn, "req-1", 5, 5).unwrap();
    record_launch_run_impl(&conn, &run_of("req-1", "agent-2", "running")).unwrap();
    record_launch_run_impl(&conn, &run_of("req-1", "agent-2", "interrupted")).unwrap();
    record_launch_run_impl(&conn, &run_of("req-1", "agent-12", "running")).unwrap();

    record_launch_run_impl(&conn, &run_of("req-1", "agent-2", "failed")).unwrap();
    let claims: i64 = conn
        .query_row("SELECT COUNT(*) FROM agent_launch_claims", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(claims, 1);

    record_launch_run_impl(&conn, &run_of("req-1", "agent-12", "completed")).unwrap();
    let claims: i64 = conn
        .query_row("SELECT COUNT(*) FROM agent_launch_claims", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(claims, 0);
}

/// Review r2: whatever write got lost — the verdict, the restart anchor, a
/// discard — a run whose IDE process is gone is not `running` after the next
/// start. The owner is the process that recorded `running`.
#[test]
fn a_running_run_of_a_dead_instance_is_interrupted_at_the_next_start() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    launch_request(&mut conn, "req-2");
    record_launch_run_impl(&conn, &run_of("req-1", "agent-1", "running")).unwrap();
    record_launch_run_impl(&conn, &run_of("req-2", "agent-2", "running")).unwrap();
    let us = std::process::id();
    conn.execute(
        "UPDATE agent_launch_runs SET owner_pid = 999999 WHERE request_uid = 'req-2'",
        [],
    )
    .unwrap();

    let reconciled = reconcile_orphaned_launch_runs_impl(&conn, &|pid| pid == us).unwrap();

    assert_eq!(reconciled, 1);
    assert_eq!(stored(&conn, "req-1").1, "running");
    assert_eq!(stored(&conn, "req-2").1, "interrupted");
}

/// Review r2: a resumed agent that ends before its own `running` landed takes
/// the interrupted run over; the late `running` does not reopen it.
#[test]
fn a_verdict_of_the_resumed_agent_takes_over_the_interrupted_run() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    record_launch_run_impl(&conn, &run_of("req-1", "agent-2", "running")).unwrap();
    record_launch_run_impl(&conn, &run_of("req-1", "agent-2", "interrupted")).unwrap();

    record_launch_run_impl(&conn, &run_of("req-1", "agent-12", "completed")).unwrap();
    record_launch_run_impl(&conn, &run_of("req-1", "agent-12", "running")).unwrap();

    let (agent, status, _, _) = stored(&conn, "req-1");
    assert_eq!((agent.as_str(), status.as_str()), ("agent-12", "completed"));
}

/// Review r2: the frontend saw `idle` for a killed agent and reports it; its
/// write carries the summary only, the backend's `killed` stands.
#[test]
fn a_frontend_summary_never_sets_the_status() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    record_launch_run_impl(&conn, &run_of("req-1", "agent-3", "running")).unwrap();

    let frontend = AgentLaunchRunInput {
        summary: Some("half done".to_string()),
        summary_only: true,
        ..run_of("req-1", "agent-3", "completed")
    };
    record_launch_run_impl(&conn, &frontend).unwrap();
    assert_eq!(stored(&conn, "req-1").1, "running");

    record_launch_run_impl(&conn, &run_of("req-1", "agent-3", "killed")).unwrap();
    let (_, status, summary, _) = stored(&conn, "req-1");
    assert_eq!(status, "killed");
    assert_eq!(summary.as_deref(), Some("half done"));
}

/// Review r1: the exit overtook the spawn record. The late `running` of the
/// same agent fills in who it was, and does not reopen the run.
#[test]
fn a_late_running_of_a_finished_agent_only_fills_in_its_identity() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    let bare = AgentLaunchRunInput {
        agent_name: None,
        provider: None,
        model: None,
        ..run_of("req-1", "agent-3", "completed")
    };
    record_launch_run_impl(&conn, &bare).unwrap();

    record_launch_run_impl(&conn, &run_of("req-1", "agent-3", "running")).unwrap();

    assert_eq!(stored(&conn, "req-1").1, "completed");
    assert_eq!(
        identity(&conn, "req-1"),
        (
            Some("Worker".to_string()),
            Some("codex".to_string()),
            Some("gpt".to_string())
        )
    );
}

#[test]
fn a_finished_run_is_not_marked_interrupted() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    record_launch_run_impl(&conn, &run("req-1", "completed")).unwrap();

    record_launch_run_impl(&conn, &run("req-1", "interrupted")).unwrap();

    assert_eq!(stored(&conn, "req-1").1, "completed");
}

/// Fault injection: the MCP server (or a second instance) holds the write
/// lock for 300 ms. The IDE's write waits (rusqlite opens with a 5 s busy
/// timeout) instead of failing with "database is locked". Guards that default,
/// which nothing in `init_db` states.
#[test]
fn recording_a_run_waits_for_another_writer_instead_of_failing() {
    use std::time::Duration;

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notifications.db");
    let mut ours = init_db(&path).unwrap();
    launch_request(&mut ours, "req-1");
    let other = init_db(&path).unwrap();
    other
        .execute_batch("BEGIN IMMEDIATE; UPDATE notifications SET title = title;")
        .unwrap();
    let holder = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        other.execute_batch("COMMIT").unwrap();
    });

    let result = record_launch_run_impl(&ours, &run("req-1", "running"));
    holder.join().unwrap();

    assert_eq!(result, Ok(()));
    assert_eq!(stored(&ours, "req-1").1, "running");
}

#[test]
fn refuses_a_run_for_something_that_is_not_a_launch_request() {
    let mut conn = test_db();
    let mut plain = input("hello");
    plain.uid = Some("plain".to_string());
    dispatch_impl(&mut conn, &plain).unwrap();

    assert!(record_launch_run_impl(&conn, &run("plain", "running")).is_err());
    assert!(record_launch_run_impl(&conn, &run("missing", "running")).is_err());
}

#[test]
fn refuses_an_unknown_run_status() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");

    let error = record_launch_run_impl(&conn, &run("req-1", "exploded")).unwrap_err();
    assert!(error.contains("exploded"), "{error}");
}

// ── Launch claims: the native, atomic gate in front of an automatic start ──

/// Every goal is under every root: for the tests that are about the claim
/// books, not about ancestry (that has its own tests below).
fn anywhere(_project: &str, _goal: &str, _root: &str) -> Result<bool, String> {
    Ok(true)
}

/// Puts grant `id` for `root-1` in `/repo` in force with these limits, the
/// way a test fixture may: straight into the table, replacing an earlier row
/// with the same id.
fn grant_row(conn: &Connection, id: &str, max_concurrent: i64, launch_budget: i64) {
    conn.execute(
        "INSERT OR REPLACE INTO agent_launch_grants
            (id, project_path, root_goal_id, max_concurrent, launch_budget)
         VALUES (?1, '/repo', 'root-1', ?2, ?3)",
        params![id, max_concurrent, launch_budget],
    )
    .expect("grant row");
}

fn claim_input(uid: &str, grant_id: &str) -> AgentLaunchClaimInput {
    AgentLaunchClaimInput {
        request_uid: uid.to_string(),
        grant_id: grant_id.to_string(),
    }
}

/// Claims `uid` under `grant-1`, whose limits are set to these first.
fn claim_at(
    conn: &mut Connection,
    uid: &str,
    max_concurrent: i64,
    launch_budget: i64,
) -> Result<LaunchClaimOutcome, String> {
    grant_row(conn, "grant-1", max_concurrent, launch_budget);
    claim_launch_impl(conn, &claim_input(uid, "grant-1"), &anywhere)
}

fn read_at(conn: &Connection, uid: &str) -> Option<String> {
    conn.query_row(
        "SELECT read_at FROM notifications WHERE uid = ?1",
        params![uid],
        |row| row.get(0),
    )
    .expect("row")
}

#[test]
fn a_claim_takes_the_request_books_the_budget_and_marks_it_read() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");

    let outcome = claim_at(&mut conn, "req-1", 2, 3).expect("claim");

    assert_eq!(outcome, LaunchClaimOutcome::Claimed);
    assert!(read_at(&conn, "req-1").is_some());
    assert_eq!(launch_grant_usage_impl(&conn, "grant-1").unwrap(), 1);
}

#[test]
fn the_same_request_cannot_be_claimed_twice() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    claim_at(&mut conn, "req-1", 5, 5).unwrap();

    let second = claim_at(&mut conn, "req-1", 5, 5).unwrap();

    assert_eq!(second, LaunchClaimOutcome::AlreadyClaimed);
    assert_eq!(launch_grant_usage_impl(&conn, "grant-1").unwrap(), 1);
}

#[test]
fn a_request_someone_already_read_or_answered_is_not_claimable() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    launch_request(&mut conn, "req-2");
    mark_read_impl(&conn, &["req-1".to_string()]).unwrap();
    answer_impl(&conn, "req-2", "agent:x").unwrap();

    for uid in ["req-1", "req-2"] {
        assert_eq!(
            claim_at(&mut conn, uid, 5, 5).unwrap(),
            LaunchClaimOutcome::AlreadyClaimed
        );
    }
    assert_eq!(launch_grant_usage_impl(&conn, "grant-1").unwrap(), 0);
}

#[test]
fn a_claim_at_the_concurrency_limit_is_refused_and_leaves_the_request_untouched() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    launch_request(&mut conn, "req-2");
    claim_at(&mut conn, "req-1", 1, 5).unwrap();

    let outcome = claim_at(&mut conn, "req-2", 1, 5).unwrap();

    assert_eq!(outcome, LaunchClaimOutcome::AtCapacity);
    assert!(
        read_at(&conn, "req-2").is_none(),
        "refused claim must not mark it read"
    );
    assert_eq!(launch_grant_usage_impl(&conn, "grant-1").unwrap(), 1);
}

#[test]
fn a_finished_run_frees_its_slot_but_not_its_budget() {
    let mut conn = test_db();
    for uid in ["req-1", "req-2", "req-3"] {
        launch_request(&mut conn, uid);
    }
    claim_at(&mut conn, "req-1", 1, 2).unwrap();
    record_launch_run_impl(&conn, &run("req-1", "running")).unwrap();
    record_launch_run_impl(&conn, &run("req-1", "completed")).unwrap();

    assert_eq!(
        claim_at(&mut conn, "req-2", 1, 2).unwrap(),
        LaunchClaimOutcome::Claimed
    );
    release_launch_claim_impl(&conn, "req-2").unwrap();
    assert_eq!(
        claim_at(&mut conn, "req-3", 1, 2).unwrap(),
        LaunchClaimOutcome::BudgetSpent
    );
    assert!(read_at(&conn, "req-3").is_none());
}

#[test]
fn a_running_record_does_not_free_the_slot() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    launch_request(&mut conn, "req-2");
    claim_at(&mut conn, "req-1", 1, 5).unwrap();
    record_launch_run_impl(&conn, &run("req-1", "running")).unwrap();

    assert_eq!(
        claim_at(&mut conn, "req-2", 1, 5).unwrap(),
        LaunchClaimOutcome::AtCapacity
    );
}

#[test]
fn deleting_the_request_keeps_the_budget_spent_and_the_slot_taken() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    launch_request(&mut conn, "req-2");
    claim_at(&mut conn, "req-1", 1, 5).unwrap();
    delete_impl(&conn, &["req-1".to_string()]).unwrap();

    assert_eq!(launch_grant_usage_impl(&conn, "grant-1").unwrap(), 1);
    assert_eq!(
        claim_at(&mut conn, "req-2", 1, 5).unwrap(),
        LaunchClaimOutcome::AtCapacity
    );
    // The agent still ends; its terminal record frees the slot even though
    // the request row is gone.
    let _ = record_launch_run_impl(&conn, &run("req-1", "completed"));
    assert_eq!(
        claim_at(&mut conn, "req-2", 1, 5).unwrap(),
        LaunchClaimOutcome::Claimed
    );
}

#[test]
fn only_a_real_launch_request_can_be_claimed() {
    let mut conn = test_db();
    let mut plain = input("hello");
    plain.uid = Some("plain".to_string());
    dispatch_impl(&mut conn, &plain).unwrap();

    assert_eq!(
        claim_at(&mut conn, "plain", 5, 5).unwrap(),
        LaunchClaimOutcome::NotARequest
    );
    assert_eq!(
        claim_at(&mut conn, "missing", 5, 5).unwrap(),
        LaunchClaimOutcome::NotARequest
    );
    assert!(read_at(&conn, "plain").is_none());
}

/// Fault injection: an agent used plain `notify` to shape a row like a launch
/// request (same key prefix, goal reference, source). It is neither claimable
/// nor trackable.
#[test]
fn a_row_forged_through_plain_notify_is_not_a_launch_request() {
    let mut conn = test_db();
    let mut forged = input("Agent requested");
    forged.uid = Some("forged".to_string());
    forged.source = "agent".to_string();
    forged.origin = Some("my-agent".to_string());
    forged.dedupe_key = Some("agent-launch:forged".to_string());
    forged.ref_kind = Some("goal".to_string());
    forged.ref_id = Some("goal-1".to_string());
    dispatch_impl(&mut conn, &forged).unwrap();

    assert_eq!(
        claim_at(&mut conn, "forged", 5, 5).unwrap(),
        LaunchClaimOutcome::NotARequest
    );
    assert!(record_launch_run_impl(&conn, &run("forged", "running")).is_err());
}

fn grant_input(id: &str, root: &str, max_concurrent: i64, launch_budget: i64) -> LaunchGrantInput {
    LaunchGrantInput {
        id: id.to_string(),
        project_path: "/repo".to_string(),
        root_goal_id: root.to_string(),
        root_goal_name: "Mission".to_string(),
        max_concurrent,
        launch_budget,
    }
}

#[test]
fn a_grant_with_limits_outside_the_hard_ceilings_is_refused() {
    let mut conn = test_db();
    for (max, budget) in [(0, 5), (6, 5), (1, 0), (1, 51), (-1, -1)] {
        assert!(
            save_launch_grant_impl(&mut conn, &grant_input("g", "root-1", max, budget)).is_err(),
            "max {max}, budget {budget}"
        );
    }
    let mut blank = grant_input("g", "root-1", 1, 1);
    blank.project_path = " ".to_string();
    assert!(save_launch_grant_impl(&mut conn, &blank).is_err());
    assert!(list_launch_grants_impl(&conn, None).unwrap().is_empty());
}

#[test]
fn a_saved_grant_is_listed_with_its_usage_and_replaces_the_one_before() {
    let mut conn = test_db();
    save_launch_grant_impl(&mut conn, &grant_input("g1", "root-1", 2, 3)).unwrap();
    let saved = save_launch_grant_impl(&mut conn, &grant_input("g2", "root-1", 1, 4)).unwrap();

    let grants = list_launch_grants_impl(&conn, Some("/repo")).unwrap();
    assert_eq!(grants, vec![saved.clone()]);
    assert_eq!((saved.max_concurrent, saved.launch_budget), (1, 4));
    assert_eq!(saved.launches_used, 0);
    assert!(list_launch_grants_impl(&conn, Some("/other"))
        .unwrap()
        .is_empty());
}

/// Two app instances share the inbox file: a revoke acknowledged in one is
/// in force for the next claim in the other, and a claim carrying the old
/// grant id is refused without touching the request.
#[test]
fn a_revoke_in_one_instance_stops_the_next_claim_in_the_other() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notifications.db");
    let mut first = init_db(&path).unwrap();
    let second = init_db(&path).unwrap();
    launch_request(&mut first, "req-1");
    save_launch_grant_impl(&mut first, &grant_input("g1", "root-1", 2, 5)).unwrap();
    assert_eq!(list_launch_grants_impl(&second, None).unwrap().len(), 1);

    revoke_launch_grant_impl(&second, "g1").expect("revoke acknowledged");

    assert!(list_launch_grants_impl(&first, None).unwrap().is_empty());
    assert_eq!(
        claim_launch_impl(&mut first, &claim_input("req-1", "g1"), &anywhere).unwrap(),
        LaunchClaimOutcome::NoGrant
    );
    assert!(read_at(&first, "req-1").is_none());
    assert_eq!(launch_grant_usage_impl(&first, "g1").unwrap(), 0);
}

/// Review r3, blocker 3: instance one shows g1, instance two replaced it with
/// g2. Revoking g1 from instance one must not look like success while g2
/// keeps authorising starts: it is a conflict naming the grant in force, and
/// g2 stays untouched.
#[test]
fn revoking_a_replaced_grant_is_a_conflict_not_a_success() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notifications.db");
    let mut first = init_db(&path).unwrap();
    let mut second = init_db(&path).unwrap();
    save_launch_grant_impl(&mut first, &grant_input("g1", "root-1", 2, 5)).unwrap();
    save_launch_grant_impl(&mut second, &grant_input("g2", "root-1", 2, 5)).unwrap();

    let error = revoke_launch_grant_impl(&first, "g1").unwrap_err();

    assert!(error.contains("no longer in force"), "{error}");
    assert!(error.contains("g2"), "{error}");
    let in_force = list_launch_grants_impl(&first, None).unwrap();
    assert_eq!(in_force.len(), 1);
    assert_eq!(in_force[0].id, "g2");
}

#[test]
fn revoking_an_unknown_or_already_revoked_grant_is_an_error() {
    let mut conn = test_db();
    save_launch_grant_impl(&mut conn, &grant_input("g1", "root-1", 2, 5)).unwrap();
    revoke_launch_grant_impl(&conn, "g1").expect("first revoke");

    let again = revoke_launch_grant_impl(&conn, "g1").unwrap_err();
    assert!(again.contains("already revoked"), "{again}");
    let unknown = revoke_launch_grant_impl(&conn, "nope").unwrap_err();
    assert!(unknown.contains("does not exist"), "{unknown}");
}

#[test]
fn a_replaced_grant_id_no_longer_claims() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    save_launch_grant_impl(&mut conn, &grant_input("g1", "root-1", 2, 5)).unwrap();
    save_launch_grant_impl(&mut conn, &grant_input("g2", "root-1", 2, 5)).unwrap();

    assert_eq!(
        claim_launch_impl(&mut conn, &claim_input("req-1", "g1"), &anywhere).unwrap(),
        LaunchClaimOutcome::NoGrant
    );
    assert_eq!(
        claim_launch_impl(&mut conn, &claim_input("req-1", "g2"), &anywhere).unwrap(),
        LaunchClaimOutcome::Claimed
    );
}

#[test]
fn an_unknown_grant_or_one_for_another_project_does_not_claim() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    let mut elsewhere = grant_input("g-other", "root-1", 2, 5);
    elsewhere.project_path = "/other-repo".to_string();
    save_launch_grant_impl(&mut conn, &elsewhere).unwrap();

    for grant in ["missing", "g-other"] {
        assert_eq!(
            claim_launch_impl(&mut conn, &claim_input("req-1", grant), &anywhere).unwrap(),
            LaunchClaimOutcome::NoGrant,
            "{grant}"
        );
    }
    assert!(read_at(&conn, "req-1").is_none());
}

/// Fault injection: a grant write that cannot be persisted is an error the
/// UI sees, not a grant that only looks saved.
#[test]
fn a_grant_or_revoke_that_cannot_be_written_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notifications.db");
    let mut setup = init_db(&path).unwrap();
    save_launch_grant_impl(&mut setup, &grant_input("g1", "root-1", 1, 1)).unwrap();
    drop(setup);
    let mut read_only =
        Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();

    assert!(save_launch_grant_impl(&mut read_only, &grant_input("g2", "root-2", 1, 1)).is_err());
    assert!(revoke_launch_grant_impl(&read_only, "g1").is_err());
    assert_eq!(list_launch_grants_impl(&read_only, None).unwrap().len(), 1);
}

#[test]
fn a_request_written_before_the_grant_is_claimable_once_granted() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-early");
    conn.execute(
        "UPDATE notifications SET created_at = datetime('now', '-1 hour') WHERE uid = 'req-early'",
        [],
    )
    .unwrap();

    save_launch_grant_impl(&mut conn, &grant_input("g1", "root-1", 1, 1)).unwrap();

    assert_eq!(
        claim_launch_impl(&mut conn, &claim_input("req-early", "g1"), &anywhere).unwrap(),
        LaunchClaimOutcome::Claimed
    );
}

// ── Goal ancestry: read from project.db inside the claim ────────────────

/// A project folder with `.auric/project.db` holding just the goal tree.
fn project_with_goals(goals: &[(&str, Option<&str>)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join(".auric")).unwrap();
    let db = Connection::open(dir.path().join(".auric/project.db")).unwrap();
    db.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE pm_goals (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL DEFAULT '');",
    )
    .unwrap();
    for (id, parent) in goals {
        db.execute(
            "INSERT INTO pm_goals (id, parent_id) VALUES (?1, ?2)",
            params![id, parent],
        )
        .unwrap();
    }
    dir
}

#[test]
fn ancestry_is_read_from_the_project_database() {
    let project = project_with_goals(&[
        ("root-1", None),
        ("mid", Some("root-1")),
        ("goal-1", Some("mid")),
        ("root-2", None),
        ("loop-a", Some("loop-b")),
        ("loop-b", Some("loop-a")),
    ]);
    let path = project.path().to_string_lossy().into_owned();

    assert!(goal_is_under_root_in_project(&path, "goal-1", "root-1").unwrap());
    assert!(goal_is_under_root_in_project(&path, "root-1", "root-1").unwrap());
    assert!(!goal_is_under_root_in_project(&path, "goal-1", "root-2").unwrap());
    assert!(!goal_is_under_root_in_project(&path, "missing", "root-1").unwrap());
    assert!(!goal_is_under_root_in_project(&path, "loop-a", "root-1").unwrap());
    assert!(goal_is_under_root_in_project("/no/such/project", "goal-1", "root-1").is_err());
}

/// Goal 10, station 4: a deleted mission root no longer exists for a grant —
/// not as its own root, and not as the parent a surviving goal still names.
#[test]
fn a_deleted_root_is_under_nothing_and_nothing_is_under_it() {
    let project = project_with_goals(&[("root-1", None), ("goal-1", Some("root-1"))]);
    let path = project.path().to_string_lossy().into_owned();
    Connection::open(project.path().join(".auric/project.db"))
        .unwrap()
        .execute("DELETE FROM pm_goals WHERE id = 'root-1'", [])
        .unwrap();

    assert!(!goal_is_under_root_in_project(&path, "root-1", "root-1").unwrap());
    assert!(!goal_is_under_root_in_project(&path, "goal-1", "root-1").unwrap());
}

/// The same at the claim: a request waiting on the root itself, the root
/// deleted through another connection after the grant was given.
#[test]
fn a_request_on_a_deleted_root_is_not_claimed() {
    let project = project_with_goals(&[("root-1", None)]);
    let path = project.path().to_string_lossy().into_owned();
    let mut conn = test_db();
    let mut request = input("Agent requested");
    request.uid = Some("req-1".to_string());
    request.source = "agent".to_string();
    request.origin = Some("request_agent_launch".to_string());
    request.dedupe_key = Some("agent-launch:req-1".to_string());
    request.ref_kind = Some("goal".to_string());
    request.ref_id = Some("root-1".to_string());
    request.project_path = Some(path.clone());
    dispatch_impl(&mut conn, &request).unwrap();
    let mut grant = grant_input("g1", "root-1", 2, 5);
    grant.project_path = path.clone();
    save_launch_grant_impl(&mut conn, &grant).unwrap();
    Connection::open(project.path().join(".auric/project.db"))
        .unwrap()
        .execute("DELETE FROM pm_goals WHERE id = 'root-1'", [])
        .unwrap();

    let outcome = claim_launch_impl(
        &mut conn,
        &claim_input("req-1", "g1"),
        &goal_is_under_root_in_project,
    )
    .unwrap();

    assert_eq!(outcome, LaunchClaimOutcome::OutsideRoot);
    assert_eq!(launch_grant_usage_impl(&conn, "g1").unwrap(), 0);
}

/// The goal is under the granted root when the UI loaded it; a second
/// connection (an agent through MCP) moves it to another mission; the claim
/// reads the current tree and refuses, without booking anything.
#[test]
fn a_goal_moved_out_of_the_granted_root_by_another_connection_is_not_claimed() {
    let project = project_with_goals(&[
        ("root-1", None),
        ("root-2", None),
        ("goal-1", Some("root-1")),
    ]);
    let path = project.path().to_string_lossy().into_owned();
    let mut conn = test_db();
    let mut request = input("Agent requested");
    request.uid = Some("req-1".to_string());
    request.source = "agent".to_string();
    request.origin = Some("request_agent_launch".to_string());
    request.dedupe_key = Some("agent-launch:req-1".to_string());
    request.ref_kind = Some("goal".to_string());
    request.ref_id = Some("goal-1".to_string());
    request.project_path = Some(path.clone());
    dispatch_impl(&mut conn, &request).unwrap();
    let mut grant = grant_input("g1", "root-1", 2, 5);
    grant.project_path = path.clone();
    save_launch_grant_impl(&mut conn, &grant).unwrap();
    assert!(goal_is_under_root_in_project(&path, "goal-1", "root-1").unwrap());

    let mover = Connection::open(project.path().join(".auric/project.db")).unwrap();
    mover
        .execute(
            "UPDATE pm_goals SET parent_id = 'root-2' WHERE id = 'goal-1'",
            [],
        )
        .unwrap();

    let outcome = claim_launch_impl(
        &mut conn,
        &claim_input("req-1", "g1"),
        &goal_is_under_root_in_project,
    )
    .unwrap();
    assert_eq!(outcome, LaunchClaimOutcome::OutsideRoot);
    assert!(read_at(&conn, "req-1").is_none());
    assert_eq!(launch_grant_usage_impl(&conn, "g1").unwrap(), 0);
}

#[test]
fn an_unreadable_project_database_refuses_the_claim() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    grant_row(&conn, "grant-1", 1, 1);

    let result = claim_launch_impl(
        &mut conn,
        &claim_input("req-1", "grant-1"),
        &goal_is_under_root_in_project,
    );

    assert!(result.is_err(), "{result:?}");
    assert!(read_at(&conn, "req-1").is_none());
}

/// Two app instances (dev build and installed bundle share the app data
/// folder) race for the same request and for the last slot. Each has its own
/// connection; exactly one may win either race.
#[test]
fn two_connections_racing_for_one_request_and_one_slot_yield_one_start() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notifications.db");
    let mut setup = init_db(&path).unwrap();
    for uid in ["same", "a", "b"] {
        launch_request(&mut setup, uid);
    }
    drop(setup);

    let race = |uids: [&'static str; 2]| -> Vec<LaunchClaimOutcome> {
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles: Vec<_> = uids
            .into_iter()
            .map(|uid| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let mut conn = init_db(&path).unwrap();
                    barrier.wait();
                    claim_at(&mut conn, uid, 1, 10).unwrap()
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    };

    let same = race(["same", "same"]);
    assert_eq!(
        same.iter()
            .filter(|o| **o == LaunchClaimOutcome::Claimed)
            .count(),
        1,
        "{same:?}"
    );

    let conn = init_db(&path).unwrap();
    release_launch_claim_impl(&conn, "same").unwrap();
    drop(conn);

    let slot = race(["a", "b"]);
    assert_eq!(
        slot.iter()
            .filter(|o| **o == LaunchClaimOutcome::Claimed)
            .count(),
        1,
        "{slot:?}"
    );
    assert!(slot.contains(&LaunchClaimOutcome::AtCapacity), "{slot:?}");
}

// ── Retention: a launch run goes when its request goes ─────────────────

fn run_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM agent_launch_runs", [], |r| r.get(0))
        .unwrap()
}

#[test]
fn deleting_a_request_deletes_its_run() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    record_launch_run_impl(&conn, &run("req-1", "completed")).unwrap();
    mark_read_impl(&conn, &["req-1".to_string()]).unwrap();

    delete_impl(&conn, &["req-1".to_string()]).unwrap();

    assert_eq!(run_count(&conn), 0);
}

#[test]
fn clearing_the_inbox_deletes_the_runs_of_the_cleared_requests() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    record_launch_run_impl(&conn, &run("req-1", "completed")).unwrap();

    clear_impl(&conn, Some("/repo")).unwrap();

    assert_eq!(run_count(&conn), 0);
}

#[test]
fn pruning_deletes_the_runs_of_pruned_requests_only() {
    let mut conn = test_db();
    launch_request(&mut conn, "old");
    record_launch_run_impl(&conn, &run("old", "completed")).unwrap();
    mark_read_impl(&conn, &["old".to_string()]).unwrap();
    for n in 0..NOTIFICATION_CAP {
        let mut filler = input("filler");
        filler.uid = Some(format!("f-{n}"));
        dispatch_impl(&mut conn, &filler).unwrap();
    }
    launch_request(&mut conn, "new");
    record_launch_run_impl(&conn, &run("new", "running")).unwrap();

    prune(&conn).unwrap();

    let remaining: Vec<String> = conn
        .prepare("SELECT request_uid FROM agent_launch_runs")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(remaining, vec!["new".to_string()]);
}

#[test]
fn a_reissued_grant_gets_a_fresh_budget_but_no_extra_slots() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    launch_request(&mut conn, "req-2");
    claim_at(&mut conn, "req-1", 1, 1).unwrap();

    conn.execute(
        "UPDATE agent_launch_grants SET revoked_at = datetime('now') WHERE id = 'grant-1'",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO agent_launch_grants (id, project_path, root_goal_id, max_concurrent, launch_budget)
         VALUES ('grant-2', '/repo', 'root-1', 1, 1)",
        [],
    )
    .unwrap();
    let reissued = claim_input("req-2", "grant-2");
    assert_eq!(
        claim_launch_impl(&mut conn, &reissued, &anywhere).unwrap(),
        LaunchClaimOutcome::AtCapacity
    );
    release_launch_claim_impl(&conn, "req-1").unwrap();
    assert_eq!(
        claim_launch_impl(&mut conn, &reissued, &anywhere).unwrap(),
        LaunchClaimOutcome::Claimed
    );
}

/// Crash recovery: slots held by an app instance that no longer runs (its
/// agents died with it) are freed on the next start; live owners keep theirs.
#[test]
fn slots_of_a_dead_app_instance_are_freed_and_live_ones_kept() {
    let mut conn = test_db();
    for uid in ["dead-1", "live-1", "req-3"] {
        launch_request(&mut conn, uid);
    }
    claim_at(&mut conn, "dead-1", 2, 10).unwrap();
    claim_at(&mut conn, "live-1", 2, 10).unwrap();
    conn.execute(
        "UPDATE agent_launch_claims SET owner_pid = 999999 WHERE request_uid = 'dead-1'",
        [],
    )
    .unwrap();
    assert_eq!(
        claim_at(&mut conn, "req-3", 2, 10).unwrap(),
        LaunchClaimOutcome::AtCapacity
    );

    let freed = release_orphaned_launch_claims_impl(&conn, &|pid| pid != 999999).unwrap();

    assert_eq!(freed, 1);
    assert_eq!(
        claim_at(&mut conn, "req-3", 2, 10).unwrap(),
        LaunchClaimOutcome::Claimed
    );
    assert_eq!(launch_grant_usage_impl(&conn, "grant-1").unwrap(), 3);
}

#[test]
fn a_claim_records_the_instance_that_holds_it() {
    let mut conn = test_db();
    launch_request(&mut conn, "req-1");
    claim_at(&mut conn, "req-1", 1, 1).unwrap();
    let owner: i64 = conn
        .query_row("SELECT owner_pid FROM agent_launch_claims", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(owner, i64::from(std::process::id()));
    // The running process itself is always alive.
    assert!(process_is_alive(std::process::id()));
}

// ── The native claim replayed against the Lean oracle (REQ-LAUNCH-01..03) ──
//
// `verification/contracts/launch-gate-v1.jsonl` holds generated traces with the
// decision the proved model (`verification/lean/AuricIDE/LaunchGate.lean`)
// takes at every step. Everything goes through the real implementation on real
// databases, with two app instances on one `notifications.db` file:
//
// * grants are saved as rows (`save_launch_grant_impl`, which also replaces the
//   root's grant in force) and revoked by id from the other instance
//   (`revoke_launch_grant_impl`), stale ids included;
// * the goal tree is a real `<project>/.auric/project.db`: every request's goal
//   sits under `mid-<root>` below `root-<root>`, a move rewrites its
//   `parent_id` through a third connection, and the claim asks
//   `goal_is_under_root_in_project`, the production ancestry;
// * an attempt claims (`claim_launch_impl`) with the grant id the trace says
//   the deciding instance holds, alternating instances by request uid.

/// Knobs for mutants of the replay; the real replay uses the default.
#[derive(Clone, Copy, Default)]
struct OracleMutant {
    /// Answers every ancestry question with yes instead of reading project.db.
    ignore_ancestry: bool,
    /// Drops revocations instead of writing them.
    drop_revokes: bool,
}

/// Two app instances on one notifications.db, plus a real project.db.
struct OracleWorld {
    _inbox: tempfile::TempDir,
    _project: tempfile::TempDir,
    project_path: String,
    instances: [Connection; 2],
    goals: Connection,
    next_grant: i64,
    written: std::collections::HashSet<i64>,
}

const ORACLE_ROOTS: i64 = 3;

impl OracleWorld {
    fn new() -> Self {
        let inbox = tempfile::tempdir().unwrap();
        let path = inbox.path().join("notifications.db");
        let instances = [init_db(&path).unwrap(), init_db(&path).unwrap()];
        let tree: Vec<(String, Option<String>)> = (0..ORACLE_ROOTS)
            .flat_map(|r| {
                [
                    (format!("root-{r}"), None),
                    (format!("mid-{r}"), Some(format!("root-{r}"))),
                ]
            })
            .collect();
        let tree: Vec<(&str, Option<&str>)> = tree
            .iter()
            .map(|(id, parent)| (id.as_str(), parent.as_deref()))
            .collect();
        let project = project_with_goals(&tree);
        let goals = Connection::open(project.path().join(".auric/project.db")).unwrap();
        OracleWorld {
            project_path: project.path().to_string_lossy().into_owned(),
            _inbox: inbox,
            _project: project,
            instances,
            goals,
            next_grant: 0,
            written: Default::default(),
        }
    }

    fn request(&mut self, uid: i64, root: i64) {
        if !self.written.insert(uid) {
            return;
        }
        let mut request = input("Agent requested");
        request.uid = Some(format!("u{uid}"));
        request.source = "agent".to_string();
        request.origin = Some("request_agent_launch".to_string());
        request.dedupe_key = Some(format!("agent-launch:u{uid}"));
        request.ref_kind = Some("goal".to_string());
        request.ref_id = Some(format!("goal-u{uid}"));
        request.project_path = Some(self.project_path.clone());
        dispatch_impl(&mut self.instances[0], &request).expect("dispatch");
        self.goals
            .execute(
                "INSERT INTO pm_goals (id, parent_id) VALUES (?1, ?2)",
                params![format!("goal-u{uid}"), format!("mid-{root}")],
            )
            .expect("goal");
    }

    fn grant(&mut self, root: i64, max_concurrent: i64, launch_budget: i64) {
        let grant = LaunchGrantInput {
            id: format!("grant-{}", self.next_grant),
            project_path: self.project_path.clone(),
            root_goal_id: format!("root-{root}"),
            root_goal_name: String::new(),
            max_concurrent,
            launch_budget,
        };
        let instance = (self.next_grant % 2) as usize;
        save_launch_grant_impl(&mut self.instances[instance], &grant).expect("grant");
        self.next_grant += 1;
    }

    fn attempt(&mut self, uid: i64, grant: i64, mutant: OracleMutant) -> String {
        let ancestry = move |project: &str, goal: &str, root: &str| -> Result<bool, String> {
            if mutant.ignore_ancestry {
                return Ok(true);
            }
            goal_is_under_root_in_project(project, goal, root)
        };
        let input = claim_input(&format!("u{uid}"), &format!("grant-{grant}"));
        let instance = &mut self.instances[(uid % 2) as usize];
        claim_outcome_name(claim_launch_impl(instance, &input, &ancestry).expect("claim"))
            .to_string()
    }

    fn apply(&mut self, event: &serde_json::Value, mutant: OracleMutant) -> Option<String> {
        let num = |key: &str| event[key].as_i64().expect(key);
        let uid = || format!("u{}", num("uid"));
        match event["kind"].as_str().expect("kind") {
            "grant" => self.grant(num("root"), num("maxConcurrent"), num("launchBudget")),
            "revoke" if mutant.drop_revokes => {}
            "revoke" => {
                // Stale ids are part of the traces. The state effect is the
                // model's (only the grant in force is revoked); the answer is
                // Ok exactly for that grant and an error for a stale one.
                let id = format!("grant-{}", num("grant"));
                let in_force = list_launch_grants_impl(&self.instances[1], None)
                    .expect("list")
                    .iter()
                    .any(|grant| grant.id == id);
                let answer = revoke_launch_grant_impl(&self.instances[1], &id);
                assert_eq!(answer.is_ok(), in_force, "revoke {id}: {answer:?}");
            }
            "request" => self.request(num("uid"), num("root")),
            "move" => {
                self.goals
                    .execute(
                        "UPDATE pm_goals SET parent_id = ?1 WHERE id = ?2",
                        params![
                            format!("mid-{}", num("root")),
                            format!("goal-u{}", num("uid"))
                        ],
                    )
                    .expect("move");
            }
            "attempt" => return Some(self.attempt(num("uid"), num("grant"), mutant)),
            // An unwritten uid is not a launch request: the store refuses the run.
            "running" => {
                let _ = record_launch_run_impl(&self.instances[0], &run(&uid(), "running"));
            }
            "finished" => {
                let _ = record_launch_run_impl(&self.instances[1], &run(&uid(), "completed"));
            }
            "spawn-failed" => release_launch_claim_impl(&self.instances[0], &uid()).unwrap(),
            other => panic!("unknown event kind {other}"),
        }
        None
    }

    fn held(&self) -> Vec<i64> {
        (0..ORACLE_ROOTS)
            .map(|root| {
                self.instances[0]
                    .query_row(
                        "SELECT COUNT(*) FROM agent_launch_claims WHERE root_goal_id = ?1",
                        params![format!("root-{root}")],
                        |r| r.get(0),
                    )
                    .unwrap()
            })
            .collect()
    }

    fn used(&self) -> Vec<i64> {
        (0..self.next_grant)
            .map(|id| launch_grant_usage_impl(&self.instances[1], &format!("grant-{id}")).unwrap())
            .collect()
    }
}

fn claim_outcome_name(outcome: LaunchClaimOutcome) -> &'static str {
    match outcome {
        LaunchClaimOutcome::Claimed => "start",
        LaunchClaimOutcome::NoGrant => "no-grant",
        LaunchClaimOutcome::OutsideRoot => "outside-root",
        LaunchClaimOutcome::AlreadyClaimed => "already-claimed",
        LaunchClaimOutcome::AtCapacity => "at-capacity",
        LaunchClaimOutcome::BudgetSpent => "budget-spent",
        LaunchClaimOutcome::NotARequest => "not-a-request",
    }
}

type OracleOutcome = (Vec<Option<String>>, Vec<i64>, Vec<i64>);

fn replay_oracle_trace(trace: &serde_json::Value, mutant: OracleMutant) -> OracleOutcome {
    let mut world = OracleWorld::new();
    let decisions = trace["events"]
        .as_array()
        .expect("events")
        .iter()
        .map(|event| world.apply(event, mutant))
        .collect();
    (decisions, world.held(), world.used())
}

fn oracle_traces() -> Vec<serde_json::Value> {
    let corpus = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../verification/contracts/launch-gate-v1.jsonl"),
    )
    .expect("launch-gate corpus");
    corpus
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn oracle_expected(trace: &serde_json::Value) -> OracleOutcome {
    let decisions = trace["decisions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d.as_str().map(str::to_string))
        .collect();
    let held = serde_json::from_value(trace["final"]["heldCount"].clone()).unwrap();
    let used = serde_json::from_value(trace["final"]["used"].clone()).unwrap();
    (decisions, held, used)
}

#[test]
fn the_native_claim_agrees_with_the_lean_oracle_on_every_trace() {
    let traces = oracle_traces();
    for trace in &traces {
        let (decisions, held, used) = replay_oracle_trace(trace, OracleMutant::default());
        let (expected, expected_held, expected_used) = oracle_expected(trace);
        let index = &trace["trace"];
        assert_eq!(decisions, expected, "decisions of trace {index}");
        assert_eq!(held, expected_held, "held slots after trace {index}");
        assert_eq!(used, expected_used, "usage after trace {index}");
    }
    assert!(
        traces.len() >= 300,
        "corpus has only {} traces",
        traces.len()
    );
}

/// The corpus must tell a broken claim from the real one: with ancestry
/// ignored or revocations dropped, the replay disagrees somewhere.
#[test]
fn the_native_claim_agrees_with_the_lean_oracle_only_when_intact() {
    let traces = oracle_traces();
    let mutants = [
        (
            "ancestry ignored",
            OracleMutant {
                ignore_ancestry: true,
                ..Default::default()
            },
        ),
        (
            "revocations dropped",
            OracleMutant {
                drop_revokes: true,
                ..Default::default()
            },
        ),
    ];
    for (name, mutant) in mutants {
        let caught = traces
            .iter()
            .filter(|trace| replay_oracle_trace(trace, mutant) != oracle_expected(trace))
            .count();
        eprintln!("oracle mutant '{name}': {caught} disagreeing traces");
        assert!(caught > 0, "mutant '{name}' survived the corpus");
    }
}

/// Goal 10, station 1: a grant written by a second instance 50 ms after an
/// earlier write must still be announced, after it landed. Both connections
/// stay open, as a second instance and the MCP server keep theirs: macOS then
/// reports no file event for either write, and before the fix nothing was
/// announced at all (and a second event inside the 300 ms window was dropped).
#[test]
fn the_watcher_announces_a_grant_written_right_after_another_write() {
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notifications.db");
    let mut first = init_db(&path).unwrap();
    let mut second = init_db(&path).unwrap();
    let calls = Arc::new(Mutex::new(Vec::<Instant>::new()));
    let sink = Arc::clone(&calls);
    let _watcher = watch_inbox(&path, move || sink.lock().unwrap().push(Instant::now())).unwrap();
    // FSEvents needs a moment before the stream delivers anything.
    std::thread::sleep(Duration::from_millis(500));

    save_launch_grant_impl(&mut first, &grant_input("g1", "root-1", 2, 5)).unwrap();
    std::thread::sleep(Duration::from_millis(50));
    save_launch_grant_impl(&mut second, &grant_input("g2", "root-2", 2, 5)).unwrap();
    let granted = Instant::now();

    let deadline = granted + Duration::from_secs(5);
    while Instant::now() < deadline && !calls.lock().unwrap().iter().any(|at| *at >= granted) {
        std::thread::sleep(Duration::from_millis(50));
    }
    let calls = calls.lock().unwrap();
    assert!(
        calls.iter().any(|at| *at >= granted),
        "second grant never announced ({} announcement(s) before it)",
        calls.len()
    );
}

#[test]
fn a_dropped_inbox_watch_announces_nothing_more() {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("notifications.db");
    let mut writer = init_db(&path).unwrap();
    let calls = Arc::new(Mutex::new(0usize));
    let sink = Arc::clone(&calls);
    let watch = watch_inbox(&path, move || *sink.lock().unwrap() += 1).unwrap();
    drop(watch);
    std::thread::sleep(Duration::from_millis(700));
    let before = *calls.lock().unwrap();

    save_launch_grant_impl(&mut writer, &grant_input("g1", "root-1", 2, 5)).unwrap();
    std::thread::sleep(Duration::from_millis(1500));

    assert_eq!(*calls.lock().unwrap(), before);
}
