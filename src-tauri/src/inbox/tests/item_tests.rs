use super::*;
use crate::inbox::assignment::assign_impl;
use crate::inbox::items::*;
use crate::inbox::schema::run_migrations;
use rusqlite::params;

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
}

#[test]
fn add_trims_the_title() {
    let conn = test_db();
    let item = add_impl(&conn, &input("  Buy milk  ")).expect("add");
    assert_eq!(item.title, "Buy milk");
    assert_eq!(item.notes, "");
    assert_eq!(item.priority, "normal");
    assert_eq!(item.due_date, None);
    assert!(item.project_path.is_none());
    assert!(item.dismissed_at.is_none());
}

#[test]
fn add_rejects_a_blank_title() {
    let conn = test_db();
    let err = add_impl(&conn, &input("   ")).unwrap_err();
    assert!(err.contains("empty"));
}

#[test]
fn list_returns_newest_first() {
    let conn = test_db();
    add_impl(&conn, &input("first")).unwrap();
    let second = add_impl(&conn, &input("second")).unwrap();
    let items = list_impl(&conn).unwrap();
    assert_eq!(items[0].id, second.id);
    assert_eq!(items.len(), 2);
}

#[test]
fn list_excludes_dismissed_items() {
    let conn = test_db();
    let item = add_impl(&conn, &input("gone")).unwrap();
    add_impl(&conn, &input("stays")).unwrap();
    dismiss_impl(&conn, &item.id).unwrap();

    let items = list_impl(&conn).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].title, "stays");
}

