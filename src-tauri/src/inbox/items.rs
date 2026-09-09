use super::attachments::load_attachments;
use super::types::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub(crate) fn row_to_item(row: &rusqlite::Row) -> rusqlite::Result<InboxItem> {
    Ok(InboxItem {
        id: row.get(0)?,
        title: row.get(1)?,
        notes: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        project_path: row.get(5)?,
        project_name: row.get(6)?,
        ticket_id: row.get(7)?,
        assigned_at: row.get(8)?,
        dismissed_at: row.get(9)?,
        priority: row.get(10)?,
        due_date: row.get(11)?,
        daily_goal: row.get::<_, i32>(12).map(|v| v != 0).unwrap_or(false),
        attachments: Vec::new(),
    })
}

pub(crate) fn hydrate_item(conn: &Connection, mut item: InboxItem) -> Result<InboxItem, String> {
    item.attachments = load_attachments(conn, &item.id)?;
    Ok(item)
}

pub(crate) fn resolve_priority(value: Option<&str>) -> Result<String, String> {
    let priority = value.unwrap_or("normal");
    if !VALID_PRIORITIES.contains(&priority) {
        return Err(format!("Invalid priority: {}", priority));
    }
    Ok(priority.to_string())
}

/// Blank becomes `None`. Anything else must be a real `YYYY-MM-DD` day.
pub(crate) fn parse_due_date(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d").is_err() {
        return Err(format!("Invalid due date: {}", trimmed));
    }
    Ok(Some(trimmed.to_string()))
}

pub(crate) fn get_impl(conn: &Connection, id: &str) -> Result<InboxItem, String> {
    let sql = format!("SELECT {} FROM inbox_items WHERE id = ?1", SELECT_COLUMNS);
    let item = conn
        .query_row(&sql, params![id], row_to_item)
        .map_err(|_| format!("Inbox item not found: {}", id))?;
    hydrate_item(conn, item)
}

/// Non-dismissed items, newest first.
pub fn list_impl(conn: &Connection) -> Result<Vec<InboxItem>, String> {
    let sql = format!(
        "SELECT {} FROM inbox_items WHERE dismissed_at IS NULL ORDER BY created_at DESC, rowid DESC",
        SELECT_COLUMNS
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare inbox query: {}", e))?;
    let rows = stmt
        .query_map([], row_to_item)
        .map_err(|e| format!("Failed to query inbox items: {}", e))?;

    let items = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("Failed to read inbox items: {}", e))?;
    items
        .into_iter()
        .map(|item| hydrate_item(conn, item))
        .collect()
}

/// Trims the title; a blank title is rejected rather than stored.
pub fn add_impl(conn: &Connection, input: &InboxItemInput) -> Result<InboxItem, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("Title must not be empty".to_string());
    }

    let priority = resolve_priority(input.priority.as_deref())?;
    let due_date = parse_due_date(input.due_date.as_deref())?;
    let daily_goal = input.daily_goal.unwrap_or(false);

    conn.execute(
        "INSERT INTO inbox_items (id, title, notes, priority, due_date, daily_goal)
         VALUES (hex(randomblob(16)), ?1, ?2, ?3, ?4, ?5)",
        params![title, input.notes, priority, due_date, daily_goal as i32],
    )
    .map_err(|e| format!("Failed to add inbox item: {}", e))?;

    let sql = format!(
        "SELECT {} FROM inbox_items WHERE rowid = ?1",
        SELECT_COLUMNS
    );
    let item = conn
        .query_row(&sql, params![conn.last_insert_rowid()], row_to_item)
        .map_err(|e| format!("Failed to read back inbox item: {}", e))?;
    hydrate_item(conn, item)
}

fn patch_touches_ticket(patch: &InboxItemPatch) -> bool {
    patch.title.is_some()
        || patch.notes.is_some()
        || patch.priority.is_some()
        || patch.due_date.is_some()
}

