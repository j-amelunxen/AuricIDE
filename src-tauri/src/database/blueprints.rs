use super::pm::with_transaction;
use super::types::{Blueprint, BlueprintState};
use rusqlite::{params, Connection};

pub fn blueprints_save_impl(conn: &Connection, payload: &BlueprintState) -> Result<(), String> {
    with_transaction(conn, || {
        conn.execute("DELETE FROM blueprints", [])
            .map_err(|e| format!("Failed to clear blueprints: {}", e))?;

        for bp in &payload.blueprints {
            conn.execute(
                "INSERT INTO blueprints (id, name, tech_stack, goal, complexity, category, description, spec, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    bp.id,
                    bp.name,
                    bp.tech_stack,
                    bp.goal,
                    bp.complexity,
                    bp.category,
                    bp.description,
                    bp.spec,
                    bp.created_at,
                    bp.updated_at
                ],
            )
            .map_err(|e| format!("Failed to insert blueprint: {}", e))?;
        }

        Ok(())
    })
}

pub fn blueprints_load_impl(conn: &Connection) -> Result<BlueprintState, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, tech_stack, goal, complexity, category, description, spec, created_at, updated_at \
             FROM blueprints ORDER BY category, name",
        )
        .map_err(|e| format!("Failed to prepare blueprints query: {}", e))?;
    let blueprints: Vec<Blueprint> = stmt
        .query_map([], |row| {
            Ok(Blueprint {
                id: row.get(0)?,
                name: row.get(1)?,
                tech_stack: row.get(2)?,
                goal: row.get(3)?,
                complexity: row.get(4)?,
                category: row.get(5)?,
                description: row.get(6)?,
                spec: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| format!("Failed to query blueprints: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(BlueprintState { blueprints })
}

pub fn blueprints_clear_impl(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM blueprints", [])
        .map_err(|e| format!("Failed to clear blueprints: {}", e))?;
    Ok(())
}
