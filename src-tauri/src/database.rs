use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub struct DatabaseState {
    pub connections: Mutex<HashMap<String, Connection>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct KvEntry {
    pub namespace: String,
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmEpic {
    pub id: String,
    pub name: String,
    pub description: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmContextItem {
    pub id: String,
    pub r#type: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmTicket {
    pub id: String,
    pub epic_id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub status_updated_at: String,
    pub sort_order: i32,
    pub working_directory: Option<String>,
    pub context: Option<Vec<PmContextItem>>,
    pub model_power: Option<String>,
    pub priority: String,
    pub needs_human_supervision: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmTestCase {
    pub id: String,
    pub ticket_id: String,
    pub title: String,
    pub body: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmDependency {
    pub id: String,
    pub source_type: String,
    pub source_id: String,
    pub target_type: String,
    pub target_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmStatusHistoryEntry {
    pub id: String,
    pub ticket_id: String,
    pub from_status: Option<String>,
    pub to_status: String,
    pub changed_at: String,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmSavePayload {
    pub epics: Vec<PmEpic>,
    pub tickets: Vec<PmTicket>,
    pub test_cases: Vec<PmTestCase>,
    pub dependencies: Vec<PmDependency>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmState {
    pub epics: Vec<PmEpic>,
    pub tickets: Vec<PmTicket>,
    pub test_cases: Vec<PmTestCase>,
    pub dependencies: Vec<PmDependency>,
}

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

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id   INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .map_err(|e| format!("Failed to create _migrations table: {}", e))?;

    let applied: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM _migrations WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !applied {
        conn.execute_batch(
            "CREATE TABLE kv_store (
                namespace  TEXT NOT NULL,
                key        TEXT NOT NULL,
                value      TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (namespace, key)
            );",
        )
        .map_err(|e| format!("Failed to create kv_store table: {}", e))?;

        conn.execute(
            "INSERT INTO _migrations (id, name) VALUES (1, 'create_kv_store')",
            [],
        )
        .map_err(|e| format!("Failed to record migration: {}", e))?;
    }

    // Migration #2: PM tables
    let applied2: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM _migrations WHERE id = 2",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !applied2 {
        conn.execute_batch(
            "CREATE TABLE pm_epics (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE pm_tickets (
                id          TEXT PRIMARY KEY,
                epic_id     TEXT NOT NULL REFERENCES pm_epics(id) ON DELETE CASCADE,
                name        TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status      TEXT NOT NULL DEFAULT 'open',
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX idx_tickets_epic ON pm_tickets(epic_id);

            CREATE TABLE pm_test_cases (
                id          TEXT PRIMARY KEY,
                ticket_id   TEXT NOT NULL REFERENCES pm_tickets(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                body        TEXT NOT NULL DEFAULT '',
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX idx_test_cases_ticket ON pm_test_cases(ticket_id);

            CREATE TABLE pm_dependencies (
                id          TEXT PRIMARY KEY,
                source_type TEXT NOT NULL,
                source_id   TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id   TEXT NOT NULL,
                UNIQUE(source_id, target_id)
            );
            CREATE INDEX idx_deps_source ON pm_dependencies(source_id);
            CREATE INDEX idx_deps_target ON pm_dependencies(target_id);",
        )
        .map_err(|e| format!("Failed to create PM tables: {}", e))?;

        conn.execute(
            "INSERT INTO _migrations (id, name) VALUES (2, 'create_pm_tables')",
            [],
        )
        .map_err(|e| format!("Failed to record migration: {}", e))?;
    }

    // Migration #3: Add context to pm_tickets
    let applied3: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM _migrations WHERE id = 3",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !applied3 {
        conn.execute(
            "ALTER TABLE pm_tickets ADD COLUMN context TEXT NOT NULL DEFAULT '[]'",
            [],
        )
        .map_err(|e| format!("Failed to add context column: {}", e))?;

        conn.execute(
            "INSERT INTO _migrations (id, name) VALUES (3, 'add_ticket_context')",
            [],
        )
        .map_err(|e| format!("Failed to record migration: {}", e))?;
    }

    // Migration #4: Add status_updated_at and working_directory to pm_tickets
    let applied4: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM _migrations WHERE id = 4",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !applied4 {
        conn.execute_batch(
            "ALTER TABLE pm_tickets ADD COLUMN status_updated_at TEXT NOT NULL DEFAULT '2026-01-01 00:00:00';
             ALTER TABLE pm_tickets ADD COLUMN working_directory TEXT;",
        )
        .map_err(|e| format!("Failed to add columns: {}", e))?;

        conn.execute(
            "INSERT INTO _migrations (id, name) VALUES (4, 'add_status_updated_at_working_directory')",
            [],
        )
        .map_err(|e| format!("Failed to record migration: {}", e))?;
    }

    // Migration #5: Add priority to pm_tickets
    let applied5: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM _migrations WHERE id = 5",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !applied5 {
        conn.execute(
            "ALTER TABLE pm_tickets ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'",
            [],
        )
        .map_err(|e| format!("Failed to add priority column: {}", e))?;

        conn.execute(
            "INSERT INTO _migrations (id, name) VALUES (5, 'add_ticket_priority')",
            [],
        )
        .map_err(|e| format!("Failed to record migration: {}", e))?;
    }

    // Migration #6: Add model_power to pm_tickets
    let applied6: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM _migrations WHERE id = 6",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !applied6 {
        conn.execute("ALTER TABLE pm_tickets ADD COLUMN model_power TEXT", [])
            .map_err(|e| format!("Failed to add model_power column: {}", e))?;

        conn.execute(
            "INSERT INTO _migrations (id, name) VALUES (6, 'add_ticket_model_power')",
            [],
        )
        .map_err(|e| format!("Failed to record migration: {}", e))?;
    }

    // Migration #7: Add needs_human_supervision to pm_tickets
    let applied7: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM _migrations WHERE id = 7",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !applied7 {
        conn.execute(
            "ALTER TABLE pm_tickets ADD COLUMN needs_human_supervision INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| format!("Failed to add needs_human_supervision column: {}", e))?;

        conn.execute(
            "INSERT INTO _migrations (id, name) VALUES (7, 'add_ticket_needs_human_supervision')",
            [],
        )
        .map_err(|e| format!("Failed to record migration: {}", e))?;
    }

    // Migration #8: pm_status_history table
    let applied8: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM _migrations WHERE id = 8",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !applied8 {
        conn.execute_batch(
            "CREATE TABLE pm_status_history (
                id TEXT PRIMARY KEY,
                ticket_id TEXT NOT NULL,
                from_status TEXT,
                to_status TEXT NOT NULL,
                changed_at TEXT NOT NULL DEFAULT (datetime('now')),
                source TEXT NOT NULL DEFAULT 'ui'
            );
            CREATE INDEX idx_status_history_ticket ON pm_status_history(ticket_id);

            -- Backfill creation events
            INSERT INTO pm_status_history (id, ticket_id, from_status, to_status, changed_at, source)
            SELECT hex(randomblob(16)), id, NULL,
              CASE WHEN status IN ('done','archived','in_progress') THEN 'open' ELSE status END,
              created_at, 'backfill'
            FROM pm_tickets;

            -- Backfill current-status events for non-open tickets
            INSERT INTO pm_status_history (id, ticket_id, from_status, to_status, changed_at, source)
            SELECT hex(randomblob(16)), id, 'open', status, status_updated_at, 'backfill'
            FROM pm_tickets WHERE status != 'open';",
        )
        .map_err(|e| format!("Failed to create pm_status_history table: {}", e))?;

        conn.execute(
            "INSERT INTO _migrations (id, name) VALUES (8, 'create_pm_status_history')",
            [],
        )
        .map_err(|e| format!("Failed to record migration: {}", e))?;
    }

    Ok(())
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

pub fn kv_get(conn: &Connection, namespace: &str, key: &str) -> Result<Option<String>, String> {
    let result = conn.query_row(
        "SELECT value FROM kv_store WHERE namespace = ?1 AND key = ?2",
        params![namespace, key],
        |row| row.get(0),
    );

    match result {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to get key: {}", e)),
    }
}

pub fn kv_set(conn: &Connection, namespace: &str, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO kv_store (namespace, key, value, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(namespace, key) DO UPDATE SET value = ?3, updated_at = datetime('now')",
        params![namespace, key, value],
    )
    .map_err(|e| format!("Failed to set key: {}", e))?;

    Ok(())
}

pub fn kv_delete(conn: &Connection, namespace: &str, key: &str) -> Result<bool, String> {
    let changed = conn
        .execute(
            "DELETE FROM kv_store WHERE namespace = ?1 AND key = ?2",
            params![namespace, key],
        )
        .map_err(|e| format!("Failed to delete key: {}", e))?;

    Ok(changed > 0)
}

pub fn kv_list(conn: &Connection, namespace: &str) -> Result<Vec<KvEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT namespace, key, value, updated_at FROM kv_store
             WHERE namespace = ?1 ORDER BY key",
        )
        .map_err(|e| format!("Failed to prepare list query: {}", e))?;

    let entries = stmt
        .query_map(params![namespace], |row| {
            Ok(KvEntry {
                namespace: row.get(0)?,
                key: row.get(1)?,
                value: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to list keys: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(entries)
}

pub fn validate_no_cycles(deps: &[PmDependency]) -> Result<(), String> {
    use std::collections::{HashMap, HashSet, VecDeque};

    let mut graph: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut in_degree: HashMap<&str, usize> = HashMap::new();
    let mut nodes: HashSet<&str> = HashSet::new();

    for dep in deps {
        nodes.insert(&dep.source_id);
        nodes.insert(&dep.target_id);
        graph
            .entry(&dep.source_id)
            .or_default()
            .push(&dep.target_id);
        *in_degree.entry(&dep.target_id).or_insert(0) += 1;
        in_degree.entry(&dep.source_id).or_insert(0);
    }

    let mut queue: VecDeque<&str> = VecDeque::new();
    for node in &nodes {
        if *in_degree.get(node).unwrap_or(&0) == 0 {
            queue.push_back(node);
        }
    }

    let mut visited = 0usize;
    while let Some(node) = queue.pop_front() {
        visited += 1;
        if let Some(neighbors) = graph.get(node) {
            for neighbor in neighbors {
                let deg = in_degree.get_mut(neighbor).unwrap();
                *deg -= 1;
                if *deg == 0 {
                    queue.push_back(neighbor);
                }
            }
        }
    }

    if visited != nodes.len() {
        Err("Cycle detected in dependencies".to_string())
    } else {
        Ok(())
    }
}

pub fn pm_save_impl(conn: &Connection, payload: &PmSavePayload) -> Result<(), String> {
    validate_no_cycles(&payload.dependencies)?;

    conn.execute_batch("BEGIN TRANSACTION;")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    let result = (|| -> Result<(), String> {
        // Read existing ticket statuses before delete for history tracking
        let mut old_statuses: HashMap<String, String> = HashMap::new();
        {
            let mut stmt = conn
                .prepare("SELECT id, status FROM pm_tickets")
                .map_err(|e| format!("Failed to read old statuses: {}", e))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| format!("Failed to query old statuses: {}", e))?;
            for (id, status) in rows.flatten() {
                old_statuses.insert(id, status);
            }
        }

        conn.execute_batch(
            "DELETE FROM pm_dependencies;
             DELETE FROM pm_test_cases;
             DELETE FROM pm_tickets;
             DELETE FROM pm_epics;",
        )
        .map_err(|e| format!("Failed to clear PM tables: {}", e))?;

        for epic in &payload.epics {
            conn.execute(
                "INSERT INTO pm_epics (id, name, description, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    epic.id,
                    epic.name,
                    epic.description,
                    epic.sort_order,
                    epic.created_at,
                    epic.updated_at
                ],
            )
            .map_err(|e| format!("Failed to insert epic: {}", e))?;
        }

        for ticket in &payload.tickets {
            let context_json = serde_json::to_string(&ticket.context.as_ref().unwrap_or(&vec![]))
                .map_err(|e| format!("Failed to serialize context: {}", e))?;

            conn.execute(
                "INSERT INTO pm_tickets (id, epic_id, name, description, status, \
                 status_updated_at, sort_order, working_directory, context, model_power, priority, \
                 needs_human_supervision, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    ticket.id,
                    ticket.epic_id,
                    ticket.name,
                    ticket.description,
                    ticket.status,
                    ticket.status_updated_at,
                    ticket.sort_order,
                    ticket.working_directory,
                    context_json,
                    ticket.model_power,
                    ticket.priority,
                    ticket.needs_human_supervision,
                    ticket.created_at,
                    ticket.updated_at
                ],
            )
            .map_err(|e| format!("Failed to insert ticket: {}", e))?;
        }

        // Insert status history entries for changed or new tickets
        for ticket in &payload.tickets {
            match old_statuses.get(&ticket.id) {
                Some(old_status) if old_status != &ticket.status => {
                    // Status changed
                    conn.execute(
                        "INSERT INTO pm_status_history \
                         (id, ticket_id, from_status, to_status, changed_at, source) \
                         VALUES (hex(randomblob(16)), ?1, ?2, ?3, datetime('now'), 'ui')",
                        params![ticket.id, old_status, ticket.status],
                    )
                    .map_err(|e| format!("Failed to insert status history: {}", e))?;
                }
                None => {
                    // New ticket
                    conn.execute(
                        "INSERT INTO pm_status_history \
                         (id, ticket_id, from_status, to_status, changed_at, source) \
                         VALUES (hex(randomblob(16)), ?1, NULL, ?2, datetime('now'), 'ui')",
                        params![ticket.id, ticket.status],
                    )
                    .map_err(|e| format!("Failed to insert status history: {}", e))?;
                }
                _ => {} // No change
            }
        }

        for tc in &payload.test_cases {
            conn.execute(
                "INSERT INTO pm_test_cases (id, ticket_id, title, body, sort_order, created_at, \
                 updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    tc.id,
                    tc.ticket_id,
                    tc.title,
                    tc.body,
                    tc.sort_order,
                    tc.created_at,
                    tc.updated_at
                ],
            )
            .map_err(|e| format!("Failed to insert test case: {}", e))?;
        }

        for dep in &payload.dependencies {
            conn.execute(
                "INSERT INTO pm_dependencies (id, source_type, source_id, target_type, target_id)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    dep.id,
                    dep.source_type,
                    dep.source_id,
                    dep.target_type,
                    dep.target_id
                ],
            )
            .map_err(|e| format!("Failed to insert dependency: {}", e))?;
        }

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT;")
                .map_err(|e| format!("Failed to commit transaction: {}", e))?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

pub fn pm_load_impl(conn: &Connection) -> Result<PmState, String> {
    let mut epic_stmt = conn
        .prepare(
            "SELECT id, name, description, sort_order, created_at, updated_at FROM pm_epics \
             ORDER BY sort_order",
        )
        .map_err(|e| format!("Failed to prepare epics query: {}", e))?;
    let epics: Vec<PmEpic> = epic_stmt
        .query_map([], |row| {
            Ok(PmEpic {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                sort_order: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query epics: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut ticket_stmt = conn
        .prepare(
            "SELECT id, epic_id, name, description, status, status_updated_at, sort_order, \
             working_directory, context, model_power, priority, needs_human_supervision, \
             created_at, updated_at FROM pm_tickets ORDER BY sort_order",
        )
        .map_err(|e| format!("Failed to prepare tickets query: {}", e))?;
    let tickets: Vec<PmTicket> = ticket_stmt
        .query_map([], |row| {
            let context_json: String = row.get(8)?;
            let context: Vec<PmContextItem> = serde_json::from_str(&context_json).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })?;

            Ok(PmTicket {
                id: row.get(0)?,
                epic_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                status: row.get(4)?,
                status_updated_at: row.get(5)?,
                sort_order: row.get(6)?,
                working_directory: row.get(7)?,
                context: Some(context),
                model_power: row.get(9)?,
                priority: row.get(10)?,
                needs_human_supervision: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })
        .map_err(|e| format!("Failed to query tickets: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut tc_stmt = conn
        .prepare(
            "SELECT id, ticket_id, title, body, sort_order, created_at, updated_at \
             FROM pm_test_cases ORDER BY sort_order",
        )
        .map_err(|e| format!("Failed to prepare test_cases query: {}", e))?;
    let test_cases: Vec<PmTestCase> = tc_stmt
        .query_map([], |row| {
            Ok(PmTestCase {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                sort_order: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query test_cases: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut dep_stmt = conn
        .prepare("SELECT id, source_type, source_id, target_type, target_id FROM pm_dependencies")
        .map_err(|e| format!("Failed to prepare dependencies query: {}", e))?;
    let dependencies: Vec<PmDependency> = dep_stmt
        .query_map([], |row| {
            Ok(PmDependency {
                id: row.get(0)?,
                source_type: row.get(1)?,
                source_id: row.get(2)?,
                target_type: row.get(3)?,
                target_id: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to query dependencies: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(PmState {
        epics,
        tickets,
        test_cases,
        dependencies,
    })
}

pub fn pm_load_history_impl(conn: &Connection) -> Result<Vec<PmStatusHistoryEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, ticket_id, from_status, to_status, changed_at, source \
             FROM pm_status_history ORDER BY changed_at ASC",
        )
        .map_err(|e| format!("Failed to prepare history query: {}", e))?;
    let entries = stmt
        .query_map([], |row| {
            Ok(PmStatusHistoryEntry {
                id: row.get(0)?,
                ticket_id: row.get(1)?,
                from_status: row.get(2)?,
                to_status: row.get(3)?,
                changed_at: row.get(4)?,
                source: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to query history: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(entries)
}

pub fn pm_clear_impl(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM pm_status_history;
         DELETE FROM pm_dependencies;
         DELETE FROM pm_test_cases;
         DELETE FROM pm_tickets;
         DELETE FROM pm_epics;",
    )
    .map_err(|e| format!("Failed to clear PM tables: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

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
        assert_eq!(count, 8);

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
        assert_eq!(count, 8);
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
        assert_eq!(count, 8);
    }

    #[test]
    fn test_kv_set_and_get() {
        let conn = setup_in_memory_db();

        kv_set(&conn, "settings", "theme", "dark").unwrap();

        let value = kv_get(&conn, "settings", "theme").unwrap();
        assert_eq!(value, Some("dark".to_string()));
    }

    #[test]
    fn test_kv_get_missing_key_returns_none() {
        let conn = setup_in_memory_db();

        let value = kv_get(&conn, "settings", "nonexistent").unwrap();
        assert_eq!(value, None);
    }

    #[test]
    fn test_kv_set_upserts() {
        let conn = setup_in_memory_db();

        kv_set(&conn, "settings", "theme", "dark").unwrap();
        kv_set(&conn, "settings", "theme", "light").unwrap();

        let value = kv_get(&conn, "settings", "theme").unwrap();
        assert_eq!(value, Some("light".to_string()));
    }

    #[test]
    fn test_kv_delete_existing_key() {
        let conn = setup_in_memory_db();

        kv_set(&conn, "settings", "theme", "dark").unwrap();
        let deleted = kv_delete(&conn, "settings", "theme").unwrap();
        assert!(deleted);

        let value = kv_get(&conn, "settings", "theme").unwrap();
        assert_eq!(value, None);
    }

    #[test]
    fn test_kv_delete_missing_key_returns_false() {
        let conn = setup_in_memory_db();

        let deleted = kv_delete(&conn, "settings", "nonexistent").unwrap();
        assert!(!deleted);
    }

    #[test]
    fn test_kv_list_returns_entries_for_namespace() {
        let conn = setup_in_memory_db();

        kv_set(&conn, "settings", "theme", "dark").unwrap();
        kv_set(&conn, "settings", "font", "mono").unwrap();
        kv_set(&conn, "other", "key", "val").unwrap();

        let entries = kv_list(&conn, "settings").unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].key, "font"); // alphabetical
        assert_eq!(entries[1].key, "theme");
    }

    #[test]
    fn test_kv_list_empty_namespace() {
        let conn = setup_in_memory_db();

        let entries = kv_list(&conn, "empty").unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_kv_namespaces_are_isolated() {
        let conn = setup_in_memory_db();

        kv_set(&conn, "ns1", "key", "value1").unwrap();
        kv_set(&conn, "ns2", "key", "value2").unwrap();

        assert_eq!(
            kv_get(&conn, "ns1", "key").unwrap(),
            Some("value1".to_string())
        );
        assert_eq!(
            kv_get(&conn, "ns2", "key").unwrap(),
            Some("value2".to_string())
        );
    }

    #[test]
    fn test_pm_migration_creates_tables() {
        let conn = setup_in_memory_db();

        let tables = [
            "pm_epics",
            "pm_tickets",
            "pm_test_cases",
            "pm_dependencies",
            "pm_status_history",
        ];
        for table in &tables {
            let exists: bool = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='{}'",
                        table
                    ),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(exists, "Table {} should exist", table);
        }

        let migration_count: i32 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(migration_count, 8);
    }

    fn make_test_payload() -> PmSavePayload {
        PmSavePayload {
            epics: vec![PmEpic {
                id: "e1".to_string(),
                name: "Epic One".to_string(),
                description: "First epic".to_string(),
                sort_order: 0,
                created_at: "2026-01-01 00:00:00".to_string(),
                updated_at: "2026-01-01 00:00:00".to_string(),
            }],
            tickets: vec![PmTicket {
                id: "t1".to_string(),
                epic_id: "e1".to_string(),
                name: "Ticket One".to_string(),
                description: "First ticket".to_string(),
                status: "open".to_string(),
                status_updated_at: "2026-01-01 00:00:00".to_string(),
                sort_order: 0,
                working_directory: Some("/tmp".to_string()),
                context: Some(vec![PmContextItem {
                    id: "c1".to_string(),
                    r#type: "snippet".to_string(),
                    value: "some context".to_string(),
                }]),
                model_power: Some("high".to_string()),
                priority: "normal".to_string(),
                needs_human_supervision: false,
                created_at: "2026-01-01 00:00:00".to_string(),
                updated_at: "2026-01-01 00:00:00".to_string(),
            }],
            test_cases: vec![PmTestCase {
                id: "tc1".to_string(),
                ticket_id: "t1".to_string(),
                title: "Test Case One".to_string(),
                body: "Test body".to_string(),
                sort_order: 0,
                created_at: "2026-01-01 00:00:00".to_string(),
                updated_at: "2026-01-01 00:00:00".to_string(),
            }],
            dependencies: vec![PmDependency {
                id: "d1".to_string(),
                source_type: "ticket".to_string(),
                source_id: "t1".to_string(),
                target_type: "ticket".to_string(),
                target_id: "t2".to_string(),
            }],
        }
    }

    #[test]
    fn test_pm_save_and_load_roundtrip() {
        let conn = setup_in_memory_db();
        let payload = make_test_payload();

        pm_save_impl(&conn, &payload).unwrap();
        let state = pm_load_impl(&conn).unwrap();

        assert_eq!(state.epics.len(), 1);
        assert_eq!(state.epics[0].id, "e1");
        assert_eq!(state.epics[0].name, "Epic One");

        assert_eq!(state.tickets.len(), 1);
        assert_eq!(state.tickets[0].id, "t1");
        assert_eq!(state.tickets[0].epic_id, "e1");
        assert_eq!(state.tickets[0].context.as_ref().unwrap().len(), 1);
        assert_eq!(
            state.tickets[0].context.as_ref().unwrap()[0].value,
            "some context"
        );
        assert_eq!(state.tickets[0].model_power, Some("high".to_string()));

        assert_eq!(state.test_cases.len(), 1);
        assert_eq!(state.test_cases[0].id, "tc1");
        assert_eq!(state.test_cases[0].ticket_id, "t1");

        assert_eq!(state.dependencies.len(), 1);
        assert_eq!(state.dependencies[0].source_id, "t1");
        assert_eq!(state.dependencies[0].target_id, "t2");
    }

    #[test]
    fn test_pm_save_replaces_existing() {
        let conn = setup_in_memory_db();

        let payload1 = make_test_payload();
        pm_save_impl(&conn, &payload1).unwrap();

        let payload2 = PmSavePayload {
            epics: vec![PmEpic {
                id: "e2".to_string(),
                name: "Epic Two".to_string(),
                description: "Second epic".to_string(),
                sort_order: 0,
                created_at: "2026-02-01 00:00:00".to_string(),
                updated_at: "2026-02-01 00:00:00".to_string(),
            }],
            tickets: vec![],
            test_cases: vec![],
            dependencies: vec![],
        };
        pm_save_impl(&conn, &payload2).unwrap();

        let state = pm_load_impl(&conn).unwrap();
        assert_eq!(state.epics.len(), 1);
        assert_eq!(state.epics[0].id, "e2");
        assert_eq!(state.tickets.len(), 0);
        assert_eq!(state.test_cases.len(), 0);
        assert_eq!(state.dependencies.len(), 0);
    }

    #[test]
    fn test_pm_clear_empties_tables() {
        let conn = setup_in_memory_db();
        let payload = make_test_payload();
        pm_save_impl(&conn, &payload).unwrap();

        // Verify not empty
        let state_before = pm_load_impl(&conn).unwrap();
        assert!(state_before.epics.len() > 0);

        pm_clear_impl(&conn).unwrap();

        let state_after = pm_load_impl(&conn).unwrap();
        assert_eq!(state_after.epics.len(), 0);
        assert_eq!(state_after.tickets.len(), 0);
        assert_eq!(state_after.test_cases.len(), 0);
        assert_eq!(state_after.dependencies.len(), 0);
    }

    #[test]
    fn test_validate_no_cycles_ok() {
        let deps = vec![
            PmDependency {
                id: "d1".to_string(),
                source_type: "ticket".to_string(),
                source_id: "a".to_string(),
                target_type: "ticket".to_string(),
                target_id: "b".to_string(),
            },
            PmDependency {
                id: "d2".to_string(),
                source_type: "ticket".to_string(),
                source_id: "b".to_string(),
                target_type: "ticket".to_string(),
                target_id: "c".to_string(),
            },
        ];
        assert!(validate_no_cycles(&deps).is_ok());
    }

    #[test]
    fn test_export_import_roundtrip_preserves_data() {
        let dir = TempDir::new().unwrap();
        let project_path = dir.path().to_str().unwrap();

        // 1. Initialize DB and add data
        let conn = init_db(project_path).unwrap();
        kv_set(&conn, "settings", "theme", "dark").unwrap();
        kv_set(&conn, "settings", "font", "mono").unwrap();
        let payload = make_test_payload();
        pm_save_impl(&conn, &payload).unwrap();

        // Verify data exists before export
        assert_eq!(
            kv_get(&conn, "settings", "theme").unwrap(),
            Some("dark".to_string())
        );
        let state = pm_load_impl(&conn).unwrap();
        assert_eq!(state.epics.len(), 1);
        assert_eq!(state.tickets.len(), 1);
        assert_eq!(state.test_cases.len(), 1);
        assert_eq!(state.dependencies.len(), 1);

        // 2. Export: checkpoint WAL and copy DB file (mirrors db_export)
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
        let db_path = dir.path().join(".auric/project.db");
        let export_path = dir.path().join("backup.db");
        fs::copy(&db_path, &export_path).unwrap();

        // 3. Import: close connection, delete files, copy, re-init (mirrors db_import)
        drop(conn);
        let _ = fs::remove_file(dir.path().join(".auric/project.db-wal"));
        let _ = fs::remove_file(dir.path().join(".auric/project.db-shm"));
        fs::remove_file(&db_path).unwrap();
        fs::copy(&export_path, &db_path).unwrap();
        let conn = init_db(project_path).unwrap();

        // 4. Verify ALL data survived the roundtrip
        let theme = kv_get(&conn, "settings", "theme").unwrap();
        assert_eq!(theme, Some("dark".to_string()), "KV data lost after import");

        let font = kv_get(&conn, "settings", "font").unwrap();
        assert_eq!(font, Some("mono".to_string()), "KV data lost after import");

        let state = pm_load_impl(&conn).unwrap();
        assert_eq!(state.epics.len(), 1, "Epics lost after import");
        assert_eq!(state.epics[0].id, "e1");
        assert_eq!(state.tickets.len(), 1, "Tickets lost after import");
        assert_eq!(state.tickets[0].id, "t1");
        assert_eq!(state.test_cases.len(), 1, "Test cases lost after import");
        assert_eq!(
            state.dependencies.len(),
            1,
            "Dependencies lost after import"
        );
    }

    #[test]
    fn test_migration_8_creates_status_history_table() {
        let conn = setup_in_memory_db();

        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' \
                 AND name='pm_status_history'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(exists, "pm_status_history table should exist");
    }

    #[test]
    fn test_pm_save_detects_status_change_inserts_history() {
        let conn = setup_in_memory_db();

        // First save: ticket with status "open"
        let payload1 = make_test_payload();
        pm_save_impl(&conn, &payload1).unwrap();

        // Second save: same ticket with status "in_progress"
        let mut payload2 = make_test_payload();
        payload2.tickets[0].status = "in_progress".to_string();
        pm_save_impl(&conn, &payload2).unwrap();

        let history = pm_load_history_impl(&conn).unwrap();
        // Should have: creation event from first save + change event from second save
        assert!(
            history.len() >= 2,
            "Expected at least 2 history entries, got {}",
            history.len()
        );

        // Find the status change entry
        let change = history
            .iter()
            .find(|h| h.from_status.as_deref() == Some("open") && h.to_status == "in_progress");
        assert!(
            change.is_some(),
            "Should have a status change from open to in_progress"
        );
    }

    #[test]
    fn test_pm_save_detects_new_ticket_inserts_creation_event() {
        let conn = setup_in_memory_db();

        let payload = make_test_payload();
        pm_save_impl(&conn, &payload).unwrap();

        let history = pm_load_history_impl(&conn).unwrap();
        assert!(
            !history.is_empty(),
            "Should have at least one history entry"
        );

        // The creation event should have no from_status
        let creation = history
            .iter()
            .find(|h| h.ticket_id == "t1" && h.from_status.is_none());
        assert!(creation.is_some(), "Should have a creation event for t1");
        assert_eq!(creation.unwrap().to_status, "open");
        assert_eq!(creation.unwrap().source, "ui");
    }

    #[test]
    fn test_pm_save_no_history_when_status_unchanged() {
        let conn = setup_in_memory_db();

        let payload = make_test_payload();
        pm_save_impl(&conn, &payload).unwrap();

        let history_after_first = pm_load_history_impl(&conn).unwrap();
        let count_after_first = history_after_first.len();

        // Save again with no status change
        pm_save_impl(&conn, &payload).unwrap();

        let history_after_second = pm_load_history_impl(&conn).unwrap();
        assert_eq!(
            history_after_second.len(),
            count_after_first,
            "No new history entries should be created when status is unchanged"
        );
    }

    #[test]
    fn test_pm_load_history_returns_ordered_entries() {
        let conn = setup_in_memory_db();

        // Save with open status
        let payload1 = make_test_payload();
        pm_save_impl(&conn, &payload1).unwrap();

        // Change to in_progress
        let mut payload2 = make_test_payload();
        payload2.tickets[0].status = "in_progress".to_string();
        pm_save_impl(&conn, &payload2).unwrap();

        // Change to done
        let mut payload3 = make_test_payload();
        payload3.tickets[0].status = "done".to_string();
        pm_save_impl(&conn, &payload3).unwrap();

        let history = pm_load_history_impl(&conn).unwrap();
        assert!(
            history.len() >= 3,
            "Expected at least 3 history entries, got {}",
            history.len()
        );

        // Verify ordering by changed_at ASC
        for i in 1..history.len() {
            assert!(
                history[i].changed_at >= history[i - 1].changed_at,
                "History should be ordered by changed_at ASC"
            );
        }
    }

    #[test]
    fn test_pm_clear_clears_history() {
        let conn = setup_in_memory_db();

        let payload = make_test_payload();
        pm_save_impl(&conn, &payload).unwrap();

        let history = pm_load_history_impl(&conn).unwrap();
        assert!(
            !history.is_empty(),
            "Should have history entries before clear"
        );

        pm_clear_impl(&conn).unwrap();

        let history_after = pm_load_history_impl(&conn).unwrap();
        assert!(
            history_after.is_empty(),
            "History should be empty after clear"
        );
    }

    #[test]
    fn test_validate_no_cycles_detects_cycle() {
        let deps = vec![
            PmDependency {
                id: "d1".to_string(),
                source_type: "ticket".to_string(),
                source_id: "a".to_string(),
                target_type: "ticket".to_string(),
                target_id: "b".to_string(),
            },
            PmDependency {
                id: "d2".to_string(),
                source_type: "ticket".to_string(),
                source_id: "b".to_string(),
                target_type: "ticket".to_string(),
                target_id: "a".to_string(),
            },
        ];
        let result = validate_no_cycles(&deps);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cycle"));
    }
}
