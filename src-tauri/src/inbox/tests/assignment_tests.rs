use super::*;
use crate::inbox::assignment::*;
use crate::inbox::items::{add_impl, get_impl};
use rusqlite::params;
use tempfile::TempDir;

#[test]
fn assign_creates_the_inbox_epic_the_ticket_and_a_status_history_row() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let item = add_impl(&inbox_conn, &input("Write the changelog")).unwrap();

    let assigned = assign_impl(
        &inbox_conn,
        &InboxAssignRequest {
            item_id: item.id.clone(),
            project_path: project.path().to_string_lossy().to_string(),
            epic_id: None,
            priority: None,
        },
    )
    .unwrap();

    assert_eq!(
        assigned.project_path.as_deref(),
        Some(project.path().to_string_lossy().as_ref())
    );
    assert!(assigned.ticket_id.is_some());
    assert!(assigned.assigned_at.is_some());

    let project_conn = open_project_db(&project);
    let epic_name: String = project_conn
        .query_row("SELECT name FROM pm_epics WHERE name = 'Inbox'", [], |r| {
            r.get(0)
        })
        .expect("Inbox epic exists");
    assert_eq!(epic_name, "Inbox");

    let ticket_id = assigned.ticket_id.clone().unwrap();
    let (name, description, status, priority, due_date): (
        String,
        String,
        String,
        String,
        Option<String>,
    ) = project_conn
        .query_row(
            "SELECT name, description, status, priority, due_date FROM pm_tickets WHERE id = ?1",
            params![ticket_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .expect("ticket exists");
    assert_eq!(name, "Write the changelog");
    assert_eq!(description, "");
    assert_eq!(status, "open");
    assert_eq!(priority, "normal");
    assert_eq!(due_date, None);

    let (from_status, to_status, source): (Option<String>, String, String) = project_conn
        .query_row(
            "SELECT from_status, to_status, source FROM pm_status_history WHERE ticket_id = ?1",
            params![ticket_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("status history row exists");
    assert_eq!(from_status, None);
    assert_eq!(to_status, "open");
    assert_eq!(source, "inbox");
}

#[test]
fn assign_reuses_the_inbox_epic_on_a_second_assignment() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let first = add_impl(&inbox_conn, &input("first task")).unwrap();
    let second = add_impl(&inbox_conn, &input("second task")).unwrap();
    let project_path = project.path().to_string_lossy().to_string();

    assign_impl(
        &inbox_conn,
        &InboxAssignRequest {
            item_id: first.id,
            project_path: project_path.clone(),
            epic_id: None,
            priority: None,
        },
    )
    .unwrap();
    assign_impl(
        &inbox_conn,
        &InboxAssignRequest {
            item_id: second.id,
            project_path,
            epic_id: None,
            priority: None,
        },
    )
    .unwrap();

    let project_conn = open_project_db(&project);
    let epic_count: i64 = project_conn
        .query_row(
            "SELECT COUNT(*) FROM pm_epics WHERE name = 'Inbox'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(epic_count, 1);
}

#[test]
fn assign_uses_the_given_epic_when_one_is_provided() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let project_conn = open_project_db(&project);
    project_conn
        .execute(
            "INSERT INTO pm_epics (id, name, sort_order) VALUES ('epic-1', 'Backend', 1)",
            [],
        )
        .unwrap();
    drop(project_conn);

    let item = add_impl(&inbox_conn, &input("task")).unwrap();
    assign_impl(
        &inbox_conn,
        &InboxAssignRequest {
            item_id: item.id,
            project_path: project.path().to_string_lossy().to_string(),
            epic_id: Some("epic-1".to_string()),
            priority: Some("high".to_string()),
        },
    )
    .unwrap();

    let project_conn = open_project_db(&project);
    let (epic_id, priority): (String, String) = project_conn
        .query_row("SELECT epic_id, priority FROM pm_tickets", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(epic_id, "epic-1");
    assert_eq!(priority, "high");
}

#[test]
fn assign_transfers_the_item_priority_and_due_date_onto_the_ticket() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let item = add_impl(
        &inbox_conn,
        &InboxItemInput {
            title: "Pay the invoice".to_string(),
            notes: "Ask accounting first".to_string(),
            priority: Some("critical".to_string()),
            due_date: Some("2026-08-22".to_string()),
        },
    )
    .unwrap();

    let assigned = assign_impl(
        &inbox_conn,
        &InboxAssignRequest {
            item_id: item.id,
            project_path: project.path().to_string_lossy().to_string(),
            epic_id: None,
            priority: None,
        },
    )
    .unwrap();

    let project_conn = open_project_db(&project);
    let (priority, due_date, description): (String, Option<String>, String) = project_conn
        .query_row(
            "SELECT priority, due_date, description FROM pm_tickets WHERE id = ?1",
            params![assigned.ticket_id.unwrap()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(priority, "critical");
    assert_eq!(due_date.as_deref(), Some("2026-08-22"));
    assert_eq!(description, "Ask accounting first");
}

#[test]
fn assign_errors_when_the_given_epic_does_not_exist() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let item = add_impl(&inbox_conn, &input("task")).unwrap();

    let err = assign_impl(
        &inbox_conn,
        &InboxAssignRequest {
            item_id: item.id,
            project_path: project.path().to_string_lossy().to_string(),
            epic_id: Some("does-not-exist".to_string()),
            priority: None,
        },
    )
    .unwrap_err();
    assert!(err.contains("not found"));
}

#[test]
fn assign_twice_errors() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let item = add_impl(&inbox_conn, &input("task")).unwrap();
    let request = InboxAssignRequest {
        item_id: item.id,
        project_path: project.path().to_string_lossy().to_string(),
        epic_id: None,
        priority: None,
    };

    assign_impl(&inbox_conn, &request).unwrap();
    let err = assign_impl(&inbox_conn, &request).unwrap_err();
    assert!(err.contains("already assigned"));
}

#[test]
fn assign_leaves_no_partial_writes_when_the_project_transaction_fails() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let project_conn = open_project_db(&project);
    project_conn
        .execute_batch("DROP TABLE pm_status_history;")
        .unwrap();
    drop(project_conn);

    let item = add_impl(&inbox_conn, &input("task")).unwrap();
    let project_path = project.path().to_string_lossy().to_string();

    let err = assign_impl(
        &inbox_conn,
        &InboxAssignRequest {
            item_id: item.id.clone(),
            project_path,
            epic_id: None,
            priority: None,
        },
    )
    .unwrap_err();
    assert!(err.contains("status history"));

    let project_conn = open_project_db(&project);
    let epic_count: i64 = project_conn
        .query_row("SELECT COUNT(*) FROM pm_epics", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        epic_count, 0,
        "the Inbox epic insert should have rolled back"
    );
    let ticket_count: i64 = project_conn
        .query_row("SELECT COUNT(*) FROM pm_tickets", [], |r| r.get(0))
        .unwrap();
    assert_eq!(ticket_count, 0, "the ticket insert should have rolled back");

    let unchanged = get_impl(&inbox_conn, &item.id).unwrap();
    assert!(unchanged.project_path.is_none());
    assert!(unchanged.ticket_id.is_none());
}

#[test]
fn assign_rejects_an_unknown_priority() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let item = add_impl(&inbox_conn, &input("task")).unwrap();

    let err = assign_impl(
        &inbox_conn,
        &InboxAssignRequest {
            item_id: item.id,
            project_path: project.path().to_string_lossy().to_string(),
            epic_id: None,
            priority: Some("urgent".to_string()),
        },
    )
    .unwrap_err();
    assert!(err.contains("Invalid priority"));
}

