//! Persistent history for the Agent Console's activity feed.
//!
//! Like the notification inbox this does **not** live in
//! `<project>/.auric/project.db`: the console shows several repos side by side,
//! so a per-project store could never hold its history. It sits in the app data
//! directory instead, and every row carries the repo it came from.
//!
//! Only the curated events are kept — a tool call, a permission prompt, a line
//! the parser recognised. Raw agent output stays in memory where it is: this is
//! a record of what the fleet did, not a transcript.

use crate::database::apply_migration;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Where the log lives inside the app data directory.
pub fn db_path_in(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("agent-log.db")
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentLogEvent {
    pub agent_id: String,
    pub agent_name: String,
    pub repo_path: Option<String>,
    /// read|edit|run|ask|done|error|note
    pub kind: String,
    pub label: String,
    pub path: Option<String>,
    /// Epoch millis.
    pub at: i64,
    pub seq: i64,
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
        "create_agent_log_events",
        "CREATE TABLE agent_log_events (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id   TEXT NOT NULL,
            agent_name TEXT NOT NULL,
            repo_path  TEXT,
            kind       TEXT NOT NULL,
            label      TEXT NOT NULL,
            path       TEXT,
            at         INTEGER NOT NULL,
            seq        INTEGER NOT NULL
        );
        CREATE INDEX agent_log_events_recent ON agent_log_events(at DESC, id DESC);",
    )?;

    Ok(())
}

/// Opens (creating if needed) the log database at `path`.
pub fn init_db(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create agent log dir: {}", e))?;
    }

    let conn = Connection::open(path).map_err(|e| format!("Failed to open agent log db: {}", e))?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    run_migrations(&conn)?;

    Ok(conn)
}

/// The log is opt-in, so the database is opened on first use rather than at
/// boot: a user who never turns history on never gets a file. A path that
/// cannot be opened then surfaces as an error from the call that needed it,
/// instead of taking the app's startup with it.
pub struct AgentLogState {
    path: PathBuf,
    conn: Mutex<Option<Connection>>,
}

impl AgentLogState {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            conn: Mutex::new(None),
        }
    }

    pub fn with_connection<T>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| "Agent log lock is poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(init_db(&self.path)?);
        }
        let conn = guard
            .as_mut()
            .ok_or_else(|| "Agent log is unavailable".to_string())?;
        work(conn)
    }
}

const SELECT_COLUMNS: &str = "agent_id, agent_name, repo_path, kind, label, path, at, seq";

fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<AgentLogEvent> {
    Ok(AgentLogEvent {
        agent_id: row.get(0)?,
        agent_name: row.get(1)?,
        repo_path: row.get(2)?,
        kind: row.get(3)?,
        label: row.get(4)?,
        path: row.get(5)?,
        at: row.get(6)?,
        seq: row.get(7)?,
    })
}

/// Writes a batch of events. One transaction, so a feed flush either lands
/// whole or not at all.
pub fn append_impl(conn: &mut Connection, events: &[AgentLogEvent]) -> Result<(), String> {
    if events.is_empty() {
        return Ok(());
    }

    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin agent log transaction: {}", e))?;

    for event in events {
        tx.execute(
            "INSERT INTO agent_log_events
                (agent_id, agent_name, repo_path, kind, label, path, at, seq)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                event.agent_id,
                event.agent_name,
                event.repo_path,
                event.kind,
                event.label,
                event.path,
                event.at,
                event.seq,
            ],
        )
        .map_err(|e| format!("Failed to insert agent log event: {}", e))?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit agent log events: {}", e))?;

    Ok(())
}

/// Newest first. Insertion order breaks ties on `at`, so a burst of events
/// sharing a millisecond still reads back in the order it was written.
pub fn load_impl(conn: &Connection, limit: u32) -> Result<Vec<AgentLogEvent>, String> {
    let sql = format!(
        "SELECT {} FROM agent_log_events ORDER BY at DESC, id DESC LIMIT ?1",
        SELECT_COLUMNS
    );

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare agent log query: {}", e))?;

    let rows = stmt
        .query_map(params![limit], row_to_event)
        .map_err(|e| format!("Failed to query agent log: {}", e))?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("Failed to read agent log: {}", e))
}

const MILLIS_PER_DAY: i64 = 24 * 60 * 60 * 1000;

