use super::types::*;
use rusqlite::{Connection, OpenFlags};
use std::path::Path;

type StatusCounts = (u32, u32, u32, u32);

/// One overview per input path, same order, never creating or migrating a
/// project database. A missing `.auric/project.db` reports `has_db: false`;
/// any read failure (old schema, corrupt file, ...) reports `error` instead
/// of panicking or failing the whole call.
pub fn projects_pm_overview_impl(project_paths: &[String]) -> Vec<ProjectPmOverview> {
    project_paths
        .iter()
        .map(|path| project_pm_overview_one(path))
        .collect()
}

fn project_pm_overview_one(project_path: &str) -> ProjectPmOverview {
    let project_name = Path::new(project_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| project_path.to_string());

    let db_path = Path::new(project_path).join(".auric").join("project.db");

    if !db_path.exists() {
        return ProjectPmOverview {
            project_path: project_path.to_string(),
            project_name,
            has_db: false,
            open: 0,
            in_progress: 0,
            in_review: 0,
            done: 0,
            epics: Vec::new(),
            tickets: Vec::new(),
            error: None,
        };
    }

    match read_project_pm_overview(&db_path) {
        Ok((counts, epics, tickets)) => ProjectPmOverview {
            project_path: project_path.to_string(),
            project_name,
            has_db: true,
            open: counts.0,
            in_progress: counts.1,
            in_review: counts.2,
            done: counts.3,
            epics,
            tickets,
            error: None,
        },
        Err(error) => ProjectPmOverview {
            project_path: project_path.to_string(),
            project_name,
            has_db: true,
            open: 0,
            in_progress: 0,
            in_review: 0,
            done: 0,
            epics: Vec::new(),
            tickets: Vec::new(),
            error: Some(error),
        },
    }
}

fn read_project_pm_overview(
    db_path: &Path,
) -> Result<
    (
        StatusCounts,
        Vec<ProjectEpicDigest>,
        Vec<ProjectTicketDigest>,
    ),
    String,
> {
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open project database: {}", e))?;

    conn.busy_timeout(std::time::Duration::from_secs(1))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    let mut counts: StatusCounts = (0, 0, 0, 0);
    {
        let mut stmt = conn
            .prepare(
                "SELECT status, COUNT(*) FROM pm_tickets \
                 WHERE status NOT IN ('archived', 'discarded') GROUP BY status",
            )
            .map_err(|e| format!("Failed to read ticket counts: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| format!("Failed to read ticket counts: {}", e))?;
        for row in rows {
            let (status, count) =
                row.map_err(|e| format!("Failed to read ticket counts: {}", e))?;
            match status.as_str() {
                "open" => counts.0 = count as u32,
                "in_progress" => counts.1 = count as u32,
                "in_review" => counts.2 = count as u32,
                "done" => counts.3 = count as u32,
                _ => {}
            }
        }
    }

    let epics = {
        let mut stmt = conn
            .prepare("SELECT id, name FROM pm_epics ORDER BY sort_order")
            .map_err(|e| format!("Failed to read epics: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ProjectEpicDigest {
                    id: row.get(0)?,
                    name: row.get(1)?,
                })
            })
            .map_err(|e| format!("Failed to read epics: {}", e))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| format!("Failed to read epics: {}", e))?;
        rows
    };

    let tickets = {
        let mut stmt = conn
            .prepare(
                "SELECT t.id, t.name, t.status, t.priority, t.epic_id, e.name, t.updated_at,
                        t.due_date, t.description
                 FROM pm_tickets t
                 JOIN pm_epics e ON e.id = t.epic_id
                 WHERE t.status NOT IN ('done', 'archived', 'discarded')
                 ORDER BY t.updated_at DESC",
            )
            .map_err(|e| format!("Failed to read tickets: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ProjectTicketDigest {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    status: row.get(2)?,
                    priority: row.get(3)?,
                    epic_id: row.get(4)?,
                    epic_name: row.get(5)?,
                    updated_at: row.get(6)?,
                    due_date: row.get(7)?,
                    description: row.get(8)?,
                })
            })
            .map_err(|e| format!("Failed to read tickets: {}", e))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| format!("Failed to read tickets: {}", e))?;
        rows
    };

    Ok((counts, epics, tickets))
}
