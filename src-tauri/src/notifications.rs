//! The notification inbox: a persistent, cross-project event log.
//!
//! This database deliberately does **not** live in `<project>/.auric/project.db`.
//! Several repos are worked at once here — agents in one project, a conductor
//! run in another — and an inbox that only remembered the project currently
//! open would lose exactly the messages you were away from. So it sits in the
//! app data directory, next to `recent-projects.json`, and every row carries
//! the project it came from.
//!
//! SQLite rather than a JSON file because three processes write to it: this
//! app, the out-of-process MCP server, and potentially a second app instance.
//! A `Mutex<Vec<T>>` over a file (the `recent_projects.rs` approach) does not
//! survive that.
//!
//! Keep the schema in sync with `src/mcp/notificationsDb.ts`.

use crate::database::apply_migration;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// How many rows the inbox keeps. Only rows that have been dealt with are ever
/// pruned, so this is a ceiling on history, not on the backlog.
pub const NOTIFICATION_CAP: usize = 1000;

pub struct NotificationsState {
    pub conn: Mutex<Connection>,
    /// Holds the inbox file watcher for the process lifetime. Dropping it
    /// would cut off every dispatch that did not come from this app — the
    /// MCP server's writes would sit in the database unseen. Never read: being
    /// owned is the whole job.
    #[allow(dead_code)]
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

/// Where the inbox lives inside the app data directory. Also handed to the
/// MCP server so its `notify` tools write to the same file.
pub fn db_path_in(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join("notifications.db")
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: i64,
    pub uid: String,
    pub created_at: String,
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    pub source: String,
    pub origin: Option<String>,
    pub kind: String,
    pub severity: String,
    pub title: String,
    pub body: Option<String>,
    pub actions: serde_json::Value,
    pub dedupe_key: Option<String>,
    pub ref_kind: Option<String>,
    pub ref_id: Option<String>,
    pub read_at: Option<String>,
    pub answered_at: Option<String>,
    pub answer: Option<String>,
    pub expires_at: Option<String>,
}

/// What a dispatcher supplies. Everything the store owns — id, timestamps,
/// read state — is absent here on purpose.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotificationInput {
    #[serde(default)]
    pub uid: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub project_name: Option<String>,
    pub source: String,
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub severity: Option<String>,
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub actions: Option<serde_json::Value>,
    #[serde(default)]
    pub dedupe_key: Option<String>,
    #[serde(default)]
    pub ref_kind: Option<String>,
    #[serde(default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
}

/// Process-local counter. Combined with the clock and the pid it makes a uid
/// that cannot collide with one minted by the MCP server or a second instance.
static UID_COUNTER: AtomicU64 = AtomicU64::new(0);