#[test]
fn assign_errors_when_the_project_folder_does_not_exist() {
    let inbox_conn = test_db();
    let root = TempDir::new().unwrap();
    let missing_path = root.path().join("no-such-project");
    let item = add_impl(&inbox_conn, &input("task")).unwrap();

    let err = assign_impl(
        &inbox_conn,
        &InboxAssignRequest {
            item_id: item.id.clone(),
            project_path: missing_path.to_string_lossy().to_string(),
            epic_id: None,
            priority: None,
        },
    )
    .unwrap_err();
    assert!(err.contains("does not exist"));

    assert!(!missing_path.exists());
    let unchanged = get_impl(&inbox_conn, &item.id).unwrap();
    assert!(unchanged.project_path.is_none());
}

#[test]
fn assign_waits_out_a_brief_lock_instead_of_failing_immediately() {
    use std::thread;
    use std::time::Duration;

    let inbox_conn = test_db();
    let project = seeded_project();
    let db_path = project.path().join(".auric").join("project.db");
    let item = add_impl(&inbox_conn, &input("task")).unwrap();

    let locker = Connection::open(&db_path).unwrap();
    locker.execute_batch("BEGIN IMMEDIATE;").unwrap();
    let release = thread::spawn(move || {
        thread::sleep(Duration::from_millis(300));
        locker.execute_batch("COMMIT;").unwrap();
    });

    let result = assign_impl(
        &inbox_conn,
        &InboxAssignRequest {
            item_id: item.id,
            project_path: project.path().to_string_lossy().to_string(),
            epic_id: None,
            priority: None,
        },
    );

    release.join().unwrap();
    assert!(
        result.is_ok(),
        "assign should wait out a brief lock rather than fail immediately: {:?}",
        result.err()
    );
}

