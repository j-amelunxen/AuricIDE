use super::migrations::run_migrations;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

pub fn ensure_auric_dir(project_path: &str) -> Result<PathBuf, String> {
    let auric_dir = Path::new(project_path).join(".auric");
    fs::create_dir_all(&auric_dir).map_err(|e| format!("Failed to create .auric dir: {}", e))?;

    let gitignore_path = auric_dir.join(".gitignore");
    if !gitignore_path.exists() {
        fs::write(&gitignore_path, "*\n")
            .map_err(|e| format!("Failed to write .auric/.gitignore: {}", e))?;
    }

    Ok(auric_dir)
}

pub fn init_db(project_path: &str) -> Result<Connection, String> {
    let auric_dir = ensure_auric_dir(project_path)?;
    let db_path = auric_dir.join("project.db");

    let conn = Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

    run_migrations(&conn)?;

    Ok(conn)
}