fn generate_uid() -> String {
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

const SELECT_COLUMNS: &str = "id, uid, created_at, project_path, project_name, source, origin, \
     kind, severity, title, body, actions, dedupe_key, ref_kind, ref_id, \
     read_at, answered_at, answer, expires_at";

fn row_to_notification(row: &rusqlite::Row) -> rusqlite::Result<Notification> {
    let raw_actions: String = row.get(11)?;
    Ok(Notification {
        id: row.get(0)?,
        uid: row.get(1)?,
        created_at: row.get(2)?,
        project_path: row.get(3)?,
        project_name: row.get(4)?,
        source: row.get(5)?,
        origin: row.get(6)?,
        kind: row.get(7)?,
        severity: row.get(8)?,
        title: row.get(9)?,
        body: row.get(10)?,
        // A row written by hand or by an older client must not sink the whole
        // list; an unreadable actions blob degrades to "no buttons".
        actions: serde_json::from_str(&raw_actions).unwrap_or_else(|_| serde_json::json!([])),
        dedupe_key: row.get(12)?,
        ref_kind: row.get(13)?,
        ref_id: row.get(14)?,
        read_at: row.get(15)?,
        answered_at: row.get(16)?,
        answer: row.get(17)?,
        expires_at: row.get(18)?,
    })
}

/// Writes one notification and returns the row as stored.
///
/// A `dedupe_key` replaces the previous row rather than updating it in place:
/// the row id is the drain cursor every client reads from, so a bumped
/// notification needs a *new* id or clients that already drained past the old
/// one would never see it again. Same delete-then-insert shape as
/// `agent_prompt_history_add_impl`.
pub fn dispatch_impl(
    conn: &mut Connection,
    input: &NotificationInput,
) -> Result<Notification, String> {
    let kind = input.kind.clone().unwrap_or_else(|| "info".to_string());
    let severity = input.severity.clone().unwrap_or_else(|| "info".to_string());
    let actions = input
        .actions
        .clone()
        .unwrap_or_else(|| serde_json::json!([]))
        .to_string();

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin notification transaction: {}", e))?;

    // A bump keeps the identity of the notification it replaces. Two things
    // depend on that: an agent waiting on `notify_answer_get(uid)` would
    // otherwise lose track of its own question, and a client merging by uid
    // would show the old row alongside the new one.
    let inherited_uid: Option<String> = match &input.dedupe_key {
        Some(key) => tx
            .query_row(
                "SELECT uid FROM notifications WHERE dedupe_key = ?1",
                params![key],
                |row| row.get(0),
            )
            .ok(),
        None => None,
    };
    let uid = input
        .uid
        .clone()
        .or(inherited_uid)
        .unwrap_or_else(generate_uid);

    if let Some(key) = &input.dedupe_key {
        tx.execute(
            "DELETE FROM notifications WHERE dedupe_key = ?1",
            params![key],
        )
        .map_err(|e| format!("Failed to dedupe notification: {}", e))?;
    }
    // A re-dispatch under the same uid replaces too, so a retrying dispatcher
    // cannot mint duplicates against the UNIQUE index.
    tx.execute("DELETE FROM notifications WHERE uid = ?1", params![uid])
        .map_err(|e| format!("Failed to replace notification: {}", e))?;

    tx.execute(
        "INSERT INTO notifications
            (uid, project_path, project_name, source, origin, kind, severity,
             title, body, actions, dedupe_key, ref_kind, ref_id, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            uid,
            input.project_path,
            input.project_name,
            input.source,
            input.origin,
            kind,
            severity,
            input.title,
            input.body,
            actions,
            input.dedupe_key,
            input.ref_kind,
            input.ref_id,
            input.expires_at,
        ],
    )
    .map_err(|e| format!("Failed to insert notification: {}", e))?;

    prune(&tx)?;

    let notification = tx
        .query_row(
            &format!(
                "SELECT {} FROM notifications WHERE uid = ?1",
                SELECT_COLUMNS
            ),
            params![uid],
            row_to_notification,
        )
        .map_err(|e| format!("Failed to read back notification: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit notification: {}", e))?;

    Ok(notification)
}

/// Trims history back to `NOTIFICATION_CAP`.
///
/// Only rows the user has actually dealt with are eligible — read, and for a
/// question also answered. An unread backlog past the cap is kept instead:
/// dropping it would make the unread count disagree with the list, and a count
/// that lies is worse than a long list.
fn prune(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM notifications WHERE id IN (
            SELECT id FROM notifications
            WHERE read_at IS NOT NULL AND (kind <> 'ask' OR answered_at IS NOT NULL)
            ORDER BY id ASC
            LIMIT MAX(0, (SELECT COUNT(*) FROM notifications) - ?1)
        )",
        params![NOTIFICATION_CAP as i64],
    )
    .map_err(|e| format!("Failed to prune notifications: {}", e))?;

    Ok(())
}

/// Newest first. `since_id` narrows to what a client has not drained yet;
/// expired rows never surface.
pub fn list_impl(
    conn: &Connection,
    since_id: Option<i64>,
    limit: Option<usize>,
    project_path: Option<&str>,
) -> Result<Vec<Notification>, String> {
    let sql = format!(
        "SELECT {} FROM notifications
         WHERE id > ?1
           AND (?2 IS NULL OR project_path = ?2)
           AND (expires_at IS NULL OR expires_at > datetime('now'))
         ORDER BY id DESC
         LIMIT ?3",
        SELECT_COLUMNS
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare notifications query: {}", e))?;

    let rows = stmt
        .query_map(
            params![
                since_id.unwrap_or(0),
                project_path,
                limit.unwrap_or(NOTIFICATION_CAP) as i64
            ],
            row_to_notification,
        )
        .map_err(|e| format!("Failed to query notifications: {}", e))?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("Failed to read notifications: {}", e))
}

