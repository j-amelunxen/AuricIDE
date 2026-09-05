use super::*;
use crate::inbox::assignment::assign_impl;
use crate::inbox::attachments::*;
use crate::inbox::items::{add_impl, list_impl};
use rusqlite::params;
use std::path::Path;
use tempfile::TempDir;

/// The twin of `src/lib/inbox/inboxMedia.ts`, asserted against the same
/// file that side reads.
#[test]
fn attachment_extensions_agree_with_the_shared_fixture() {
    #[derive(serde::Deserialize)]
    struct Fixture {
        image: Vec<String>,
        video: Vec<String>,
        text: Vec<String>,
    }
    const FIXTURES: &str = include_str!("../../../../src/lib/inbox/attachmentKinds.fixtures.json");
    let fixture: Fixture = serde_json::from_str(FIXTURES).unwrap();

    assert_eq!(IMAGE_EXTENSIONS, fixture.image.as_slice());
    assert_eq!(VIDEO_EXTENSIONS, fixture.video.as_slice());
    assert_eq!(TEXT_EXTENSIONS, fixture.text.as_slice());
}

#[test]
fn attach_copies_an_image_and_lists_it_on_the_item() {
    let conn = test_db();
    let item = add_impl(&conn, &input("Screenshot the bug")).unwrap();
    let root = TempDir::new().unwrap();
    let source = write_media(root.path(), "shot.png");
    let attachments_dir = root.path().join("store");

    let updated = attach_impl(&conn, &attachments_dir, &item.id, &source).unwrap();

    assert_eq!(updated.attachments.len(), 1);
    assert_eq!(updated.attachments[0].kind, "image");
    assert_eq!(updated.attachments[0].file_name, "shot.png");
    assert!(Path::new(&updated.attachments[0].stored_path).exists());
    assert_eq!(
        list_impl(&conn).unwrap()[0].attachments.len(),
        1,
        "list must hydrate attachments too"
    );
}

#[test]
fn attach_copies_a_video() {
    let conn = test_db();
    let item = add_impl(&conn, &input("Walkthrough")).unwrap();
    let root = TempDir::new().unwrap();
    let source = write_media(root.path(), "clip.mp4");

    let updated = attach_impl(&conn, &root.path().join("store"), &item.id, &source).unwrap();

    assert_eq!(updated.attachments[0].kind, "video");
    assert_eq!(updated.attachments[0].file_name, "clip.mp4");
}

#[test]
fn attach_rejects_a_file_that_is_neither_media_nor_text() {
    let conn = test_db();
    let item = add_impl(&conn, &input("Notes")).unwrap();
    let root = TempDir::new().unwrap();
    let source = write_media(root.path(), "bundle.zip");

    let err = attach_impl(&conn, &root.path().join("store"), &item.id, &source).unwrap_err();
    assert!(
        err.contains("image") || err.contains("video") || err.contains("text"),
        "unexpected error: {err}"
    );
    assert!(list_impl(&conn).unwrap()[0].attachments.is_empty());
}

#[test]
fn attach_accepts_a_text_document_dropped_from_disk() {
    let conn = test_db();
    let item = add_impl(&conn, &input("Read the thread")).unwrap();
    let root = TempDir::new().unwrap();
    let source = write_media(root.path(), "thread.eml");

    let updated = attach_impl(&conn, &root.path().join("store"), &item.id, &source).unwrap();

    assert_eq!(updated.attachments[0].kind, "text");
    assert_eq!(updated.attachments[0].file_name, "thread.eml");
}

#[test]
fn attach_text_stores_the_body_as_a_file_on_the_item() {
    let conn = test_db();
    let item = add_impl(&conn, &input("Answer the client")).unwrap();
    let root = TempDir::new().unwrap();
    let body = "Subject: Invoice 118\n\nHi, the invoice is still open.\n";

    let updated = attach_text_impl(
        &conn,
        &root.path().join("store"),
        &item.id,
        "invoice-118.md",
        body,
    )
    .unwrap();

    assert_eq!(updated.attachments.len(), 1);
    assert_eq!(updated.attachments[0].kind, "text");
    assert_eq!(updated.attachments[0].file_name, "invoice-118.md");
    assert_eq!(
        std::fs::read_to_string(&updated.attachments[0].stored_path).unwrap(),
        body,
        "the pasted text must survive verbatim"
    );
}

#[test]
fn attach_text_gives_a_nameless_or_odd_name_a_markdown_file() {
    let conn = test_db();
    let item = add_impl(&conn, &input("Paste")).unwrap();
    let root = TempDir::new().unwrap();
    let dir = root.path().join("store");

    let blank = attach_text_impl(&conn, &dir, &item.id, "   ", "body").unwrap();
    assert_eq!(blank.attachments[0].file_name, "note.md");

    let traversal = attach_text_impl(&conn, &dir, &item.id, "../../etc/passwd", "body").unwrap();
    assert_eq!(traversal.attachments[1].file_name, "passwd.md");
    assert!(
        Path::new(&traversal.attachments[1].stored_path).starts_with(&dir),
        "a file name must never escape the attachments directory"
    );
}

