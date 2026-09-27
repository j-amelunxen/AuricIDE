use super::pm::with_transaction;
use super::types::{
    GoalSyncConflict, GoalsState, GoalsSyncPayload, GoalsSyncResult, PmGoal, PmGoalRequirementLink,
    PmGoalRun, PmGoalStation,
};
use rusqlite::types::Value as SqlValue;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

fn snake_case(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 4);
    for c in key.chars() {
        if c.is_ascii_uppercase() {
            out.push('_');
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

fn sql_value(v: &Value) -> Result<SqlValue, String> {
    match v {
        Value::Null => Ok(SqlValue::Null),
        Value::String(s) => Ok(SqlValue::Text(s.clone())),
        Value::Bool(b) => Ok(SqlValue::Integer(i64::from(*b))),
        Value::Number(n) => n
            .as_i64()
            .map(SqlValue::Integer)
            .ok_or_else(|| format!("Unsupported number {n}")),
        other => Err(format!("Unsupported column value {other}")),
    }
}

/// Bookkeeping that every edit on either side rewrites; it never clashes.
const NEVER_CLASHES: &[&str] = &["updated_at"];

fn current_row(
    conn: &Connection,
    table: &str,
    id: &str,
) -> Result<Option<HashMap<String, SqlValue>>, String> {
    let mut stmt = conn
        .prepare(&format!("SELECT * FROM {table} WHERE id = ?1"))
        .map_err(|e| format!("Failed to read {table} row: {e}"))?;
    let names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();
    let mut rows = stmt
        .query(params![id])
        .map_err(|e| format!("Failed to read {table} row: {e}"))?;
    let Some(row) = rows
        .next()
        .map_err(|e| format!("Failed to read {table} row: {e}"))?
    else {
        return Ok(None);
    };
    let mut out = HashMap::new();
    for (i, name) in names.into_iter().enumerate() {
        let value: SqlValue = row
            .get(i)
            .map_err(|e| format!("Failed to read {table}.{name}: {e}"))?;
        out.insert(name, value);
    }
    Ok(Some(out))
}

/// Writes only the columns where `row` differs from `base` — the edit the UI
/// actually made. Every other column keeps whatever is in the database now,
/// including a value an MCP agent wrote after the UI loaded. A row that no
/// longer exists matches nothing and is not brought back.
///
/// It is a compare-and-swap: when one of those columns now holds a third
/// value, written by someone else since `base` was read, nothing of the row is
/// written and the clash is returned. Neither side may overwrite a status the
/// other has not seen; the store keeps the edit and asks the person.
fn update_changed<T: Serialize>(
    conn: &Connection,
    table: &str,
    id: &str,
    row: &T,
    base: &T,
) -> Result<Option<GoalSyncConflict>, String> {
    let to_map = |v: &T| match serde_json::to_value(v) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err(format!("{table} row is not an object")),
        Err(e) => Err(format!("Failed to serialize {table} row: {e}")),
    };
    let (row, base) = (to_map(row)?, to_map(base)?);
    let mut changed = Vec::new();
    for (key, value) in &row {
        if key == "id" || base.get(key) == Some(value) {
            continue;
        }
        let base_value = base
            .get(key)
            .map(sql_value)
            .transpose()?
            .unwrap_or(SqlValue::Null);
        changed.push((snake_case(key), sql_value(value)?, base_value));
    }
    if changed.is_empty() {
        return Ok(None);
    }
    let Some(current) = current_row(conn, table, id)? else {
        return Ok(None);
    };
    let mut clashing: Vec<String> = changed
        .iter()
        .filter(|(column, mine, was)| {
            let now = current.get(column).unwrap_or(&SqlValue::Null);
            !NEVER_CLASHES.contains(&column.as_str()) && now != was && now != mine
        })
        .map(|(column, _, _)| column.clone())
        .collect();
    if !clashing.is_empty() {
        clashing.sort();
        return Ok(Some(GoalSyncConflict {
            table: table.to_string(),
            id: id.to_string(),
            columns: clashing,
        }));
    }
    let assignments: Vec<String> = changed.iter().map(|(c, _, _)| format!("{c} = ?")).collect();
    let mut values: Vec<SqlValue> = changed.into_iter().map(|(_, v, _)| v).collect();
    values.push(SqlValue::Text(id.to_string()));
    conn.execute(
        &format!("UPDATE {table} SET {} WHERE id = ?", assignments.join(", ")),
        rusqlite::params_from_iter(values),
    )
    .map_err(|e| format!("Failed to update {table} row: {e}"))?;
    Ok(None)
}

// code-gate: complexity-cyclomatic, complexity-function-length - three table upserts in one transaction, one branch per table; splitting them apart would scatter one sync contract
pub fn goals_sync_impl(
    conn: &Connection,
    payload: &GoalsSyncPayload,
) -> Result<GoalsSyncResult, String> {
    let mut conflicts = Vec::new();
    with_transaction(conn, || {
        // Goals may arrive in any order; defer FK checks so a child can be
        // upserted before its parent within the transaction.
        conn.execute_batch("PRAGMA defer_foreign_keys = ON;")
            .map_err(|e| format!("Failed to defer foreign keys: {}", e))?;

        for id in &payload.deleted_goal_ids {
            // Cascades to child goals, runs, and requirement links
            conn.execute("DELETE FROM pm_goals WHERE id = ?1", params![id])
                .map_err(|e| format!("Failed to delete goal: {}", e))?;
        }
        for id in &payload.deleted_run_ids {
            conn.execute("DELETE FROM pm_goal_runs WHERE id = ?1", params![id])
                .map_err(|e| format!("Failed to delete goal run: {}", e))?;
        }
        for id in &payload.deleted_link_ids {
            conn.execute(
                "DELETE FROM pm_goal_requirement_links WHERE id = ?1",
                params![id],
            )
            .map_err(|e| format!("Failed to delete goal requirement link: {}", e))?;
        }
        for id in &payload.deleted_station_ids {
            conn.execute("DELETE FROM pm_goal_stations WHERE id = ?1", params![id])
                .map_err(|e| format!("Failed to delete goal station: {}", e))?;
        }

        let base_goals: HashMap<&str, &PmGoal> = payload
            .base_goals
            .iter()
            .map(|g| (g.id.as_str(), g))
            .collect();
        let base_runs: HashMap<&str, &PmGoalRun> = payload
            .base_goal_runs
            .iter()
            .map(|r| (r.id.as_str(), r))
            .collect();
        let base_stations: HashMap<&str, &PmGoalStation> = payload
            .base_stations
            .iter()
            .map(|s| (s.id.as_str(), s))
            .collect();

        for goal in &payload.goals {
            if let Some(base) = base_goals.get(goal.id.as_str()) {
                conflicts.extend(update_changed(conn, "pm_goals", &goal.id, goal, *base)?);
                continue;
            }
            conn.execute(
                "INSERT INTO pm_goals (id, parent_id, name, description, success_criteria, \
                 status, priority, goal_prompt, created_by, achieved_at, sort_order, \
                 created_at, updated_at, work_mode, mission_path) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15) \
                 ON CONFLICT(id) DO UPDATE SET \
                 parent_id = excluded.parent_id, name = excluded.name, \
                 description = excluded.description, \
                 success_criteria = excluded.success_criteria, status = excluded.status, \
                 priority = excluded.priority, goal_prompt = excluded.goal_prompt, \
                 created_by = excluded.created_by, achieved_at = excluded.achieved_at, \
                 sort_order = excluded.sort_order, updated_at = excluded.updated_at, \
                 work_mode = excluded.work_mode, mission_path = excluded.mission_path",
                params![
                    goal.id,
                    goal.parent_id,
                    goal.name,
                    goal.description,
                    goal.success_criteria,
                    goal.status,
                    goal.priority,
                    goal.goal_prompt,
                    goal.created_by,
                    goal.achieved_at,
                    goal.sort_order,
                    goal.created_at,
                    goal.updated_at,
                    goal.work_mode,
                    goal.mission_path
                ],
            )
            .map_err(|e| format!("Failed to upsert goal: {}", e))?;
        }

        for run in &payload.goal_runs {
            if let Some(base) = base_runs.get(run.id.as_str()) {
                conflicts.extend(update_changed(conn, "pm_goal_runs", &run.id, run, *base)?);
                continue;
            }
            conn.execute(
                "INSERT INTO pm_goal_runs (id, goal_id, agent_id, ticket_id, prompt, model, \
                 provider, source, outcome, summary, started_at, finished_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) \
                 ON CONFLICT(id) DO UPDATE SET \
                 goal_id = excluded.goal_id, agent_id = excluded.agent_id, \
                 ticket_id = excluded.ticket_id, prompt = excluded.prompt, \
                 model = excluded.model, provider = excluded.provider, \
                 source = excluded.source, outcome = excluded.outcome, \
                 summary = excluded.summary, finished_at = excluded.finished_at",
                params![
                    run.id,
                    run.goal_id,
                    run.agent_id,
                    run.ticket_id,
                    run.prompt,
                    run.model,
                    run.provider,
                    run.source,
                    run.outcome,
                    run.summary,
                    run.started_at,
                    run.finished_at
                ],
            )
            .map_err(|e| format!("Failed to upsert goal run: {}", e))?;
        }

        for link in &payload.requirement_links {
            conn.execute(
                "INSERT INTO pm_goal_requirement_links (id, goal_id, requirement_id, created_at) \
                 VALUES (?1, ?2, ?3, ?4) \
                 ON CONFLICT(id) DO NOTHING",
                params![link.id, link.goal_id, link.requirement_id, link.created_at],
            )
            .map_err(|e| format!("Failed to upsert goal requirement link: {}", e))?;
        }

        for station in &payload.stations {
            if let Some(base) = base_stations.get(station.id.as_str()) {
                conflicts.extend(update_changed(
                    conn,
                    "pm_goal_stations",
                    &station.id,
                    station,
                    *base,
                )?);
                continue;
            }
            conn.execute(
                "INSERT INTO pm_goal_stations (id, goal_id, name, kind, status, \
                 evidence_kind, predicate, evidence_note, source_context, ticket_id, lane, sort_order, \
                 last_checked_at, done_at, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16) \
                 ON CONFLICT(id) DO UPDATE SET \
                 goal_id = excluded.goal_id, name = excluded.name, kind = excluded.kind, \
                 status = excluded.status, evidence_kind = excluded.evidence_kind, \
                 predicate = excluded.predicate, evidence_note = excluded.evidence_note, \
                 source_context = excluded.source_context, \
                 ticket_id = excluded.ticket_id, lane = excluded.lane, \
                 sort_order = excluded.sort_order, \
                 last_checked_at = excluded.last_checked_at, done_at = excluded.done_at, \
                 updated_at = excluded.updated_at",
                params![
                    station.id,
                    station.goal_id,
                    station.name,
                    station.kind,
                    station.status,
                    station.evidence_kind,
                    station.predicate,
                    station.evidence_note,
                    station.source_context,
                    station.ticket_id,
                    station.lane,
                    station.sort_order,
                    station.last_checked_at,
                    station.done_at,
                    station.created_at,
                    station.updated_at
                ],
            )
            .map_err(|e| format!("Failed to upsert goal station: {}", e))?;
        }

        Ok(())
    })?;
    Ok(GoalsSyncResult { conflicts })
}

pub fn goals_load_impl(conn: &Connection) -> Result<GoalsState, String> {
    let mut goal_stmt = conn
        .prepare(
            "SELECT id, parent_id, name, description, success_criteria, status, priority, \
             goal_prompt, created_by, achieved_at, sort_order, created_at, updated_at, \
             work_mode, mission_path \
             FROM pm_goals ORDER BY sort_order, created_at",
        )
        .map_err(|e| format!("Failed to prepare goals query: {}", e))?;
    let goals: Vec<PmGoal> = goal_stmt
        .query_map([], |row| {
            Ok(PmGoal {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                success_criteria: row.get(4)?,
                status: row.get(5)?,
                priority: row.get(6)?,
                goal_prompt: row.get(7)?,
                created_by: row.get(8)?,
                achieved_at: row.get(9)?,
                sort_order: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                work_mode: row.get(13)?,
                mission_path: row.get(14)?,
            })
        })
        .map_err(|e| format!("Failed to query goals: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut run_stmt = conn
        .prepare(
            "SELECT id, goal_id, agent_id, ticket_id, prompt, model, provider, source, \
             outcome, summary, started_at, finished_at \
             FROM pm_goal_runs ORDER BY started_at",
        )
        .map_err(|e| format!("Failed to prepare goal runs query: {}", e))?;
    let goal_runs: Vec<PmGoalRun> = run_stmt
        .query_map([], |row| {
            Ok(PmGoalRun {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                agent_id: row.get(2)?,
                ticket_id: row.get(3)?,
                prompt: row.get(4)?,
                model: row.get(5)?,
                provider: row.get(6)?,
                source: row.get(7)?,
                outcome: row.get(8)?,
                summary: row.get(9)?,
                started_at: row.get(10)?,
                finished_at: row.get(11)?,
            })
        })
        .map_err(|e| format!("Failed to query goal runs: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut link_stmt = conn
        .prepare(
            "SELECT id, goal_id, requirement_id, created_at \
             FROM pm_goal_requirement_links ORDER BY created_at",
        )
        .map_err(|e| format!("Failed to prepare goal requirement links query: {}", e))?;
    let requirement_links: Vec<PmGoalRequirementLink> = link_stmt
        .query_map([], |row| {
            Ok(PmGoalRequirementLink {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                requirement_id: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to query goal requirement links: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut station_stmt = conn
        .prepare(
            "SELECT id, goal_id, name, kind, status, evidence_kind, predicate, \
             evidence_note, source_context, ticket_id, lane, sort_order, last_checked_at, done_at, \
             created_at, updated_at \
             FROM pm_goal_stations ORDER BY goal_id, sort_order, created_at",
        )
        .map_err(|e| format!("Failed to prepare goal stations query: {}", e))?;
    let stations: Vec<PmGoalStation> = station_stmt
        .query_map([], |row| {
            Ok(PmGoalStation {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                name: row.get(2)?,
                kind: row.get(3)?,
                status: row.get(4)?,
                evidence_kind: row.get(5)?,
                predicate: row.get(6)?,
                evidence_note: row.get(7)?,
                source_context: row.get(8)?,
                ticket_id: row.get(9)?,
                lane: row.get(10)?,
                sort_order: row.get(11)?,
                last_checked_at: row.get(12)?,
                done_at: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        })
        .map_err(|e| format!("Failed to query goal stations: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(GoalsState {
        goals,
        goal_runs,
        requirement_links,
        stations,
    })
}

pub fn goals_clear_impl(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM pm_goal_stations;
         DELETE FROM pm_goal_requirement_links;
         DELETE FROM pm_goal_runs;
         DELETE FROM pm_goals;",
    )
    .map_err(|e| format!("Failed to clear goals: {}", e))?;
    Ok(())
}