/// Marks the given notifications read. Already-read rows keep their original
/// timestamp — when you first saw something is not something a second click
/// should rewrite.
pub fn mark_read_impl(conn: &Connection, uids: &[String]) -> Result<(), String> {
    for uid in uids {
        conn.execute(
            "UPDATE notifications SET read_at = datetime('now')
             WHERE uid = ?1 AND read_at IS NULL",
            params![uid],
        )
        .map_err(|e| format!("Failed to mark notification read: {}", e))?;
    }
    Ok(())
}

pub fn mark_all_read_impl(conn: &Connection, project_path: Option<&str>) -> Result<(), String> {
    conn.execute(
        "UPDATE notifications SET read_at = datetime('now')
         WHERE read_at IS NULL AND (?1 IS NULL OR project_path = ?1)",
        params![project_path],
    )
    .map_err(|e| format!("Failed to mark notifications read: {}", e))?;
    Ok(())
}

/// Records the chosen action. Reading it back is how a waiting agent learns
/// the decision, so an answer is written once and never overwritten — asking
/// the same question twice would leave the agent guessing which reply is live.
pub fn answer_impl(conn: &Connection, uid: &str, answer: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE notifications
         SET answer = ?2, answered_at = datetime('now'), read_at = COALESCE(read_at, datetime('now'))
         WHERE uid = ?1 AND answered_at IS NULL",
        params![uid, answer],
    )
    .map_err(|e| format!("Failed to answer notification: {}", e))?;
    Ok(())
}

pub fn unread_count_impl(conn: &Connection, project_path: Option<&str>) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM notifications
         WHERE read_at IS NULL
           AND (?1 IS NULL OR project_path = ?1)
           AND (expires_at IS NULL OR expires_at > datetime('now'))",
        params![project_path],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to count unread notifications: {}", e))
}