/// Rotates the log and returns how many rows went.
///
/// Two independent sweeps in one transaction. `retention_days == 0` means the
/// history has no age limit — it does not mean "drop everything" — while
/// `max_rows` applies either way, so a log left uncapped by time still cannot
/// grow without bound.
pub fn prune_impl(
    conn: &mut Connection,
    retention_days: u32,
    max_rows: u32,
    now_ms: i64,
) -> Result<u64, String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin agent log prune: {}", e))?;

    let mut deleted = 0u64;

    if retention_days > 0 {
        let cutoff = now_ms - i64::from(retention_days) * MILLIS_PER_DAY;
        deleted +=
            tx.execute(
                "DELETE FROM agent_log_events WHERE at < ?1",
                params![cutoff],
            )
            .map_err(|e| format!("Failed to prune agent log by age: {}", e))? as u64;
    }

    deleted += tx
        .execute(
            "DELETE FROM agent_log_events WHERE id NOT IN (
                SELECT id FROM agent_log_events ORDER BY at DESC, id DESC LIMIT ?1
            )",
            params![max_rows],
        )
        .map_err(|e| format!("Failed to prune agent log by size: {}", e))? as u64;

    tx.commit()
        .map_err(|e| format!("Failed to commit agent log prune: {}", e))?;

    Ok(deleted)
}

