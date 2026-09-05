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
    assert_eq!(count, 19);

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
    assert_eq!(count, 19);
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
    assert_eq!(count, 19);
}