/// Clears settled notifications. Unanswered questions are spared — clearing
/// the list is a tidying gesture, not an answer, and a silently dropped
/// question is one an agent waits on forever.
pub fn clear_impl(conn: &Connection, project_path: Option<&str>) -> Result<(), String> {
    conn.execute(
        "DELETE FROM notifications
         WHERE (?1 IS NULL OR project_path = ?1)
           AND (kind <> 'ask' OR answered_at IS NOT NULL)",
        params![project_path],
    )
    .map_err(|e| format!("Failed to clear notifications: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        run_migrations(&conn).expect("migrations");
        conn
    }

    fn input(title: &str) -> NotificationInput {
        NotificationInput {
            uid: None,
            project_path: None,
            project_name: None,
            source: "ui".to_string(),
            origin: None,
            kind: None,
            severity: None,
            title: title.to_string(),
            body: None,
            actions: None,
            dedupe_key: None,
            ref_kind: None,
            ref_id: None,
            expires_at: None,
        }
    }

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
        assert!(before > 0, "expected at least one migration to be recorded");
    }

    #[test]
    fn dispatch_returns_the_stored_row_with_defaults_applied() {
        let mut conn = test_db();
        let stored = dispatch_impl(&mut conn, &input("Hallo")).expect("dispatch");

        assert_eq!(stored.title, "Hallo");
        assert_eq!(stored.kind, "info");
        assert_eq!(stored.severity, "info");
        assert_eq!(stored.actions, serde_json::json!([]));
        assert!(stored.read_at.is_none());
        assert!(!stored.uid.is_empty());
    }

    #[test]
    fn dispatch_mints_distinct_uids() {
        let mut conn = test_db();
        let a = dispatch_impl(&mut conn, &input("a")).expect("a");
        let b = dispatch_impl(&mut conn, &input("b")).expect("b");
        assert_ne!(a.uid, b.uid);
    }

    #[test]
    fn dedupe_key_replaces_the_previous_row() {
        let mut conn = test_db();
        let mut first = input("Scan fällig");
        first.dedupe_key = Some("schedule:1".to_string());
        dispatch_impl(&mut conn, &first).expect("first");

        let mut second = input("Scan überfällig");
        second.dedupe_key = Some("schedule:1".to_string());
        dispatch_impl(&mut conn, &second).expect("second");

        let all = list_impl(&conn, None, None, None).expect("list");
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "Scan überfällig");
    }

    #[test]
    fn a_deduped_row_gets_a_fresh_id_so_drained_clients_see_it_again() {
        let mut conn = test_db();
        let mut first = input("Scan fällig");
        first.dedupe_key = Some("schedule:1".to_string());
        let old = dispatch_impl(&mut conn, &first).expect("first");

        let mut second = input("Scan überfällig");
        second.dedupe_key = Some("schedule:1".to_string());
        let new = dispatch_impl(&mut conn, &second).expect("second");

        assert!(new.id > old.id);
        // A client that had drained up to the old id still receives the bump.
        let fresh = list_impl(&conn, Some(old.id), None, None).expect("list");
        assert_eq!(fresh.len(), 1);
    }

    #[test]
    fn a_deduped_row_keeps_the_uid_it_replaced() {
        let mut conn = test_db();
        let mut first = input("Scan fällig");
        first.dedupe_key = Some("schedule:1".to_string());
        let old = dispatch_impl(&mut conn, &first).expect("first");

        let mut second = input("Scan überfällig");
        second.dedupe_key = Some("schedule:1".to_string());
        let new = dispatch_impl(&mut conn, &second).expect("second");

        // An agent polling on the uid it was handed must still find its question.
        assert_eq!(new.uid, old.uid);
    }

    #[test]
    fn an_explicit_uid_wins_over_the_inherited_one() {
        let mut conn = test_db();
        let mut first = input("a");
        first.dedupe_key = Some("k".to_string());
        dispatch_impl(&mut conn, &first).expect("first");

        let mut second = input("b");
        second.dedupe_key = Some("k".to_string());
        second.uid = Some("chosen".to_string());
        let stored = dispatch_impl(&mut conn, &second).expect("second");

        assert_eq!(stored.uid, "chosen");
        assert_eq!(list_impl(&conn, None, None, None).unwrap().len(), 1);
    }

    #[test]
    fn a_deduped_row_becomes_unread_again() {
        let mut conn = test_db();
        let mut first = input("Scan fällig");
        first.dedupe_key = Some("schedule:1".to_string());
        let stored = dispatch_impl(&mut conn, &first).expect("first");
        mark_read_impl(&conn, &[stored.uid.clone()]).expect("read");
        assert_eq!(unread_count_impl(&conn, None).unwrap(), 0);

        let mut second = input("Scan überfällig");
        second.dedupe_key = Some("schedule:1".to_string());
        dispatch_impl(&mut conn, &second).expect("second");

        assert_eq!(unread_count_impl(&conn, None).unwrap(), 1);
    }

    #[test]
    fn rows_without_a_dedupe_key_never_collapse() {
        let mut conn = test_db();
        dispatch_impl(&mut conn, &input("a")).expect("a");
        dispatch_impl(&mut conn, &input("b")).expect("b");
        assert_eq!(list_impl(&conn, None, None, None).unwrap().len(), 2);
    }

    #[test]
    fn list_filters_by_project() {
        let mut conn = test_db();
        let mut a = input("a");
        a.project_path = Some("/repo-a".to_string());
        dispatch_impl(&mut conn, &a).expect("a");
        let mut b = input("b");
        b.project_path = Some("/repo-b".to_string());
        dispatch_impl(&mut conn, &b).expect("b");

        let only_a = list_impl(&conn, None, None, Some("/repo-a")).expect("list");
        assert_eq!(only_a.len(), 1);
        assert_eq!(only_a[0].title, "a");
    }

    #[test]
    fn list_returns_newest_first() {
        let mut conn = test_db();
        dispatch_impl(&mut conn, &input("alt")).expect("a");
        dispatch_impl(&mut conn, &input("neu")).expect("b");
        let all = list_impl(&conn, None, None, None).expect("list");
        assert_eq!(all[0].title, "neu");
    }

    #[test]
    fn expired_rows_are_hidden_and_uncounted() {
        let mut conn = test_db();
        let mut expired = input("abgelaufen");
        expired.expires_at = Some("2000-01-01 00:00:00".to_string());
        dispatch_impl(&mut conn, &expired).expect("dispatch");

        assert!(list_impl(&conn, None, None, None).unwrap().is_empty());
        assert_eq!(unread_count_impl(&conn, None).unwrap(), 0);
    }

    #[test]
    fn marking_read_twice_keeps_the_first_timestamp() {
        let mut conn = test_db();
        let stored = dispatch_impl(&mut conn, &input("a")).expect("dispatch");
        mark_read_impl(&conn, &[stored.uid.clone()]).expect("first");
        let first_at = list_impl(&conn, None, None, None).unwrap()[0]
            .read_at
            .clone();

        mark_read_impl(&conn, &[stored.uid.clone()]).expect("second");
        let second_at = list_impl(&conn, None, None, None).unwrap()[0]
            .read_at
            .clone();

        assert_eq!(first_at, second_at);
    }

    #[test]
    fn answering_records_the_choice_and_marks_read() {
        let mut conn = test_db();
        let mut ask = input("Agent starten?");
        ask.kind = Some("ask".to_string());
        let stored = dispatch_impl(&mut conn, &ask).expect("dispatch");

        answer_impl(&conn, &stored.uid, "yes").expect("answer");

        let row = &list_impl(&conn, None, None, None).unwrap()[0];
        assert_eq!(row.answer.as_deref(), Some("yes"));
        assert!(row.answered_at.is_some());
        assert!(row.read_at.is_some());
    }

    #[test]
    fn a_question_cannot_be_answered_twice() {
        let mut conn = test_db();
        let mut ask = input("Agent starten?");
        ask.kind = Some("ask".to_string());
        let stored = dispatch_impl(&mut conn, &ask).expect("dispatch");

        answer_impl(&conn, &stored.uid, "yes").expect("first");
        answer_impl(&conn, &stored.uid, "no").expect("second");

        assert_eq!(
            list_impl(&conn, None, None, None).unwrap()[0]
                .answer
                .as_deref(),
            Some("yes")
        );
    }

    #[test]
    fn clear_spares_unanswered_questions() {
        let mut conn = test_db();
        let mut ask = input("offen?");
        ask.kind = Some("ask".to_string());
        dispatch_impl(&mut conn, &ask).expect("ask");
        dispatch_impl(&mut conn, &input("info")).expect("info");

        clear_impl(&conn, None).expect("clear");

        let left = list_impl(&conn, None, None, None).expect("list");
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].title, "offen?");
    }

    #[test]
    fn pruning_never_drops_unread_rows_even_past_the_cap() {
        let mut conn = test_db();
        for i in 0..(NOTIFICATION_CAP + 5) {
            dispatch_impl(&mut conn, &input(&format!("n{}", i))).expect("dispatch");
        }
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notifications", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count as usize, NOTIFICATION_CAP + 5);
    }

    #[test]
    fn pruning_trims_read_rows_back_to_the_cap() {
        let mut conn = test_db();
        for i in 0..NOTIFICATION_CAP {
            let stored = dispatch_impl(&mut conn, &input(&format!("n{}", i))).expect("dispatch");
            mark_read_impl(&conn, &[stored.uid]).expect("read");
        }
        dispatch_impl(&mut conn, &input("neueste")).expect("dispatch");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notifications", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count as usize, NOTIFICATION_CAP);
        // The newest survives; the oldest read row is the one that went.
        assert_eq!(
            list_impl(&conn, None, Some(1), None).unwrap()[0].title,
            "neueste"
        );
    }

    #[test]
    fn a_malformed_actions_blob_degrades_to_no_buttons() {
        let mut conn = test_db();
        let stored = dispatch_impl(&mut conn, &input("a")).expect("dispatch");
        conn.execute(
            "UPDATE notifications SET actions = 'not json' WHERE uid = ?1",
            params![stored.uid],
        )
        .unwrap();

        let row = &list_impl(&conn, None, None, None).unwrap()[0];
        assert_eq!(row.actions, serde_json::json!([]));
    }

    #[test]
    fn actions_survive_a_round_trip() {
        let mut conn = test_db();
        let mut with_actions = input("Agent starten?");
        with_actions.actions = Some(serde_json::json!([
            { "id": "yes", "label": "Ja", "kind": "answer", "value": "yes" }
        ]));
        let stored = dispatch_impl(&mut conn, &with_actions).expect("dispatch");

        assert_eq!(stored.actions[0]["id"], "yes");
    }

    #[test]
    fn mark_all_read_can_be_scoped_to_one_project() {
        let mut conn = test_db();
        let mut a = input("a");
        a.project_path = Some("/repo-a".to_string());
        dispatch_impl(&mut conn, &a).expect("a");
        let mut b = input("b");
        b.project_path = Some("/repo-b".to_string());
        dispatch_impl(&mut conn, &b).expect("b");

        mark_all_read_impl(&conn, Some("/repo-a")).expect("mark");

        assert_eq!(unread_count_impl(&conn, None).unwrap(), 1);
        assert_eq!(unread_count_impl(&conn, Some("/repo-b")).unwrap(), 1);
    }
}
