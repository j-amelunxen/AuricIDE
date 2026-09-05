use super::schema::generate_uid;
use super::types::{Notification, NotificationInput, NOTIFICATION_CAP};
use rusqlite::{params, Connection};

pub const SELECT_COLUMNS: &str =
    "id, uid, created_at, project_path, project_name, source, origin, \
     kind, severity, title, body, actions, dedupe_key, ref_kind, ref_id, \
     read_at, answered_at, answer, expires_at";

pub fn row_to_notification(row: &rusqlite::Row) -> rusqlite::Result<Notification> {
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
pub fn prune(conn: &Connection) -> Result<(), String> {
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

/// Deletes the named notifications. The same guard as `clear_impl`, in the
/// SQL rather than left to the caller: the MCP server writes to this database
/// too, so "an unanswered question is never dropped" has to hold at the
/// boundary, not in one slice.
pub fn delete_impl(conn: &Connection, uids: &[String]) -> Result<(), String> {
    for uid in uids {
        conn.execute(
            "DELETE FROM notifications
            WHERE uid = ?1 AND (kind <> 'ask' OR answered_at IS NOT NULL)",
            params![uid],
        )
        .map_err(|e| format!("Failed to delete notification: {}", e))?;
    }
    Ok(())
}
