use super::migrations::run_migrations;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

/// The folder AuricIDE keeps its project state in (database, missions,
/// imports, attachments): the one place the name is spelled.
pub const AURIC_DIR: &str = ".auric";
const PROJECT_DB_FILE: &str = "project.db";

/// `<project>/.auric`.
pub fn auric_dir(project_root: &Path) -> PathBuf {
    project_root.join(AURIC_DIR)
}

/// `<project>/.auric/project.db`.
pub fn project_db_path(project_root: &Path) -> PathBuf {
    auric_dir(project_root).join(PROJECT_DB_FILE)
}

/// True for the project database and its SQLite side files, by path.
pub fn is_project_db_path(path: &str) -> bool {
    let database = format!("/{AURIC_DIR}/{PROJECT_DB_FILE}");
    ["", "-wal", "-shm", "-journal"]
        .iter()
        .any(|side| path.ends_with(&format!("{database}{side}")))
}

/// One `kv_store` value of the project at `project_root`, read-only and
/// creating nothing: `Ok(None)` when the project has no database yet or the
/// key is unset, `Err` when a database exists but cannot be read. Callers
/// decide what an unreadable project means for them.
pub fn read_project_kv(
    project_root: &Path,
    namespace: &str,
    key: &str,
) -> Result<Option<String>, String> {
    use rusqlite::{OpenFlags, OptionalExtension};
    let path = project_db_path(project_root);
    if !path.is_file() {
        return Ok(None);
    }
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Could not open {}: {e}", path.display()))?;
    conn.query_row(
        "SELECT value FROM kv_store WHERE namespace = ?1 AND key = ?2",
        rusqlite::params![namespace, key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| {
        format!(
            "Could not read {namespace}/{key} from {}: {e}",
            path.display()
        )
    })
}

pub fn ensure_auric_dir(project_path: &str) -> Result<PathBuf, String> {
    let auric_dir = auric_dir(Path::new(project_path));
    fs::create_dir_all(&auric_dir).map_err(|e| format!("Failed to create .auric dir: {}", e))?;

    let gitignore_path = auric_dir.join(".gitignore");
    if !gitignore_path.exists() {
        fs::write(&gitignore_path, "*\n")
            .map_err(|e| format!("Failed to write .auric/.gitignore: {}", e))?;
    }

    Ok(auric_dir)
}

pub fn init_db(project_path: &str) -> Result<Connection, String> {
    ensure_auric_dir(project_path)?;
    let db_path = project_db_path(Path::new(project_path));

    let conn = Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

    run_migrations(&conn)?;

    Ok(conn)
}