pub fn purge_impl(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM agent_log_events", [])
        .map_err(|e| format!("Failed to purge agent log: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> Connection {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("agent-log.db");
        // Keep the dir alive by leaking it — fine for tests.
        std::mem::forget(dir);
        init_db(&path).expect("init db")
    }

    fn event(label: &str, at: i64) -> AgentLogEvent {
        AgentLogEvent {
            agent_id: "agent-1".to_string(),
            agent_name: "Docs sweep".to_string(),
            repo_path: Some("/repo-a".to_string()),
            kind: "run".to_string(),
            label: label.to_string(),
            path: Some("src/lib.rs".to_string()),
            at,
            seq: 1,
        }
    }

    const NOW: i64 = 1_700_000_000_000;
    const DAY: i64 = MILLIS_PER_DAY;

    fn labels(events: &[AgentLogEvent]) -> Vec<String> {
        events.iter().map(|e| e.label.clone()).collect()
    }

    fn row_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM agent_log_events", [], |r| r.get(0))
            .expect("count")
    }

    #[test]
    fn append_then_load_returns_the_events_newest_first() {
        let mut conn = temp_db();
        append_impl(
            &mut conn,
            &[event("älter", NOW - 1000), event("neuer", NOW)],
        )
        .expect("append");

        let loaded = load_impl(&conn, 10).expect("load");
        assert_eq!(labels(&loaded), vec!["neuer", "älter"]);
    }

    #[test]
    fn load_respects_its_limit_and_keeps_the_newest() {
        let mut conn = temp_db();
        let events: Vec<_> = (0..5)
            .map(|i| event(&format!("e{}", i), NOW + i as i64))
            .collect();
        append_impl(&mut conn, &events).expect("append");

        let loaded = load_impl(&conn, 2).expect("load");
        assert_eq!(labels(&loaded), vec!["e4", "e3"]);
    }

    #[test]
    fn appending_nothing_leaves_the_store_untouched() {
        let mut conn = temp_db();
        append_impl(&mut conn, &[event("da", NOW)]).expect("append");

        append_impl(&mut conn, &[]).expect("empty append");

        assert_eq!(row_count(&conn), 1);
    }

    #[test]
    fn age_retention_drops_only_rows_past_the_window() {
        let mut conn = temp_db();
        append_impl(
            &mut conn,
            &[
                event("uralt", NOW - 10 * DAY),
                event("gerade noch", NOW - 2 * DAY),
                event("frisch", NOW),
            ],
        )
        .expect("append");

        let deleted = prune_impl(&mut conn, 7, u32::MAX, NOW).expect("prune");

        assert_eq!(deleted, 1);
        assert_eq!(
            labels(&load_impl(&conn, 10).unwrap()),
            vec!["frisch", "gerade noch"]
        );
    }

    #[test]
    fn a_retention_of_zero_days_means_no_age_limit_at_all() {
        let mut conn = temp_db();
        append_impl(
            &mut conn,
            &[event("uralt", NOW - 900 * DAY), event("frisch", NOW)],
        )
        .expect("append");

        let deleted = prune_impl(&mut conn, 0, u32::MAX, NOW).expect("prune");

        assert_eq!(deleted, 0);
        assert_eq!(row_count(&conn), 2);
    }

    #[test]
    fn the_row_cap_removes_the_oldest_rows_first() {
        let mut conn = temp_db();
        let events: Vec<_> = (0..5)
            .map(|i| event(&format!("e{}", i), NOW + i as i64))
            .collect();
        append_impl(&mut conn, &events).expect("append");

        let deleted = prune_impl(&mut conn, 0, 2, NOW).expect("prune");

        assert_eq!(deleted, 3);
        assert_eq!(labels(&load_impl(&conn, 10).unwrap()), vec!["e4", "e3"]);
    }

    #[test]
    fn the_row_cap_applies_after_the_age_sweep_and_the_count_covers_both() {
        let mut conn = temp_db();
        append_impl(
            &mut conn,
            &[
                event("uralt-a", NOW - 10 * DAY),
                event("uralt-b", NOW - 9 * DAY),
                event("frisch-a", NOW - 2 * DAY),
                event("frisch-b", NOW - DAY),
                event("frisch-c", NOW),
            ],
        )
        .expect("append");

        // Age takes the two old rows, the cap then takes one of the three left.
        let deleted = prune_impl(&mut conn, 7, 2, NOW).expect("prune");

        assert_eq!(deleted, 3);
        assert_eq!(row_count(&conn), 2);
        assert_eq!(
            labels(&load_impl(&conn, 10).unwrap()),
            vec!["frisch-c", "frisch-b"]
        );
    }

    #[test]
    fn pruning_an_empty_store_removes_nothing() {
        let mut conn = temp_db();
        assert_eq!(prune_impl(&mut conn, 7, 100, NOW).expect("prune"), 0);
    }

    #[test]
    fn purge_empties_the_store() {
        let mut conn = temp_db();
        append_impl(&mut conn, &[event("a", NOW), event("b", NOW)]).expect("append");

        purge_impl(&conn).expect("purge");

        assert_eq!(row_count(&conn), 0);
        assert!(load_impl(&conn, 10).unwrap().is_empty());
    }

    #[test]
    fn migrations_are_idempotent() {
        let mut conn = temp_db();
        append_impl(&mut conn, &[event("überlebt", NOW)]).expect("append");
        let before: i64 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))
            .unwrap();

        run_migrations(&conn).expect("second run");

        let after: i64 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(before, after);
        assert!(before > 0, "expected at least one migration to be recorded");
        // A re-run must not have re-created (and emptied) the table.
        assert_eq!(row_count(&conn), 1);
    }

    #[test]
    fn a_file_that_is_not_a_database_surfaces_an_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("agent-log.db");
        std::fs::write(&path, "definitely not sqlite").expect("write");

        let opened = init_db(&path);

        assert!(opened.is_err(), "expected an error, got a connection");
    }

    #[test]
    fn an_event_without_a_repo_or_a_path_round_trips() {
        let mut conn = temp_db();
        let mut bare = event("keine Datei", NOW);
        bare.repo_path = None;
        bare.path = None;
        append_impl(&mut conn, &[bare.clone()]).expect("append");

        assert_eq!(load_impl(&conn, 10).unwrap(), vec![bare]);
    }

    #[test]
    fn an_event_arriving_without_its_optional_keys_still_deserializes() {
        // The frontend marks these optional, so an absent repo or path reaches
        // us as a missing key rather than a null.
        let incoming = serde_json::json!({
            "agentId": "agent-1",
            "agentName": "Docs sweep",
            "kind": "note",
            "label": "keine Datei",
            "at": NOW,
            "seq": 1,
        });

        let parsed: AgentLogEvent = serde_json::from_value(incoming).expect("deserialize");

        assert_eq!(parsed.repo_path, None);
        assert_eq!(parsed.path, None);
    }

    #[test]
    fn events_serialize_camel_case_for_the_frontend() {
        let json = serde_json::to_string(&event("a", NOW)).unwrap();
        assert!(json.contains("\"agentId\""));
        assert!(json.contains("\"agentName\""));
        assert!(json.contains("\"repoPath\""));
    }
}
