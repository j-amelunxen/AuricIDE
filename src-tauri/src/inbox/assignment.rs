use super::attachments::copy_attachments_into_project;
use super::items::{get_impl, resolve_priority};
use super::types::*;
use rusqlite::{params, Connection};
use std::path::Path;

fn find_or_create_inbox_epic(conn: &Connection) -> Result<String, String> {
    let existing = conn.query_row(
        "SELECT id FROM pm_epics WHERE name = ?1 LIMIT 1",
        params![INBOX_EPIC_NAME],
        |row| row.get::<_, String>(0),
    );

    match existing {
        Ok(id) => return Ok(id),
        Err(rusqlite::Error::QueryReturnedNoRows) => {}
        Err(e) => return Err(format!("Failed to look up Inbox epic: {}", e)),
    }

    let max_sort: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) FROM pm_epics",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to read epic sort order: {}", e))?;

    conn.execute(
        "INSERT INTO pm_epics (id, name, sort_order) VALUES (hex(randomblob(16)), ?1, ?2)",
        params![INBOX_EPIC_NAME, max_sort + 1],
    )
    .map_err(|e| format!("Failed to create Inbox epic: {}", e))?;

    conn.query_row(
        "SELECT id FROM pm_epics WHERE rowid = ?1",
        params![conn.last_insert_rowid()],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to read back Inbox epic: {}", e))
}

fn epic_exists(conn: &Connection, epic_id: &str) -> Result<bool, String> {
    match conn.query_row(
        "SELECT 1 FROM pm_epics WHERE id = ?1",
        params![epic_id],
        |_| Ok(()),
    ) {
        Ok(()) => Ok(true),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(e) => Err(format!("Failed to look up epic: {}", e)),
    }
}

fn create_ticket_from_inbox(
    conn: &Connection,
    epic_id: &str,
    title: &str,
    notes: &str,
    priority: &str,
    due_date: Option<&str>,
    context_json: &str,
) -> Result<String, String> {
    let max_sort: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) FROM pm_tickets WHERE epic_id = ?1",
            params![epic_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to read ticket sort order: {}", e))?;

    conn.execute(
        "INSERT INTO pm_tickets
            (id, epic_id, name, description, status, sort_order, priority, goal_id,
             needs_human_supervision, due_date, context)
         VALUES (hex(randomblob(16)), ?1, ?2, ?3, 'open', ?4, ?5, NULL, 0, ?6, ?7)",
        params![
            epic_id,
            title,
            notes,
            max_sort + 1,
            priority,
            due_date,
            context_json
        ],
    )
    .map_err(|e| format!("Failed to create ticket: {}", e))?;

    let ticket_id: String = conn
        .query_row(
            "SELECT id FROM pm_tickets WHERE rowid = ?1",
            params![conn.last_insert_rowid()],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to read back ticket: {}", e))?;

    conn.execute(
        "INSERT INTO pm_status_history (id, ticket_id, from_status, to_status, changed_at, source)
         VALUES (hex(randomblob(16)), ?1, NULL, 'open', datetime('now'), 'inbox')",
        params![ticket_id],
    )
    .map_err(|e| format!("Failed to record ticket status history: {}", e))?;

    Ok(ticket_id)
}

/// Assigns an inbox item to a project: opens (and migrates) that project's
/// database, resolves or creates the epic, creates the ticket, then links the
/// inbox row to it. The project write happens before the inbox write.
pub fn assign_impl(conn: &Connection, request: &InboxAssignRequest) -> Result<InboxItem, String> {
    let item = get_impl(conn, &request.item_id)?;
    if item.project_path.is_some() {
        return Err("Item is already assigned".to_string());
    }

    let priority = resolve_priority(request.priority.as_deref().or(Some(item.priority.as_str())))?;

    if !Path::new(&request.project_path).is_dir() {
        return Err(format!(
            "Project folder does not exist: {}",
            request.project_path
        ));
    }

    let project_conn = crate::database::init_db(&request.project_path)?;

    project_conn
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    let tx = rusqlite::Transaction::new_unchecked(
        &project_conn,
        rusqlite::TransactionBehavior::Immediate,
    )
    .map_err(|e| format!("Failed to begin project transaction: {}", e))?;

    let epic_id = match &request.epic_id {
        Some(id) => {
            if !epic_exists(&tx, id)? {
                return Err(format!("Epic not found: {}", id));
            }
            id.clone()
        }
        None => find_or_create_inbox_epic(&tx)?,
    };

    let ticket_id = create_ticket_from_inbox(
        &tx,
        &epic_id,
        &item.title,
        &item.notes,
        &priority,
        item.due_date.as_deref(),
        "[]",
    )?;

    if !item.attachments.is_empty() {
        let context = copy_attachments_into_project(
            Path::new(&request.project_path),
            &ticket_id,
            &item.attachments,
        )?;
        let context_json = serde_json::to_string(&context)
            .map_err(|e| format!("Failed to serialize ticket context: {}", e))?;
        tx.execute(
            "UPDATE pm_tickets SET context = ?1 WHERE id = ?2",
            params![context_json, ticket_id],
        )
        .map_err(|e| format!("Failed to write ticket attachments: {}", e))?;
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit project transaction: {}", e))?;

    let project_name = Path::new(&request.project_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| request.project_path.clone());

    conn.execute(
        "UPDATE inbox_items
         SET project_path = ?1, project_name = ?2, ticket_id = ?3,
             assigned_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?4",
        params![
            request.project_path,
            project_name,
            ticket_id,
            request.item_id
        ],
    )
    .map_err(|e| {
        format!(
            "Ticket {} was created in {}, but linking it back to the inbox item failed: {}",
            ticket_id, request.project_path, e
        )
    })?;

    get_impl(conn, &request.item_id)
}

/// Sets a ticket's status in any project's database, from the inbox or the
/// start-screen dashboard. Writes history with source `inbox`.
pub fn set_ticket_status_impl(
    project_path: &str,
    ticket_id: &str,
    status: &str,
) -> Result<(), String> {
    if !VALID_TICKET_STATUSES.contains(&status) {
        return Err(format!("Invalid ticket status: {}", status));
    }
    if !Path::new(project_path).is_dir() {
        return Err(format!("Project folder does not exist: {}", project_path));
    }

    let conn = crate::database::init_db(project_path)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    let tx = rusqlite::Transaction::new_unchecked(&conn, rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to begin project transaction: {}", e))?;

    let current: String = match tx.query_row(
        "SELECT status FROM pm_tickets WHERE id = ?1",
        params![ticket_id],
        |row| row.get(0),
    ) {
        Ok(value) => value,
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            return Err(format!("Ticket not found: {}", ticket_id));
        }
        Err(e) => return Err(format!("Failed to read ticket {}: {}", ticket_id, e)),
    };

    if current == status {
        return Ok(());
    }

    tx.execute(
        "UPDATE pm_tickets
         SET status = ?1, status_updated_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?2",
        params![status, ticket_id],
    )
    .map_err(|e| format!("Failed to update ticket {}: {}", ticket_id, e))?;

    tx.execute(
        "INSERT INTO pm_status_history (id, ticket_id, from_status, to_status, changed_at, source)
         VALUES (hex(randomblob(16)), ?1, ?2, ?3, datetime('now'), 'inbox')",
        params![ticket_id, current, status],
    )
    .map_err(|e| format!("Failed to record ticket status history: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit project transaction: {}", e))?;
    Ok(())
}
