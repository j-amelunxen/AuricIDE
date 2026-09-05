use super::pm::with_transaction;
use super::types::{
    GoalsState, GoalsSyncPayload, PmGoal, PmGoalRequirementLink, PmGoalRun, PmGoalStation,
};
use rusqlite::{params, Connection};

pub fn goals_sync_impl(conn: &Connection, payload: &GoalsSyncPayload) -> Result<(), String> {
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

        for goal in &payload.goals {
            conn.execute(
                "INSERT INTO pm_goals (id, parent_id, name, description, success_criteria, \
                 status, priority, goal_prompt, created_by, achieved_at, sort_order, \
                 created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) \
                 ON CONFLICT(id) DO UPDATE SET \
                 parent_id = excluded.parent_id, name = excluded.name, \
                 description = excluded.description, \
                 success_criteria = excluded.success_criteria, status = excluded.status, \
                 priority = excluded.priority, goal_prompt = excluded.goal_prompt, \
                 created_by = excluded.created_by, achieved_at = excluded.achieved_at, \
                 sort_order = excluded.sort_order, updated_at = excluded.updated_at",
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
                    goal.updated_at
                ],
            )
            .map_err(|e| format!("Failed to upsert goal: {}", e))?;
        }

        for run in &payload.goal_runs {
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
    })
}

pub fn goals_load_impl(conn: &Connection) -> Result<GoalsState, String> {
    let mut goal_stmt = conn
        .prepare(
            "SELECT id, parent_id, name, description, success_criteria, status, priority, \
             goal_prompt, created_by, achieved_at, sort_order, created_at, updated_at \
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
