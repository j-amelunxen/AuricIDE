//! A ticket or goal named at registration, looked up in that project only, on a
//! read-only connection and as a bound parameter. An unknown or ambiguous name
//! is refused, so a typo cannot lose a run's place in the billing.

use super::model::{ExternalRegisterParams, Links};
use crate::database::project_db_path;
use rusqlite::{params, Connection, OpenFlags};
use std::path::Path;
use std::time::Duration;

const TICKET_NAME_MAX_CHARS: usize = 40;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

fn open(project: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(
        project_db_path(project),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("the project database cannot be read: {error}"))?;
    conn.busy_timeout(BUSY_TIMEOUT)
        .map_err(|error| error.to_string())?;
    Ok(conn)
}

/// `(id, name, goal)` of each row whose id is `wanted` or starts with it. The
/// exact id wins over any longer id that happens to start the same way.
fn one_match(
    conn: &Connection,
    field: &str,
    sql: &str,
    wanted: &str,
) -> Result<(String, String, Option<String>), String> {
    let read = || -> rusqlite::Result<Vec<(String, String, Option<String>)>> {
        let mut statement = conn.prepare(sql)?;
        let rows = statement.query_map(params![wanted], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
        rows.collect()
    };
    let mut found = read().map_err(|error| format!("{field} cannot be looked up: {error}"))?;
    if let Some(at) = found.iter().position(|(id, _, _)| id == wanted) {
        return Ok(found.swap_remove(at));
    }
    match found.len() {
        0 => Err(format!("{field} {wanted} is not in this project")),
        1 => Ok(found.remove(0)),
        _ => Err(format!(
            "{field} {wanted} fits more than one; pass more of it"
        )),
    }
}

/// Up to three rows are enough to tell one from several.
const TICKET_SQL: &str = "SELECT id, name, goal_id FROM pm_tickets
     WHERE substr(id, 1, length(?1)) = ?1 ORDER BY id = ?1 DESC LIMIT 3";
const GOAL_SQL: &str = "SELECT id, name, NULL FROM pm_goals
     WHERE substr(id, 1, length(?1)) = ?1 ORDER BY id = ?1 DESC LIMIT 3";

/// The links a register call asks for; a goal not named is the ticket's own.
pub fn resolve_links(project: &Path, params: &ExternalRegisterParams) -> Result<Links, String> {
    if params.ticket_id.is_none() && params.goal_id.is_none() {
        return Ok(Links::default());
    }
    let conn = open(project)?;
    let mut links = Links::default();
    if let Some(wanted) = params.ticket_id.as_deref() {
        let (id, name, goal) = one_match(&conn, "ticketId", TICKET_SQL, wanted)?;
        links.ticket = Some((id, name.chars().take(TICKET_NAME_MAX_CHARS).collect()));
        links.goal_id = goal;
    }
    if let Some(wanted) = params.goal_id.as_deref() {
        links.goal_id = Some(one_match(&conn, "goalId", GOAL_SQL, wanted)?.0);
    }
    Ok(links)
}
