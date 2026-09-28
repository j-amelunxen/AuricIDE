//! Goal status history — the goal twin of `pm_status_history`.
//!
//! Every status a goal passes through is appended to `pm_goal_status_history`
//! (migration 24; mirrored in `src/mcp/db.ts`). The frontend never sends
//! transitions: the save path snapshots the stored statuses before and after
//! its writes and records the difference. Comparing stored against stored, not
//! payload against base, is what keeps a rejected write (a sync conflict) from
//! being logged as a change that happened.
//!
//! Durations are computed in TypeScript (`src/lib/pm/metrics/goalMetrics.ts`).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PmGoalStatusHistoryEntry {
    pub id: String,
    pub goal_id: String,
    pub from_status: Option<String>,
    pub to_status: String,
    pub changed_at: String,
    pub source: String,
}

/// Stored status of each of `ids` that exists. Missing ids are simply absent.
pub fn stored_goal_statuses(
    conn: &Connection,
    ids: &[&str],
) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT status FROM pm_goals WHERE id = ?1")
        .map_err(|e| format!("Failed to prepare goal status query: {e}"))?;
    let mut statuses = HashMap::new();
    for id in ids {
        let status: Option<String> = stmt
            .query_row(params![id], |row| row.get(0))
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
            .map_err(|e| format!("Failed to read goal status: {e}"))?;
        if let Some(status) = status {
            statuses.insert((*id).to_string(), status);
        }
    }
    Ok(statuses)
}

/// Append one row per goal whose stored status differs between the two
/// snapshots. A goal only in `after` was created (`from_status` NULL); a goal
/// only in `before` was deleted and needs no row — its history goes with it.
pub fn record_goal_status_changes(
    conn: &Connection,
    before: &HashMap<String, String>,
    after: &HashMap<String, String>,
    source: &str,
) -> Result<(), String> {
    // Sorted so rows written in one save land in a stable order.
    let mut ids: Vec<&String> = after.keys().collect();
    ids.sort();
    for id in ids {
        let to_status = &after[id];
        let from_status = before.get(id);
        if from_status == Some(to_status) {
            continue;
        }
        conn.execute(
            "INSERT INTO pm_goal_status_history \
             (id, goal_id, from_status, to_status, changed_at, source) \
             VALUES (hex(randomblob(16)), ?1, ?2, ?3, datetime('now'), ?4)",
            params![id, from_status, to_status, source],
        )
        .map_err(|e| format!("Failed to insert goal status history: {e}"))?;
    }
    Ok(())
}

/// Oldest first; `rowid` keeps changes made within the same second in order.
pub fn goal_status_history_load_impl(
    conn: &Connection,
    goal_id: Option<&str>,
) -> Result<Vec<PmGoalStatusHistoryEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, goal_id, from_status, to_status, changed_at, source \
             FROM pm_goal_status_history \
             WHERE ?1 IS NULL OR goal_id = ?1 \
             ORDER BY changed_at ASC, rowid ASC",
        )
        .map_err(|e| format!("Failed to prepare goal history query: {e}"))?;
    let rows = stmt
        .query_map(params![goal_id], |row| {
            Ok(PmGoalStatusHistoryEntry {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                from_status: row.get(2)?,
                to_status: row.get(3)?,
                changed_at: row.get(4)?,
                source: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query goal history: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read goal history row: {e}"))
}
