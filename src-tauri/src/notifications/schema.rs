use crate::database::apply_migration;
use rusqlite::Connection;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// Process-local counter. Combined with the clock and the pid it makes a uid
/// that cannot collide with one minted by the MCP server or a second instance.
static UID_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn generate_uid() -> String {
    let nanos = chrono::Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    let seq = UID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}-{}", nanos, std::process::id(), seq)
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
        "create_notifications",
        "CREATE TABLE notifications (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            uid          TEXT NOT NULL UNIQUE,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            project_path TEXT,
            project_name TEXT,
            source       TEXT NOT NULL,
            origin       TEXT,
            kind         TEXT NOT NULL DEFAULT 'info',
            severity     TEXT NOT NULL DEFAULT 'info',
            title        TEXT NOT NULL,
            body         TEXT,
            actions      TEXT NOT NULL DEFAULT '[]',
            dedupe_key   TEXT,
            ref_kind     TEXT,
            ref_id       TEXT,
            read_at      TEXT,
            answered_at  TEXT,
            answer       TEXT,
            expires_at   TEXT
        );
        CREATE INDEX notifications_unread ON notifications(read_at, id DESC);
        CREATE UNIQUE INDEX notifications_dedupe
            ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;",
    )?;

    // Schedules share this database: they are dispatchers into the same inbox,
    // and keeping them together means one file to back up and one to watch.
    crate::schedules::run_migrations(conn)?;

    Ok(())
}

/// Opens (creating if needed) the inbox database at `path`.
pub fn init_db(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create notifications dir: {}", e))?;
    }

    let conn =
        Connection::open(path).map_err(|e| format!("Failed to open notifications db: {}", e))?;

    // WAL because the MCP server writes to this file from another process.
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    run_migrations(&conn)?;

    Ok(conn)
}

/// How long two file events must be apart before both are announced. A single
/// insert touches the db, the WAL and the shm file, so without this the UI
/// would drain three times for one notification.
const WATCH_DEBOUNCE_MS: u64 = 300;

/// Watches the inbox file and announces changes as `notifications-changed`.
///
/// This is the channel for everything written by another process — the MCP
/// server, or a second app instance. The app's own dispatches update the store
/// directly and do not wait for this; a drain triggered by our own write is a
/// harmless no-op, since the client only asks for rows past its cursor.
///
/// Watches the containing directory rather than the file: SQLite in WAL mode
/// writes the payload to `notifications.db-wal`, and a watch on the main file
/// alone would miss most of it.
pub fn watch_inbox<F>(db_path: &Path, on_change: F) -> Result<notify::RecommendedWatcher, String>
where
    F: Fn() + Send + 'static,
{
    use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};

    let dir = db_path
        .parent()
        .ok_or_else(|| "Notifications db has no parent directory".to_string())?
        .to_path_buf();
    let stem = db_path
        .file_name()
        .ok_or_else(|| "Notifications db has no file name".to_string())?
        .to_string_lossy()
        .to_string();

    let last_emit = AtomicU64::new(0);
    let started = std::time::Instant::now();

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            let touches_inbox = event.paths.iter().any(|p| {
                p.file_name()
                    .map(|name| name.to_string_lossy().starts_with(&stem))
                    .unwrap_or(false)
            });
            if !touches_inbox {
                return;
            }

            let now = started.elapsed().as_millis() as u64;
            let previous = last_emit.load(Ordering::Relaxed);
            if now.saturating_sub(previous) < WATCH_DEBOUNCE_MS {
                return;
            }
            last_emit.store(now, Ordering::Relaxed);
            on_change();
        },
        Config::default().with_poll_interval(std::time::Duration::from_millis(500)),
    )
    .map_err(|e| format!("Failed to create notifications watcher: {}", e))?;

    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch notifications db: {}", e))?;

    Ok(watcher)
}
