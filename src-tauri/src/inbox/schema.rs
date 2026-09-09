use crate::database::apply_migration;
use rusqlite::Connection;
use std::path::Path;

/// Where the inbox lives inside the app data directory.
pub fn db_path_in(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join("inbox.db")
}

/// Where copied inbox media lives inside the app data directory.
pub fn attachments_dir_in(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join("inbox-attachments")
}

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id   INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .map_err(|e| format!("Failed to create _migrations table: {}", e))?;

    apply_migration(
        conn,
        1,
        "create_inbox_items",
        "CREATE TABLE inbox_items (
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL,
            notes        TEXT NOT NULL DEFAULT '',
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
            project_path TEXT,
            project_name TEXT,
            ticket_id    TEXT,
            assigned_at  TEXT,
            dismissed_at TEXT
        );
        CREATE INDEX idx_inbox_items_active ON inbox_items(dismissed_at, created_at DESC);",
    )?;

    apply_migration(
        conn,
        2,
        "add_inbox_item_priority_due_date",
        "ALTER TABLE inbox_items ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
         ALTER TABLE inbox_items ADD COLUMN due_date TEXT;",
    )?;

    apply_migration(
        conn,
        3,
        "create_inbox_attachments",
        "CREATE TABLE inbox_attachments (
            id          TEXT PRIMARY KEY,
            item_id     TEXT NOT NULL,
            kind        TEXT NOT NULL,
            file_name   TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_inbox_attachments_item ON inbox_attachments(item_id);",
    )?;

    apply_migration(
        conn,
        4,
        "add_inbox_item_daily_goal",
        "ALTER TABLE inbox_items ADD COLUMN daily_goal INTEGER NOT NULL DEFAULT 0;",
    )?;

    Ok(())
}

/// Opens (creating if needed) the inbox database at `path`.
pub fn init_db(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create inbox dir: {}", e))?;
    }

    let conn = Connection::open(path).map_err(|e| format!("Failed to open inbox db: {}", e))?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    run_migrations(&conn)?;

    Ok(conn)
}
