use crate::inbox::schema::run_migrations;
use crate::inbox::types::*;
use rusqlite::Connection;
use std::path::Path;
use tempfile::TempDir;

pub(crate) fn test_db() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory db");
    run_migrations(&conn).expect("migrations");
    conn
}

pub(crate) fn input(title: &str) -> InboxItemInput {
    InboxItemInput {
        title: title.to_string(),
        notes: String::new(),
        priority: None,
        due_date: None,
        daily_goal: None,
    }
}

pub(crate) fn seeded_project() -> TempDir {
    let dir = TempDir::new().unwrap();
    let path = dir.path().to_string_lossy().to_string();
    crate::database::init_db(&path).expect("seed project db");
    dir
}

pub(crate) fn open_project_db(dir: &TempDir) -> Connection {
    Connection::open(dir.path().join(".auric").join("project.db")).unwrap()
}

pub(crate) fn write_media(dir: &Path, name: &str) -> std::path::PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, b"not-a-real-media-file").unwrap();
    path
}

mod assignment_tests;
mod attachment_tests;
mod item_tests;
mod overview_tests;
