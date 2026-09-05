use rusqlite::{params, Connection};
use std::collections::HashMap;

use super::types::{
    PmContextItem, PmDependency, PmEpic, PmSavePayload, PmState, PmStatusHistoryEntry, PmTestCase,
    PmTicket,
};

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

/// Runs `f` inside a SQLite transaction, committing on success and rolling back
/// on any error. The error from `f` is propagated unchanged.
pub(crate) fn with_transaction<F>(conn: &Connection, f: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    conn.execute_batch("BEGIN TRANSACTION;")
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    match f() {
        Ok(()) => conn
            .execute_batch("COMMIT;")
            .map_err(|e| format!("Failed to commit transaction: {}", e)),
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

pub fn pm_save_impl(conn: &Connection, payload: &PmSavePayload) -> Result<(), String> {
    validate_no_cycles(&payload.dependencies)?;

    with_transaction(conn, || {
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
            let skills_json = serde_json::to_string(&ticket.skills)
                .map_err(|e| format!("Failed to serialize skills: {}", e))?;

            conn.execute(
                "INSERT INTO pm_tickets (id, epic_id, name, description, status, \
                 status_updated_at, sort_order, working_directory, context, model_power, priority, \
                 needs_human_supervision, goal_id, due_date, skills, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
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
                    ticket.goal_id,
                    ticket.due_date,
                    skills_json,
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
    })
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
             goal_id, due_date, skills, created_at, updated_at FROM pm_tickets ORDER BY sort_order",
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
            let skills_json: String = row.get(14)?;
            let skills: Vec<String> = serde_json::from_str(&skills_json).unwrap_or_default();

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
                goal_id: row.get(12)?,
                due_date: row.get(13)?,
                skills,
                created_at: row.get(15)?,
                updated_at: row.get(16)?,
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
