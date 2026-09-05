use super::operations::*;
use super::schema::*;
use super::types::*;
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
