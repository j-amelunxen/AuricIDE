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

// code-gate: complexity-function-length - an ordered list of migrations, one block each
/// Migration id of the one-time fix for reminders an agent's schedule fired
/// as `system` before sub-goal 09 r4 (see `run_migrations`).
pub const LEGACY_MCP_REMINDER_MIGRATION: i64 = 8;

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

    // A snapshot outbox rather than a foreign key: dedupe deliberately deletes
    // and reinserts notification rows, but delivery of the event that was
    // already committed must remain durable. The trigger is the producer
    // boundary, so Rust, MCP and any future direct SQLite writer cannot forget
    // to enqueue delivery in the notification's own transaction.
    apply_migration(
        conn,
        3,
        "create_notification_delivery_outbox",
        "CREATE TABLE notification_delivery_outbox (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            notification_row_id INTEGER NOT NULL,
            notification_uid    TEXT NOT NULL,
            channel             TEXT NOT NULL,
            payload_fingerprint TEXT NOT NULL,
            title               TEXT NOT NULL,
            body                TEXT,
            severity            TEXT NOT NULL,
            project_name        TEXT,
            origin              TEXT,
            status              TEXT NOT NULL DEFAULT 'pending',
            attempts            INTEGER NOT NULL DEFAULT 0,
            available_at        TEXT NOT NULL DEFAULT (datetime('now')),
            lease_owner         TEXT,
            lease_until         TEXT,
            delivered_at        TEXT,
            last_error          TEXT,
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(notification_uid, channel, payload_fingerprint)
        );
        CREATE INDEX notification_delivery_ready
            ON notification_delivery_outbox(status, available_at, lease_until);
        CREATE TRIGGER notifications_enqueue_pushover
        AFTER INSERT ON notifications
        BEGIN
            INSERT OR IGNORE INTO notification_delivery_outbox
                (notification_row_id, notification_uid, channel, payload_fingerprint,
                 title, body, severity, project_name, origin)
            VALUES
                (NEW.id, NEW.uid, 'pushover',
                 printf('%d:%s%d:%s%d:%s%d:%s%d:%s',
                    length(NEW.title), NEW.title,
                    length(COALESCE(NEW.body, '')), COALESCE(NEW.body, ''),
                    length(NEW.severity), NEW.severity,
                    length(COALESCE(NEW.project_name, '')), COALESCE(NEW.project_name, ''),
                    length(COALESCE(NEW.origin, '')), COALESCE(NEW.origin, '')),
                 NEW.title, NEW.body,
                 NEW.severity, NEW.project_name, NEW.origin);
        END;",
    )?;

    // What became of an agent launch request. Its own table because the
    // request row's `answer` is written once, while a run moves from running
    // to finished. Mirrored in `src/mcp/notificationsDb.ts`, migration 5.
    apply_migration(
        conn,
        5,
        "create_agent_launch_runs",
        "CREATE TABLE agent_launch_runs (
            request_uid  TEXT PRIMARY KEY,
            agent_id     TEXT NOT NULL,
            agent_name   TEXT,
            provider     TEXT,
            model        TEXT,
            status       TEXT NOT NULL,
            summary      TEXT,
            error        TEXT,
            started_at   TEXT NOT NULL DEFAULT (datetime('now')),
            finished_at  TEXT,
            updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    // The native gate for automatic starts under a launch grant, plus the
    // retention rule for launch runs. `agent_launch_claims` holds one row per
    // start that is still running or not yet resolved (the slot, per root); `agent_launch_grant_usage`
    // counts starts per grant and is never decremented (the budget). The
    // trigger drops a run with its request, whichever path deletes the row.
    // Mirrored in `src/mcp/notificationsDb.ts`, migration 6.
    apply_migration(
        conn,
        6,
        "create_agent_launch_claims",
        "CREATE TABLE agent_launch_claims (
            request_uid  TEXT PRIMARY KEY,
            grant_id     TEXT NOT NULL,
            root_goal_id TEXT NOT NULL,
            goal_id      TEXT,
            owner_pid    INTEGER NOT NULL DEFAULT 0,
            claimed_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX agent_launch_claims_root ON agent_launch_claims(root_goal_id);
        CREATE TABLE agent_launch_grant_usage (
            grant_id       TEXT PRIMARY KEY,
            launches_used  INTEGER NOT NULL DEFAULT 0
        );
        CREATE TRIGGER notifications_drop_launch_run
        AFTER DELETE ON notifications
        BEGIN
            DELETE FROM agent_launch_runs WHERE request_uid = OLD.uid;
        END;",
    )?;

    // Jennifer's launch grants, one row per grant; a revoke stamps
    // `revoked_at` and never deletes, so a claim with an old grant id finds
    // the row and refuses. Written only through the IDE's Tauri commands
    // (`save_launch_grant_impl`, `revoke_launch_grant_impl`); no MCP tool
    // touches this table. Mirrored in `src/mcp/notificationsDb.ts`, migration 7.
    apply_migration(
        conn,
        7,
        "create_agent_launch_grants",
        "CREATE TABLE agent_launch_grants (
            id             TEXT PRIMARY KEY,
            project_path   TEXT NOT NULL,
            root_goal_id   TEXT NOT NULL,
            root_goal_name TEXT NOT NULL DEFAULT '',
            max_concurrent INTEGER NOT NULL CHECK (max_concurrent BETWEEN 1 AND 5),
            launch_budget  INTEGER NOT NULL CHECK (launch_budget BETWEEN 1 AND 50),
            granted_at     TEXT NOT NULL DEFAULT (datetime('now')),
            revoked_at     TEXT
        );
        CREATE UNIQUE INDEX agent_launch_grants_in_force
            ON agent_launch_grants(project_path, root_goal_id) WHERE revoked_at IS NULL;",
    )?;

    // Until sub-goal 09 r4 the schedule runner fired every reminder as
    // `system`, also those of schedules an agent created through MCP (`mcp-`
    // id, see `fired_source` in `schedules/database.rs`). Their actions are the
    // agent's payload, so the rows still in the inbox are marked as written by
    // an agent: the click then never falls back to the open project, and the
    // native folder check refuses them for want of a stamp. Only `system` rows,
    // so nothing a person typed changes source. Mirrored in
    // `src/mcp/notificationsDb.ts`, migration 8.
    apply_migration(
        conn,
        LEGACY_MCP_REMINDER_MIGRATION,
        "mark_legacy_mcp_schedule_reminders",
        "UPDATE notifications SET source = 'agent'
          WHERE source = 'system' AND dedupe_key LIKE 'schedule:mcp-%';",
    )?;

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
