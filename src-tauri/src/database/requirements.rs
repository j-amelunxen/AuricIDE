use super::pm::with_transaction;
use super::types::{PmRequirement, PmRequirementTestLink, RequirementsState};
use rusqlite::{params, Connection};

pub fn requirements_save_impl(
    conn: &Connection,
    payload: &RequirementsState,
) -> Result<(), String> {
    with_transaction(conn, || {
        conn.execute("DELETE FROM pm_requirements", [])
            .map_err(|e| format!("Failed to clear requirements: {}", e))?;

        for req in &payload.requirements {
            conn.execute(
                "INSERT INTO pm_requirements (id, req_id, title, description, type, category, priority, status, rationale, acceptance_criteria, source, applies_to, last_verified_at, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    req.id,
                    req.req_id,
                    req.title,
                    req.description,
                    req.r#type,
                    req.category,
                    req.priority,
                    req.status,
                    req.rationale,
                    req.acceptance_criteria,
                    req.source,
                    req.applies_to,
                    req.last_verified_at,
                    req.sort_order,
                    req.created_at,
                    req.updated_at
                ],
            )
            .map_err(|e| format!("Failed to insert requirement: {}", e))?;
        }

        for link in &payload.test_links {
            conn.execute(
                "INSERT INTO pm_requirement_test_links (id, requirement_id, test_case_id, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![link.id, link.requirement_id, link.test_case_id, link.created_at],
            )
            .map_err(|e| format!("Failed to insert requirement test link: {}", e))?;
        }

        Ok(())
    })
}

pub fn requirements_load_impl(conn: &Connection) -> Result<RequirementsState, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, req_id, title, description, type, category, priority, status, rationale, acceptance_criteria, source, applies_to, last_verified_at, sort_order, created_at, updated_at \
             FROM pm_requirements ORDER BY sort_order, req_id",
        )
        .map_err(|e| format!("Failed to prepare requirements query: {}", e))?;
    let requirements: Vec<PmRequirement> = stmt
        .query_map([], |row| {
            Ok(PmRequirement {
                id: row.get(0)?,
                req_id: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
                r#type: row.get(4)?,
                category: row.get(5)?,
                priority: row.get(6)?,
                status: row.get(7)?,
                rationale: row.get(8)?,
                acceptance_criteria: row.get(9)?,
                source: row.get(10)?,
                applies_to: row.get(11)?,
                last_verified_at: row.get(12)?,
                sort_order: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        })
        .map_err(|e| format!("Failed to query requirements: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let mut link_stmt = conn
        .prepare(
            "SELECT id, requirement_id, test_case_id, created_at \
             FROM pm_requirement_test_links ORDER BY created_at",
        )
        .map_err(|e| format!("Failed to prepare test links query: {}", e))?;
    let test_links: Vec<PmRequirementTestLink> = link_stmt
        .query_map([], |row| {
            Ok(PmRequirementTestLink {
                id: row.get(0)?,
                requirement_id: row.get(1)?,
                test_case_id: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to query test links: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(RequirementsState {
        requirements,
        test_links,
    })
}

pub fn requirements_clear_impl(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DELETE FROM pm_requirement_test_links;
         DELETE FROM pm_requirements;",
    )
    .map_err(|e| format!("Failed to clear requirements: {}", e))?;
    Ok(())
}