#[test]
fn attach_text_refuses_an_empty_body() {
    let conn = test_db();
    let item = add_impl(&conn, &input("Paste")).unwrap();
    let root = TempDir::new().unwrap();

    let err = attach_text_impl(
        &conn,
        &root.path().join("store"),
        &item.id,
        "note.md",
        "  \n ",
    )
    .unwrap_err();
    assert!(
        err.to_lowercase().contains("empty"),
        "unexpected error: {err}"
    );
    assert!(list_impl(&conn).unwrap()[0].attachments.is_empty());
}

#[test]
fn attach_text_keeps_two_pastes_apart() {
    let conn = test_db();
    let item = add_impl(&conn, &input("Two mails")).unwrap();
    let root = TempDir::new().unwrap();
    let dir = root.path().join("store");

    attach_text_impl(&conn, &dir, &item.id, "mail.md", "first").unwrap();
    let updated = attach_text_impl(&conn, &dir, &item.id, "mail.md", "second").unwrap();

    assert_eq!(updated.attachments.len(), 2);
    assert_ne!(
        updated.attachments[0].stored_path,
        updated.attachments[1].stored_path
    );
    assert_eq!(
        std::fs::read_to_string(&updated.attachments[0].stored_path).unwrap(),
        "first",
        "the first paste must not be overwritten by the second"
    );
}

#[test]
fn detach_removes_the_file_and_the_row() {
    let conn = test_db();
    let item = add_impl(&conn, &input("bug")).unwrap();
    let root = TempDir::new().unwrap();
    let source = write_media(root.path(), "shot.png");
    let attachments_dir = root.path().join("store");
    let attached = attach_impl(&conn, &attachments_dir, &item.id, &source).unwrap();
    let stored = attached.attachments[0].stored_path.clone();
    let attachment_id = attached.attachments[0].id.clone();

    let updated = detach_impl(&conn, &item.id, &attachment_id).unwrap();

    assert!(updated.attachments.is_empty());
    assert!(!Path::new(&stored).exists());
}

#[test]
fn assign_carries_a_pasted_text_into_the_project_as_readable_ticket_context() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let root = TempDir::new().unwrap();
    let item = add_impl(&inbox_conn, &input("Answer the overdue invoice mail")).unwrap();
    let mail = "Subject: Invoice 2024-118 is overdue\n\nThe January invoice is still open.\n";
    attach_text_impl(
        &inbox_conn,
        &root.path().join("store"),
        &item.id,
        "invoice-2024-118.md",
        mail,
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

    let ticket_id = assigned.ticket_id.clone().unwrap();
    let dest = project
        .path()
        .join(".auric")
        .join("inbox-attachments")
        .join(&ticket_id)
        .join("invoice-2024-118.md");
    assert_eq!(
        std::fs::read_to_string(&dest).unwrap(),
        mail,
        "the mail must arrive in the project unchanged"
    );

    let project_conn = open_project_db(&project);
    let context_json: String = project_conn
        .query_row(
            "SELECT context FROM pm_tickets WHERE id = ?1",
            params![ticket_id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        context_json.contains("invoice-2024-118.md"),
        "ticket context should point at the pasted mail, got {context_json}"
    );
}

#[test]
fn attaching_text_to_an_assigned_item_updates_the_ticket_context() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let root = TempDir::new().unwrap();
    let item = add_impl(&inbox_conn, &input("Follow up")).unwrap();
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
    let ticket_id = assigned.ticket_id.clone().unwrap();

    attach_text_impl(
        &inbox_conn,
        &root.path().join("store"),
        &item.id,
        "reply.md",
        "They answered: go ahead.",
    )
    .unwrap();

    let project_conn = open_project_db(&project);
    let context_json: String = project_conn
        .query_row(
            "SELECT context FROM pm_tickets WHERE id = ?1",
            params![ticket_id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        context_json.contains("reply.md"),
        "a later paste must reach the ticket, got {context_json}"
    );
}

#[test]
fn assign_copies_attachments_into_the_project_and_onto_ticket_context() {
    let inbox_conn = test_db();
    let project = seeded_project();
    let root = TempDir::new().unwrap();
    let item = add_impl(&inbox_conn, &input("Bug with footage")).unwrap();
    attach_impl(
        &inbox_conn,
        &root.path().join("store"),
        &item.id,
        &write_media(root.path(), "shot.png"),
    )
    .unwrap();
    attach_impl(
        &inbox_conn,
        &root.path().join("store"),
        &item.id,
        &write_media(root.path(), "clip.mp4"),
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

    let ticket_id = assigned.ticket_id.clone().unwrap();
    let image_dest = project
        .path()
        .join(".auric")
        .join("inbox-attachments")
        .join(&ticket_id)
        .join("shot.png");
    let video_dest = project
        .path()
        .join(".auric")
        .join("inbox-attachments")
        .join(&ticket_id)
        .join("clip.mp4");
    assert!(
        image_dest.exists(),
        "image should be copied into the project"
    );
    assert!(
        video_dest.exists(),
        "video should be copied into the project"
    );

    let project_conn = open_project_db(&project);
    let context_json: String = project_conn
        .query_row(
            "SELECT context FROM pm_tickets WHERE id = ?1",
            params![ticket_id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        context_json.contains(".auric/inbox-attachments/")
            && context_json.contains("shot.png")
            && context_json.contains("clip.mp4"),
        "ticket context should list both transferred files, got {context_json}"
    );
    assert!(
        context_json.contains("\"type\":\"file\"") || context_json.contains("\"type\": \"file\""),
        "transferred media must be file context items: {context_json}"
    );
}