#[test]
fn set_ticket_status_marks_the_ticket_done_and_records_history() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let item = add_impl(&inbox_conn, &input("Close me")).unwrap();
    let assigned = assign_impl(
        &inbox_conn,
        &InboxAssignRequest {
            item_id: item.id,
            project_path: project.path().to_string_lossy().to_string(),
            epic_id: None,
            priority: None,
        },
    )
    .unwrap();
    let ticket_id = assigned.ticket_id.clone().unwrap();

    set_ticket_status_impl(&project.path().to_string_lossy(), &ticket_id, "done").unwrap();

    let project_conn = open_project_db(&project);
    let status: String = project_conn
        .query_row(
            "SELECT status FROM pm_tickets WHERE id = ?1",
            params![ticket_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "done");

    let (from_status, to_status, source): (Option<String>, String, String) = project_conn
        .query_row(
            "SELECT from_status, to_status, source FROM pm_status_history
             WHERE ticket_id = ?1 AND to_status = 'done'",
            params![ticket_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(from_status.as_deref(), Some("open"));
    assert_eq!(to_status, "done");
    assert_eq!(source, "inbox");
}

#[test]
fn set_ticket_status_rejects_an_unknown_status() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let item = add_impl(&inbox_conn, &input("Nope")).unwrap();
    let assigned = assign_impl(
        &inbox_conn,
        &InboxAssignRequest {
            item_id: item.id,
            project_path: project.path().to_string_lossy().to_string(),
            epic_id: None,
            priority: None,
        },
    )
    .unwrap();

    let err = set_ticket_status_impl(
        &project.path().to_string_lossy(),
        assigned.ticket_id.as_deref().unwrap(),
        "blocked",
    )
    .unwrap_err();
    assert!(err.contains("Invalid ticket status"));
}

#[test]
fn set_ticket_status_rejects_a_missing_ticket() {
    let project = seeded_project();
    let err = set_ticket_status_impl(&project.path().to_string_lossy(), "does-not-exist", "done")
        .unwrap_err();
    assert!(err.contains("Ticket not found"));
}

#[test]
fn set_ticket_status_same_status_does_not_add_history() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let item = add_impl(&inbox_conn, &input("Stay open")).unwrap();
    let assigned = assign_impl(
        &inbox_conn,
        &InboxAssignRequest {
            item_id: item.id,
            project_path: project.path().to_string_lossy().to_string(),
            epic_id: None,
            priority: None,
        },
    )
    .unwrap();
    let ticket_id = assigned.ticket_id.clone().unwrap();

    set_ticket_status_impl(&project.path().to_string_lossy(), &ticket_id, "open").unwrap();

    let project_conn = open_project_db(&project);
    let count: i64 = project_conn
        .query_row(
            "SELECT COUNT(*) FROM pm_status_history WHERE ticket_id = ?1",
            params![ticket_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}