#[test]
fn update_changes_title_and_notes() {
    let conn = test_db();
    let item = add_impl(&conn, &input("draft")).unwrap();

    let updated = update_impl(
        &conn,
        &item.id,
        &InboxItemPatch {
            title: Some(" final ".to_string()),
            notes: Some("more context".to_string()),
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(updated.title, "final");
    assert_eq!(updated.notes, "more context");
}

#[test]
fn update_rejects_a_blank_title() {
    let conn = test_db();
    let item = add_impl(&conn, &input("draft")).unwrap();
    let err = update_impl(
        &conn,
        &item.id,
        &InboxItemPatch {
            title: Some("   ".to_string()),
            ..Default::default()
        },
    )
    .unwrap_err();
    assert!(err.contains("empty"));
}

#[test]
fn update_leaves_untouched_fields_alone() {
    let conn = test_db();
    let item = add_impl(&conn, &input("draft")).unwrap();
    let updated = update_impl(
        &conn,
        &item.id,
        &InboxItemPatch {
            notes: Some("only notes".to_string()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(updated.title, "draft");
    assert_eq!(updated.notes, "only notes");
}

#[test]
fn dismiss_hides_the_item_but_leaves_it_in_the_table() {
    let conn = test_db();
    let item = add_impl(&conn, &input("done thinking about it")).unwrap();
    dismiss_impl(&conn, &item.id).unwrap();

    assert!(list_impl(&conn).unwrap().is_empty());
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM inbox_items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn add_stores_priority_and_due_date() {
    let conn = test_db();
    let item = add_impl(
        &conn,
        &InboxItemInput {
            title: "Ship it".to_string(),
            notes: String::new(),
            priority: Some("high".to_string()),
            due_date: Some("2026-08-20".to_string()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(item.priority, "high");
    assert_eq!(item.due_date.as_deref(), Some("2026-08-20"));
}

#[test]
fn add_rejects_an_invalid_priority() {
    let conn = test_db();
    let err = add_impl(
        &conn,
        &InboxItemInput {
            title: "Ship it".to_string(),
            notes: String::new(),
            priority: Some("urgent".to_string()),
            due_date: None,
            ..Default::default()
        },
    )
    .unwrap_err();
    assert!(err.contains("Invalid priority"));
}

#[test]
fn add_rejects_an_invalid_due_date() {
    let conn = test_db();
    let err = add_impl(
        &conn,
        &InboxItemInput {
            title: "Ship it".to_string(),
            notes: String::new(),
            priority: None,
            due_date: Some("20.08.2026".to_string()),
            ..Default::default()
        },
    )
    .unwrap_err();
    assert!(err.contains("Invalid due date"));
}

#[test]
fn update_changes_priority_and_due_date() {
    let conn = test_db();
    let item = add_impl(&conn, &input("draft")).unwrap();

    let updated = update_impl(
        &conn,
        &item.id,
        &InboxItemPatch {
            priority: Some("critical".to_string()),
            due_date: Some("2026-09-01".to_string()),
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(updated.priority, "critical");
    assert_eq!(updated.due_date.as_deref(), Some("2026-09-01"));
}

#[test]
fn update_clears_a_due_date_with_a_blank_value() {
    let conn = test_db();
    let item = add_impl(
        &conn,
        &InboxItemInput {
            title: "dated".to_string(),
            notes: String::new(),
            priority: None,
            due_date: Some("2026-08-20".to_string()),
            ..Default::default()
        },
    )
    .unwrap();

    let updated = update_impl(
        &conn,
        &item.id,
        &InboxItemPatch {
            due_date: Some(String::new()),
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(updated.due_date, None);
}

#[test]
fn update_of_an_assigned_item_writes_through_to_the_ticket() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let item = add_impl(
        &inbox_conn,
        &InboxItemInput {
            title: "Captured".to_string(),
            notes: "inbox notes".to_string(),
            priority: Some("normal".to_string()),
            due_date: None,
            ..Default::default()
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

    update_impl(
        &inbox_conn,
        &assigned.id,
        &InboxItemPatch {
            title: Some("Renamed".to_string()),
            notes: Some("ticket notes".to_string()),
            priority: Some("high".to_string()),
            due_date: Some("2026-09-01".to_string()),
            ..Default::default()
        },
    )
    .unwrap();

    let ticket_id = assigned.ticket_id.unwrap();
    let project_conn = open_project_db(&project);
    let (name, description, priority, due_date): (String, String, String, Option<String>) =
        project_conn
            .query_row(
                "SELECT name, description, priority, due_date FROM pm_tickets WHERE id = ?1",
                params![ticket_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("ticket exists");
    assert_eq!(name, "Renamed");
    assert_eq!(description, "ticket notes");
    assert_eq!(priority, "high");
    assert_eq!(due_date.as_deref(), Some("2026-09-01"));
}

#[test]
fn update_of_an_assigned_item_skips_the_ticket_write_when_fields_already_match() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let item = add_impl(&inbox_conn, &input("Same title")).unwrap();
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
    let project_conn = open_project_db(&project);
    let before: String = project_conn
        .query_row(
            "SELECT updated_at FROM pm_tickets WHERE id = ?1",
            params![ticket_id],
            |r| r.get(0),
        )
        .unwrap();
    drop(project_conn);

    update_impl(
        &inbox_conn,
        &assigned.id,
        &InboxItemPatch {
            title: Some("Same title".to_string()),
            ..Default::default()
        },
    )
    .unwrap();

    let project_conn = open_project_db(&project);
    let after: String = project_conn
        .query_row(
            "SELECT updated_at FROM pm_tickets WHERE id = ?1",
            params![ticket_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(before, after);
}

#[test]
fn unassign_clears_the_link_but_leaves_the_ticket_in_the_project() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let item = add_impl(&inbox_conn, &input("task")).unwrap();
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
    let ticket_id = assigned.ticket_id.unwrap();

    let unassigned = unassign_impl(&inbox_conn, &item.id).unwrap();
    assert!(unassigned.project_path.is_none());
    assert!(unassigned.ticket_id.is_none());
    assert!(unassigned.assigned_at.is_none());

    let project_conn = open_project_db(&project);
    let still_there: i64 = project_conn
        .query_row(
            "SELECT COUNT(*) FROM pm_tickets WHERE id = ?1",
            params![ticket_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(still_there, 1);
}

#[test]
fn add_stores_daily_goal() {
    let conn = test_db();
    let item_default = add_impl(&conn, &input("regular")).unwrap();
    assert!(!item_default.daily_goal);

    let mut goal_input = input("sprint goal");
    goal_input.daily_goal = Some(true);
    let item_goal = add_impl(&conn, &goal_input).unwrap();
    assert!(item_goal.daily_goal);
}

#[test]
fn update_changes_daily_goal() {
    let conn = test_db();
    let item = add_impl(&conn, &input("task")).unwrap();
    assert!(!item.daily_goal);

    let updated = update_impl(
        &conn,
        &item.id,
        &InboxItemPatch {
            daily_goal: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(updated.daily_goal);

    let unflagged = update_impl(
        &conn,
        &item.id,
        &InboxItemPatch {
            daily_goal: Some(false),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(!unflagged.daily_goal);
}

#[test]
fn capture_ticket_creates_and_links_inbox_item_with_daily_goal() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let project_conn = open_project_db(&project);

    // Create a ticket in project DB
    let epic_id = "epic-1";
    project_conn
        .execute(
            "INSERT INTO pm_epics (id, name) VALUES (?1, 'Core')",
            params![epic_id],
        )
        .unwrap();
    let ticket_id = "t-100";
    project_conn
        .execute(
            "INSERT INTO pm_tickets (id, epic_id, name, description, priority, due_date)
             VALUES (?1, ?2, 'Implement feature X', 'Details', 'high', '2026-09-08')",
            params![ticket_id, epic_id],
        )
        .unwrap();
    drop(project_conn);

    let project_path = project.path().to_string_lossy().to_string();
    let item = capture_ticket_impl(&inbox_conn, &project_path, ticket_id, true).unwrap();

    assert_eq!(item.title, "Implement feature X");
    assert_eq!(item.notes, "Details");
    assert_eq!(item.priority, "high");
    assert_eq!(item.due_date, Some("2026-09-08".to_string()));
    assert_eq!(item.project_path, Some(project_path.clone()));
    assert_eq!(item.ticket_id, Some(ticket_id.to_string()));
    assert!(item.assigned_at.is_some());
    assert!(item.daily_goal);

    // Calling it again toggles/updates daily_goal on the existing item
    let updated = capture_ticket_impl(&inbox_conn, &project_path, ticket_id, false).unwrap();
    assert_eq!(updated.id, item.id);
    assert!(!updated.daily_goal);
}