/// After assign the ticket is the durable record. An inbox edit of title,
/// notes, priority or due date writes through to that project's ticket so
/// the two copies cannot drift.
fn apply_patch_to_ticket(
    project_path: &str,
    ticket_id: &str,
    patch: &InboxItemPatch,
) -> Result<(), String> {
    if !patch_touches_ticket(patch) {
        return Ok(());
    }
    if !Path::new(project_path).is_dir() {
        return Err(format!("Project folder does not exist: {}", project_path));
    }

    let conn = crate::database::init_db(project_path)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    let (name, description, priority, due_date): (String, String, String, Option<String>) = conn
        .query_row(
            "SELECT name, description, priority, due_date FROM pm_tickets WHERE id = ?1",
            params![ticket_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| format!("Failed to read ticket {}: {}", ticket_id, e))?;

    let next_name = match &patch.title {
        Some(title) => {
            let trimmed = title.trim();
            if trimmed.is_empty() {
                return Err("Title must not be empty".to_string());
            }
            trimmed.to_string()
        }
        None => name.clone(),
    };
    let next_description = patch.notes.clone().unwrap_or_else(|| description.clone());
    let next_priority = match &patch.priority {
        Some(value) => resolve_priority(Some(value.as_str()))?,
        None => priority.clone(),
    };
    let next_due_date = match &patch.due_date {
        Some(value) => parse_due_date(Some(value.as_str()))?,
        None => due_date.clone(),
    };

    if next_name == name
        && next_description == description
        && next_priority == priority
        && next_due_date == due_date
    {
        return Ok(());
    }

    conn.execute(
        "UPDATE pm_tickets
         SET name = ?1, description = ?2, priority = ?3, due_date = ?4,
             updated_at = datetime('now')
         WHERE id = ?5",
        params![
            next_name,
            next_description,
            next_priority,
            next_due_date,
            ticket_id
        ],
    )
    .map_err(|e| format!("Failed to update ticket {}: {}", ticket_id, e))?;
    Ok(())
}

pub fn update_impl(
    conn: &Connection,
    id: &str,
    patch: &InboxItemPatch,
) -> Result<InboxItem, String> {
    let current = get_impl(conn, id)?;
    if let (Some(project_path), Some(ticket_id)) = (&current.project_path, &current.ticket_id) {
        apply_patch_to_ticket(project_path, ticket_id, patch)?;
    }

    if let Some(title) = &patch.title {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            return Err("Title must not be empty".to_string());
        }
        conn.execute(
            "UPDATE inbox_items SET title = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![trimmed, id],
        )
        .map_err(|e| format!("Failed to update inbox item title: {}", e))?;
    }

    if let Some(notes) = &patch.notes {
        conn.execute(
            "UPDATE inbox_items SET notes = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![notes, id],
        )
        .map_err(|e| format!("Failed to update inbox item notes: {}", e))?;
    }

    if let Some(priority) = &patch.priority {
        let resolved = resolve_priority(Some(priority.as_str()))?;
        conn.execute(
            "UPDATE inbox_items SET priority = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![resolved, id],
        )
        .map_err(|e| format!("Failed to update inbox item priority: {}", e))?;
    }

    if let Some(due_date) = &patch.due_date {
        let parsed = parse_due_date(Some(due_date.as_str()))?;
        conn.execute(
            "UPDATE inbox_items SET due_date = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![parsed, id],
        )
        .map_err(|e| format!("Failed to update inbox item due date: {}", e))?;
    }

    if let Some(daily_goal) = patch.daily_goal {
        conn.execute(
            "UPDATE inbox_items SET daily_goal = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![daily_goal as i32, id],
        )
        .map_err(|e| format!("Failed to update inbox item daily goal: {}", e))?;
    }

    get_impl(conn, id)
}

/// Soft delete. Never touches any project ticket — an item can be dismissed
/// from the inbox view without disturbing work already assigned elsewhere.
pub fn dismiss_impl(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE inbox_items SET dismissed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?1 AND dismissed_at IS NULL",
        params![id],
    )
    .map_err(|e| format!("Failed to dismiss inbox item: {}", e))?;
    Ok(())
}

/// Clears the project/ticket link on the inbox row only. The ticket itself
/// stays in the project — this is how a wrong drop gets undone, not how work
/// gets deleted.
pub fn unassign_impl(conn: &Connection, id: &str) -> Result<InboxItem, String> {
    conn.execute(
        "UPDATE inbox_items
         SET project_path = NULL, project_name = NULL, ticket_id = NULL,
             assigned_at = NULL, updated_at = datetime('now')
         WHERE id = ?1",
        params![id],
    )
    .map_err(|e| format!("Failed to unassign inbox item: {}", e))?;
    get_impl(conn, id)
}

/// Captures or updates a ticket from a project into the inbox with daily_goal status.
/// If an active (non-dismissed) inbox item for this ticket already exists, it updates its daily_goal flag.
/// Otherwise, it reads ticket details from the project database and inserts an assigned inbox item.
pub fn capture_ticket_impl(
    conn: &Connection,
    project_path: &str,
    ticket_id: &str,
    daily_goal: bool,
) -> Result<InboxItem, String> {
    // 1. Check if already in inbox
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM inbox_items WHERE ticket_id = ?1 AND dismissed_at IS NULL LIMIT 1",
            params![ticket_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to check existing inbox item: {}", e))?;

    if let Some(id) = existing_id {
        return update_impl(
            conn,
            &id,
            &InboxItemPatch {
                daily_goal: Some(daily_goal),
                ..Default::default()
            },
        );
    }

    // 2. Read from project database
    if !Path::new(project_path).is_dir() {
        return Err(format!("Project folder does not exist: {}", project_path));
    }
    let project_conn = crate::database::init_db(project_path)?;
    project_conn
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    let (name, description, priority, due_date): (String, String, String, Option<String>) =
        project_conn
            .query_row(
                "SELECT name, description, priority, due_date FROM pm_tickets WHERE id = ?1",
                params![ticket_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|e| format!("Failed to read ticket {}: {}", ticket_id, e))?;

    let project_name = Path::new(project_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| project_path.to_string());

    conn.execute(
        "INSERT INTO inbox_items
            (id, title, notes, priority, due_date, project_path, project_name, ticket_id, assigned_at, daily_goal)
         VALUES (hex(randomblob(16)), ?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'), ?8)",
        params![
            name,
            description,
            priority,
            due_date,
            project_path,
            project_name,
            ticket_id,
            daily_goal as i32
        ],
    )
    .map_err(|e| format!("Failed to capture ticket into inbox: {}", e))?;

    let sql = format!(
        "SELECT {} FROM inbox_items WHERE rowid = ?1",
        SELECT_COLUMNS
    );
    let item = conn
        .query_row(&sql, params![conn.last_insert_rowid()], row_to_item)
        .map_err(|e| format!("Failed to read back captured inbox item: {}", e))?;
    hydrate_item(conn, item)
}
