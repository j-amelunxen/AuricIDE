//! The GTD inbox: a fast-capture task box that lives above any one project.
//!
//! Like `notifications.rs`, this deliberately does **not** live in
//! `<project>/.auric/project.db`. The whole point of the inbox is capturing a
//! thought before you have decided which project it belongs to — sometimes
//! before you have even opened a project at all. So it sits in the app data
//! directory as `inbox.db`, and an item only gains a project once it is
//! *assigned*, at which point [`assign_impl`] writes a real ticket into that
//! project's own database.
//!
//! Two databases, one assignment: the project ticket is the durable record of
//! the work, the inbox row is a pointer to it. `assign_impl` writes the
//! project database first and the inbox row second — a ticket that exists but
//! is not yet linked from the inbox is recoverable (the item just still looks
//! unsorted); a link pointing at a ticket that was never created would not be.
//! Cross-database atomicity is not attempted; a failure updating the inbox row
//! after the ticket was created is reported to the caller rather than hidden.
//!
//! `projects_pm_overview_impl` never creates or migrates `project.db` itself —
//! but a *read-only* open of a database in WAL mode still asks SQLite to set
//! up its shared-memory index, which can create `project.db-shm` and
//! `project.db-wal` as a side effect of the read (verified against the
//! bundled SQLite; there is no read-only flag that suppresses it). That is
//! accepted rather than worked around: those files hold no data of their own
//! and `.auric/.gitignore` is `*`, so nothing meant to be durable or tracked
//! ever depends on their absence.

use crate::database::apply_migration;
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

pub struct InboxState {
    pub conn: Mutex<Connection>,
    pub attachments_dir: std::path::PathBuf,
}

/// Where the inbox lives inside the app data directory.
pub fn db_path_in(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join("inbox.db")
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    pub ticket_id: Option<String>,
    pub assigned_at: Option<String>,
    pub dismissed_at: Option<String>,
    pub priority: String,
    pub due_date: Option<String>,
    #[serde(default)]
    pub attachments: Vec<InboxAttachment>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InboxAttachment {
    pub id: String,
    pub item_id: String,
    pub kind: String,
    pub file_name: String,
    pub stored_path: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InboxItemInput {
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct InboxItemPatch {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub priority: Option<String>,
    /// `None` leaves the date alone; `Some("")` clears it; a calendar day sets it.
    pub due_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InboxAssignRequest {
    pub item_id: String,
    pub project_path: String,
    #[serde(default)]
    pub epic_id: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTicketDigest {
    pub id: String,
    pub name: String,
    pub status: String,
    pub priority: String,
    pub epic_id: String,
    pub epic_name: String,
    pub updated_at: String,
    pub due_date: Option<String>,
    pub description: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEpicDigest {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPmOverview {
    pub project_path: String,
    pub project_name: String,
    pub has_db: bool,
    pub open: u32,
    pub in_progress: u32,
    pub in_review: u32,
    pub done: u32,
    pub epics: Vec<ProjectEpicDigest>,
    pub tickets: Vec<ProjectTicketDigest>,
    pub error: Option<String>,
}

const VALID_PRIORITIES: [&str; 4] = ["low", "normal", "high", "critical"];
const INBOX_EPIC_NAME: &str = "Inbox";

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id   INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .map_err(|e| format!("Failed to create _migrations table: {}", e))?;

    apply_migration(
        conn,
        1,
        "create_inbox_items",
        "CREATE TABLE inbox_items (
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL,
            notes        TEXT NOT NULL DEFAULT '',
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
            project_path TEXT,
            project_name TEXT,
            ticket_id    TEXT,
            assigned_at  TEXT,
            dismissed_at TEXT
        );
        CREATE INDEX idx_inbox_items_active ON inbox_items(dismissed_at, created_at DESC);",
    )?;

    apply_migration(
        conn,
        2,
        "add_inbox_item_priority_due_date",
        "ALTER TABLE inbox_items ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
         ALTER TABLE inbox_items ADD COLUMN due_date TEXT;",
    )?;

    apply_migration(
        conn,
        3,
        "create_inbox_attachments",
        "CREATE TABLE inbox_attachments (
            id          TEXT PRIMARY KEY,
            item_id     TEXT NOT NULL,
            kind        TEXT NOT NULL,
            file_name   TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_inbox_attachments_item ON inbox_attachments(item_id);",
    )?;

    Ok(())
}

/// Where copied inbox media lives inside the app data directory.
pub fn attachments_dir_in(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join("inbox-attachments")
}

/// Opens (creating if needed) the inbox database at `path`.
pub fn init_db(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create inbox dir: {}", e))?;
    }

    let conn = Connection::open(path).map_err(|e| format!("Failed to open inbox db: {}", e))?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    run_migrations(&conn)?;

    Ok(conn)
}

const SELECT_COLUMNS: &str = "id, title, notes, created_at, updated_at, \
     project_path, project_name, ticket_id, assigned_at, dismissed_at, \
     priority, due_date";

fn row_to_item(row: &rusqlite::Row) -> rusqlite::Result<InboxItem> {
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
        attachments: Vec::new(),
    })
}

fn attachment_from_row(row: &rusqlite::Row) -> rusqlite::Result<InboxAttachment> {
    Ok(InboxAttachment {
        id: row.get(0)?,
        item_id: row.get(1)?,
        kind: row.get(2)?,
        file_name: row.get(3)?,
        stored_path: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn load_attachments(conn: &Connection, item_id: &str) -> Result<Vec<InboxAttachment>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, item_id, kind, file_name, stored_path, created_at
             FROM inbox_attachments WHERE item_id = ?1
             ORDER BY created_at ASC, rowid ASC",
        )
        .map_err(|e| format!("Failed to prepare inbox attachments query: {}", e))?;
    let rows = stmt
        .query_map(params![item_id], attachment_from_row)
        .map_err(|e| format!("Failed to query inbox attachments: {}", e))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("Failed to read inbox attachments: {}", e))
}

fn hydrate_item(conn: &Connection, mut item: InboxItem) -> Result<InboxItem, String> {
    item.attachments = load_attachments(conn, &item.id)?;
    Ok(item)
}

fn resolve_priority(value: Option<&str>) -> Result<String, String> {
    let priority = value.unwrap_or("normal");
    if !VALID_PRIORITIES.contains(&priority) {
        return Err(format!("Invalid priority: {}", priority));
    }
    Ok(priority.to_string())
}

/// Blank becomes `None`. Anything else must be a real `YYYY-MM-DD` day.
fn parse_due_date(value: Option<&str>) -> Result<Option<String>, String> {
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

fn get_impl(conn: &Connection, id: &str) -> Result<InboxItem, String> {
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

    conn.execute(
        "INSERT INTO inbox_items (id, title, notes, priority, due_date)
         VALUES (hex(randomblob(16)), ?1, ?2, ?3, ?4)",
        params![title, input.notes, priority, due_date],
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

const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif",
];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "mov", "m4v", "ogv"];

fn file_extension(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn media_kind_for(path: &Path) -> Option<&'static str> {
    let ext = file_extension(path);
    if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Some("image");
    }
    if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        return Some("video");
    }
    None
}

fn sanitize_file_name(path: &Path) -> String {
    let raw = path
        .file_name()
        .map(|name| name.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| "attachment".to_string());
    let base = raw.split('/').next_back().unwrap_or("attachment");
    let trimmed = base.trim();
    if trimmed.is_empty() {
        "attachment".to_string()
    } else {
        trimmed.to_string()
    }
}

fn unique_dest(dir: &Path, file_name: &str) -> std::path::PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "attachment".to_string());
    let ext = Path::new(file_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    for n in 2..10_000 {
        let next = if ext.is_empty() {
            dir.join(format!("{}-{}", stem, n))
        } else {
            dir.join(format!("{}-{}.{}", stem, n, ext))
        };
        if !next.exists() {
            return next;
        }
    }
    dir.join(format!("{}-{}", stem, uuid_fallback()))
}

fn uuid_fallback() -> String {
    format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    )
}

/// Copies an image or video next to the inbox database and records it on the item.
pub fn attach_impl(
    conn: &Connection,
    attachments_dir: &Path,
    item_id: &str,
    source_path: &Path,
) -> Result<InboxItem, String> {
    let item = get_impl(conn, item_id)?;
    let kind = media_kind_for(source_path).ok_or_else(|| {
        format!(
            "Only images and videos can be attached to the inbox: {}",
            source_path.display()
        )
    })?;
    if !source_path.is_file() {
        return Err(format!(
            "Attachment is not a file: {}",
            source_path.display()
        ));
    }

    let file_name = sanitize_file_name(source_path);
    let dest_dir = attachments_dir.join(item_id);
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create inbox attachments dir: {}", e))?;
    let dest = unique_dest(&dest_dir, &file_name);
    std::fs::copy(source_path, &dest).map_err(|e| format!("Failed to copy attachment: {}", e))?;

    conn.execute(
        "INSERT INTO inbox_attachments (id, item_id, kind, file_name, stored_path)
         VALUES (hex(randomblob(16)), ?1, ?2, ?3, ?4)",
        params![
            item_id,
            kind,
            dest.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or(file_name),
            dest.to_string_lossy().to_string()
        ],
    )
    .map_err(|e| {
        let _ = std::fs::remove_file(&dest);
        format!("Failed to record inbox attachment: {}", e)
    })?;

    if let (Some(project_path), Some(ticket_id)) = (&item.project_path, &item.ticket_id) {
        let hydrated = get_impl(conn, item_id)?;
        write_ticket_attachments(project_path, ticket_id, &hydrated.attachments)?;
    }

    get_impl(conn, item_id)
}

/// Removes one attachment from the item and deletes the stored file.
pub fn detach_impl(
    conn: &Connection,
    item_id: &str,
    attachment_id: &str,
) -> Result<InboxItem, String> {
    let item = get_impl(conn, item_id)?;
    let Some(attachment) = item
        .attachments
        .iter()
        .find(|candidate| candidate.id == attachment_id)
        .cloned()
    else {
        return Err(format!("Inbox attachment not found: {}", attachment_id));
    };

    conn.execute(
        "DELETE FROM inbox_attachments WHERE id = ?1 AND item_id = ?2",
        params![attachment_id, item_id],
    )
    .map_err(|e| format!("Failed to detach inbox attachment: {}", e))?;

    if !attachment.stored_path.is_empty() {
        let _ = std::fs::remove_file(&attachment.stored_path);
    }

    if let (Some(project_path), Some(ticket_id)) = (&item.project_path, &item.ticket_id) {
        let remaining: Vec<InboxAttachment> = item
            .attachments
            .into_iter()
            .filter(|candidate| candidate.id != attachment_id)
            .collect();
        write_ticket_attachments(project_path, ticket_id, &remaining)?;
    }

    get_impl(conn, item_id)
}

fn ticket_attachment_rel_path(ticket_id: &str, file_name: &str) -> String {
    format!(".auric/inbox-attachments/{}/{}", ticket_id, file_name)
}

fn copy_attachments_into_project(
    project_path: &Path,
    ticket_id: &str,
    attachments: &[InboxAttachment],
) -> Result<Vec<crate::database::PmContextItem>, String> {
    if attachments.is_empty() {
        return Ok(Vec::new());
    }
    let dest_dir = project_path
        .join(".auric")
        .join("inbox-attachments")
        .join(ticket_id);
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create project inbox attachments dir: {}", e))?;

    let mut context = Vec::with_capacity(attachments.len());
    for attachment in attachments {
        let source = Path::new(&attachment.stored_path);
        if !source.is_file() {
            return Err(format!(
                "Inbox attachment is missing on disk: {}",
                attachment.stored_path
            ));
        }
        let dest = dest_dir.join(&attachment.file_name);
        std::fs::copy(source, &dest)
            .map_err(|e| format!("Failed to copy attachment into the project: {}", e))?;
        context.push(crate::database::PmContextItem {
            id: attachment.id.clone(),
            r#type: "file".to_string(),
            value: ticket_attachment_rel_path(ticket_id, &attachment.file_name),
        });
    }
    Ok(context)
}

fn write_ticket_attachments(
    project_path: &str,
    ticket_id: &str,
    attachments: &[InboxAttachment],
) -> Result<(), String> {
    if !Path::new(project_path).is_dir() {
        return Err(format!("Project folder does not exist: {}", project_path));
    }
    let copied = copy_attachments_into_project(Path::new(project_path), ticket_id, attachments)?;

    let conn = crate::database::init_db(project_path)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    let existing_json: String = conn
        .query_row(
            "SELECT context FROM pm_tickets WHERE id = ?1",
            params![ticket_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to read ticket {}: {}", ticket_id, e))?;
    let existing: Vec<crate::database::PmContextItem> =
        serde_json::from_str(&existing_json).unwrap_or_default();
    let prefix = format!(".auric/inbox-attachments/{}/", ticket_id);
    let mut next: Vec<crate::database::PmContextItem> = existing
        .into_iter()
        .filter(|item| !(item.r#type == "file" && item.value.starts_with(&prefix)))
        .collect();
    next.extend(copied);

    let context_json = serde_json::to_string(&next)
        .map_err(|e| format!("Failed to serialize ticket context: {}", e))?;
    conn.execute(
        "UPDATE pm_tickets SET context = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![context_json, ticket_id],
    )
    .map_err(|e| format!("Failed to write ticket attachments: {}", e))?;
    Ok(())
}

/// Finds the epic named "Inbox" (case-sensitive, SQLite's default `=`
/// comparison) or creates it at the end of the epic list.
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

/// Inserts a ticket plus its creation status-history row, mirroring
/// `src/mcp/tools/tickets.ts`'s `createTicket` exactly (columns, sort order,
/// history source) except for the history `source`, which is `'inbox'` here
/// so the origin of the ticket stays visible in its own history.
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
/// inbox row to it. The project write happens before the inbox write — see
/// the module doc comment for why.
pub fn assign_impl(conn: &Connection, request: &InboxAssignRequest) -> Result<InboxItem, String> {
    let item = get_impl(conn, &request.item_id)?;
    if item.project_path.is_some() {
        return Err("Item is already assigned".to_string());
    }

    // An explicit assign-time priority still wins; otherwise the value stored
    // on the inbox item is what the ticket inherits.
    let priority = resolve_priority(request.priority.as_deref().or(Some(item.priority.as_str())))?;

    // `database::init_db` -> `ensure_auric_dir` calls `create_dir_all`, which
    // recreates a folder that was deleted or lives on an unmounted volume
    // rather than reporting it missing. Check before that happens: assigning
    // work to a project the user removed must fail, not resurrect the folder.
    if !Path::new(&request.project_path).is_dir() {
        return Err(format!(
            "Project folder does not exist: {}",
            request.project_path
        ));
    }

    // Creating `.auric/` here is intentional: assigning work to a project is
    // using it, unlike the read-only overview below.
    let project_conn = crate::database::init_db(&request.project_path)?;

    // The default busy timeout is 0: a collision with `pm_save` or the MCP
    // server writing the same project db would otherwise fail this assign
    // immediately with "database is locked" instead of simply waiting its
    // turn.
    project_conn
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set busy timeout: {}", e))?;

    // The epic lookup/creation, the ticket insert and its status-history row
    // are one unit: a failure partway through (e.g. the history insert)
    // rolling back an epic or ticket that was already written would leave
    // orphaned PM rows with nothing pointing at them. `tx` rolls back on drop
    // whenever a `?` or `return` below leaves it uncommitted.
    //
    // BEGIN IMMEDIATE, not the default deferred BEGIN: this transaction reads
    // before it writes (the epic lookup runs first), and SQLite's busy
    // handler is not invoked when a *deferred* transaction tries to upgrade
    // an already-taken read lock to a write lock — it returns "database is
    // locked" immediately regardless of `busy_timeout`, because retrying
    // could hand back writes made after the read already happened. Taking
    // the write lock up front, before any read, is what makes the busy
    // timeout above actually apply.
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

type StatusCounts = (u32, u32, u32, u32);

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

    // Short and best-effort: an overview is a glance, not work the caller is
    // blocked on. Without this, a writer mid-transaction (pm_save, the MCP
    // server) would flip this one project to `error` for the instant it holds
    // the lock, instead of the read simply waiting it out.
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        run_migrations(&conn).expect("migrations");
        conn
    }

    fn input(title: &str) -> InboxItemInput {
        InboxItemInput {
            title: title.to_string(),
            notes: String::new(),
            priority: None,
            due_date: None,
        }
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = test_db();
        let before: i64 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))
            .unwrap();
        run_migrations(&conn).expect("second run");
        let after: i64 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn add_trims_the_title() {
        let conn = test_db();
        let item = add_impl(&conn, &input("  Buy milk  ")).expect("add");
        assert_eq!(item.title, "Buy milk");
        assert_eq!(item.notes, "");
        assert_eq!(item.priority, "normal");
        assert_eq!(item.due_date, None);
        assert!(item.project_path.is_none());
        assert!(item.dismissed_at.is_none());
    }

    #[test]
    fn add_rejects_a_blank_title() {
        let conn = test_db();
        let err = add_impl(&conn, &input("   ")).unwrap_err();
        assert!(err.contains("empty"));
    }

    #[test]
    fn list_returns_newest_first() {
        let conn = test_db();
        add_impl(&conn, &input("first")).unwrap();
        let second = add_impl(&conn, &input("second")).unwrap();
        let items = list_impl(&conn).unwrap();
        assert_eq!(items[0].id, second.id);
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn list_excludes_dismissed_items() {
        let conn = test_db();
        let item = add_impl(&conn, &input("gone")).unwrap();
        add_impl(&conn, &input("stays")).unwrap();
        dismiss_impl(&conn, &item.id).unwrap();

        let items = list_impl(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "stays");
    }

    #[test]
    fn update_changes_title_and_notes() {
        let conn = test_db();
        let item = add_impl(&conn, &input("draft")).unwrap();

        let updated = update_impl(
            &conn,
            &item.id,
            &InboxItemPatch {
                title: Some(" final ".to_string()),
                notes: Some("more context".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(updated.title, "final");
        assert_eq!(updated.notes, "more context");
    }

    #[test]
    fn update_rejects_a_blank_title() {
        let conn = test_db();
        let item = add_impl(&conn, &input("draft")).unwrap();
        let err = update_impl(
            &conn,
            &item.id,
            &InboxItemPatch {
                title: Some("   ".to_string()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(err.contains("empty"));
    }

    #[test]
    fn update_leaves_untouched_fields_alone() {
        let conn = test_db();
        let item = add_impl(&conn, &input("draft")).unwrap();
        let updated = update_impl(
            &conn,
            &item.id,
            &InboxItemPatch {
                notes: Some("only notes".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(updated.title, "draft");
        assert_eq!(updated.notes, "only notes");
    }

    #[test]
    fn dismiss_hides_the_item_but_leaves_it_in_the_table() {
        let conn = test_db();
        let item = add_impl(&conn, &input("done thinking about it")).unwrap();
        dismiss_impl(&conn, &item.id).unwrap();

        assert!(list_impl(&conn).unwrap().is_empty());
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM inbox_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    /// Sets up a real project directory with a fully migrated `.auric/project.db`,
    /// the way `assign_impl` itself creates one.
    fn seeded_project() -> TempDir {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_string_lossy().to_string();
        crate::database::init_db(&path).expect("seed project db");
        dir
    }

    fn open_project_db(dir: &TempDir) -> Connection {
        Connection::open(dir.path().join(".auric").join("project.db")).unwrap()
    }

    #[test]
    fn add_stores_priority_and_due_date() {
        let conn = test_db();
        let item = add_impl(
            &conn,
            &InboxItemInput {
                title: "Ship it".to_string(),
                notes: String::new(),
                priority: Some("high".to_string()),
                due_date: Some("2026-08-20".to_string()),
            },
        )
        .unwrap();
        assert_eq!(item.priority, "high");
        assert_eq!(item.due_date.as_deref(), Some("2026-08-20"));
    }

    #[test]
    fn add_rejects_an_invalid_priority() {
        let conn = test_db();
        let err = add_impl(
            &conn,
            &InboxItemInput {
                title: "Ship it".to_string(),
                notes: String::new(),
                priority: Some("urgent".to_string()),
                due_date: None,
            },
        )
        .unwrap_err();
        assert!(err.contains("Invalid priority"));
    }

    #[test]
    fn add_rejects_an_invalid_due_date() {
        let conn = test_db();
        let err = add_impl(
            &conn,
            &InboxItemInput {
                title: "Ship it".to_string(),
                notes: String::new(),
                priority: None,
                due_date: Some("20.08.2026".to_string()),
            },
        )
        .unwrap_err();
        assert!(err.contains("Invalid due date"));
    }

    #[test]
    fn update_changes_priority_and_due_date() {
        let conn = test_db();
        let item = add_impl(&conn, &input("draft")).unwrap();

        let updated = update_impl(
            &conn,
            &item.id,
            &InboxItemPatch {
                priority: Some("critical".to_string()),
                due_date: Some("2026-09-01".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(updated.priority, "critical");
        assert_eq!(updated.due_date.as_deref(), Some("2026-09-01"));
    }

    #[test]
    fn update_clears_a_due_date_with_a_blank_value() {
        let conn = test_db();
        let item = add_impl(
            &conn,
            &InboxItemInput {
                title: "dated".to_string(),
                notes: String::new(),
                priority: None,
                due_date: Some("2026-08-20".to_string()),
            },
        )
        .unwrap();

        let updated = update_impl(
            &conn,
            &item.id,
            &InboxItemPatch {
                due_date: Some(String::new()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(updated.due_date, None);
    }

    #[test]
    fn update_of_an_assigned_item_writes_through_to_the_ticket() {
        let inbox_conn = test_db();
        let project = seeded_project();
        let item = add_impl(
            &inbox_conn,
            &InboxItemInput {
                title: "Captured".to_string(),
                notes: "inbox notes".to_string(),
                priority: Some("normal".to_string()),
                due_date: None,
            },
        )
        .unwrap();
        let assigned = assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: item.id,
                project_path: project.path().to_string_lossy().to_string(),
                epic_id: None,
                priority: None,
            },
        )
        .unwrap();

        update_impl(
            &inbox_conn,
            &assigned.id,
            &InboxItemPatch {
                title: Some("Renamed".to_string()),
                notes: Some("ticket notes".to_string()),
                priority: Some("high".to_string()),
                due_date: Some("2026-09-01".to_string()),
            },
        )
        .unwrap();

        let ticket_id = assigned.ticket_id.unwrap();
        let project_conn = open_project_db(&project);
        let (name, description, priority, due_date): (String, String, String, Option<String>) =
            project_conn
                .query_row(
                    "SELECT name, description, priority, due_date FROM pm_tickets WHERE id = ?1",
                    params![ticket_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .expect("ticket exists");
        assert_eq!(name, "Renamed");
        assert_eq!(description, "ticket notes");
        assert_eq!(priority, "high");
        assert_eq!(due_date.as_deref(), Some("2026-09-01"));
    }

    #[test]
    fn update_of_an_assigned_item_skips_the_ticket_write_when_fields_already_match() {
        let inbox_conn = test_db();
        let project = seeded_project();
        let item = add_impl(&inbox_conn, &input("Same title")).unwrap();
        let assigned = assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: item.id,
                project_path: project.path().to_string_lossy().to_string(),
                epic_id: None,
                priority: None,
            },
        )
        .unwrap();

        let ticket_id = assigned.ticket_id.clone().unwrap();
        let project_conn = open_project_db(&project);
        let before: String = project_conn
            .query_row(
                "SELECT updated_at FROM pm_tickets WHERE id = ?1",
                params![ticket_id],
                |r| r.get(0),
            )
            .unwrap();
        drop(project_conn);

        update_impl(
            &inbox_conn,
            &assigned.id,
            &InboxItemPatch {
                title: Some("Same title".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let project_conn = open_project_db(&project);
        let after: String = project_conn
            .query_row(
                "SELECT updated_at FROM pm_tickets WHERE id = ?1",
                params![ticket_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn assign_creates_the_inbox_epic_the_ticket_and_a_status_history_row() {
        let inbox_conn = test_db();
        let project = seeded_project();
        let item = add_impl(&inbox_conn, &input("Write the changelog")).unwrap();

        let assigned = assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: item.id.clone(),
                project_path: project.path().to_string_lossy().to_string(),
                epic_id: None,
                priority: None,
            },
        )
        .unwrap();

        assert_eq!(
            assigned.project_path.as_deref(),
            Some(project.path().to_string_lossy().as_ref())
        );
        assert!(assigned.ticket_id.is_some());
        assert!(assigned.assigned_at.is_some());

        let project_conn = open_project_db(&project);
        let epic_name: String = project_conn
            .query_row("SELECT name FROM pm_epics WHERE name = 'Inbox'", [], |r| {
                r.get(0)
            })
            .expect("Inbox epic exists");
        assert_eq!(epic_name, "Inbox");

        let ticket_id = assigned.ticket_id.clone().unwrap();
        let (name, description, status, priority, due_date): (
            String,
            String,
            String,
            String,
            Option<String>,
        ) = project_conn
            .query_row(
                "SELECT name, description, status, priority, due_date FROM pm_tickets WHERE id = ?1",
                params![ticket_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .expect("ticket exists");
        assert_eq!(name, "Write the changelog");
        assert_eq!(description, "");
        assert_eq!(status, "open");
        assert_eq!(priority, "normal");
        assert_eq!(due_date, None);

        let (from_status, to_status, source): (Option<String>, String, String) = project_conn
            .query_row(
                "SELECT from_status, to_status, source FROM pm_status_history WHERE ticket_id = ?1",
                params![ticket_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("status history row exists");
        assert_eq!(from_status, None);
        assert_eq!(to_status, "open");
        assert_eq!(source, "inbox");
    }

    #[test]
    fn assign_reuses_the_inbox_epic_on_a_second_assignment() {
        let inbox_conn = test_db();
        let project = seeded_project();
        let first = add_impl(&inbox_conn, &input("first task")).unwrap();
        let second = add_impl(&inbox_conn, &input("second task")).unwrap();
        let project_path = project.path().to_string_lossy().to_string();

        assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: first.id,
                project_path: project_path.clone(),
                epic_id: None,
                priority: None,
            },
        )
        .unwrap();
        assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: second.id,
                project_path,
                epic_id: None,
                priority: None,
            },
        )
        .unwrap();

        let project_conn = open_project_db(&project);
        let epic_count: i64 = project_conn
            .query_row(
                "SELECT COUNT(*) FROM pm_epics WHERE name = 'Inbox'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(epic_count, 1);
    }

    #[test]
    fn assign_uses_the_given_epic_when_one_is_provided() {
        let inbox_conn = test_db();
        let project = seeded_project();
        let project_conn = open_project_db(&project);
        project_conn
            .execute(
                "INSERT INTO pm_epics (id, name, sort_order) VALUES ('epic-1', 'Backend', 1)",
                [],
            )
            .unwrap();
        drop(project_conn);

        let item = add_impl(&inbox_conn, &input("task")).unwrap();
        assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: item.id,
                project_path: project.path().to_string_lossy().to_string(),
                epic_id: Some("epic-1".to_string()),
                priority: Some("high".to_string()),
            },
        )
        .unwrap();

        let project_conn = open_project_db(&project);
        let (epic_id, priority): (String, String) = project_conn
            .query_row("SELECT epic_id, priority FROM pm_tickets", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(epic_id, "epic-1");
        assert_eq!(priority, "high");
    }

    #[test]
    fn assign_transfers_the_item_priority_and_due_date_onto_the_ticket() {
        let inbox_conn = test_db();
        let project = seeded_project();
        let item = add_impl(
            &inbox_conn,
            &InboxItemInput {
                title: "Pay the invoice".to_string(),
                notes: "Ask accounting first".to_string(),
                priority: Some("critical".to_string()),
                due_date: Some("2026-08-22".to_string()),
            },
        )
        .unwrap();

        let assigned = assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: item.id,
                project_path: project.path().to_string_lossy().to_string(),
                epic_id: None,
                priority: None,
            },
        )
        .unwrap();

        let project_conn = open_project_db(&project);
        let (priority, due_date, description): (String, Option<String>, String) = project_conn
            .query_row(
                "SELECT priority, due_date, description FROM pm_tickets WHERE id = ?1",
                params![assigned.ticket_id.unwrap()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(priority, "critical");
        assert_eq!(due_date.as_deref(), Some("2026-08-22"));
        assert_eq!(description, "Ask accounting first");
    }

    #[test]
    fn assign_errors_when_the_given_epic_does_not_exist() {
        let inbox_conn = test_db();
        let project = seeded_project();
        let item = add_impl(&inbox_conn, &input("task")).unwrap();

        let err = assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: item.id,
                project_path: project.path().to_string_lossy().to_string(),
                epic_id: Some("does-not-exist".to_string()),
                priority: None,
            },
        )
        .unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn assign_twice_errors() {
        let inbox_conn = test_db();
        let project = seeded_project();
        let item = add_impl(&inbox_conn, &input("task")).unwrap();
        let request = InboxAssignRequest {
            item_id: item.id,
            project_path: project.path().to_string_lossy().to_string(),
            epic_id: None,
            priority: None,
        };

        assign_impl(&inbox_conn, &request).unwrap();
        let err = assign_impl(&inbox_conn, &request).unwrap_err();
        assert!(err.contains("already assigned"));
    }

    #[test]
    fn assign_leaves_no_partial_writes_when_the_project_transaction_fails() {
        let inbox_conn = test_db();
        let project = seeded_project();
        // Break the project db partway through what assign_impl writes: the
        // epic and ticket inserts can still succeed, but the status-history
        // insert that follows them cannot.
        let project_conn = open_project_db(&project);
        project_conn
            .execute_batch("DROP TABLE pm_status_history;")
            .unwrap();
        drop(project_conn);

        let item = add_impl(&inbox_conn, &input("task")).unwrap();
        let project_path = project.path().to_string_lossy().to_string();

        let err = assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: item.id.clone(),
                project_path,
                epic_id: None,
                priority: None,
            },
        )
        .unwrap_err();
        assert!(err.contains("status history"));

        // Neither the epic nor the ticket the transaction started writing
        // should have survived the rollback.
        let project_conn = open_project_db(&project);
        let epic_count: i64 = project_conn
            .query_row("SELECT COUNT(*) FROM pm_epics", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            epic_count, 0,
            "the Inbox epic insert should have rolled back"
        );
        let ticket_count: i64 = project_conn
            .query_row("SELECT COUNT(*) FROM pm_tickets", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ticket_count, 0, "the ticket insert should have rolled back");

        // And the inbox item must still read as unassigned.
        let unchanged = get_impl(&inbox_conn, &item.id).unwrap();
        assert!(unchanged.project_path.is_none());
        assert!(unchanged.ticket_id.is_none());
    }

    #[test]
    fn assign_rejects_an_unknown_priority() {
        let inbox_conn = test_db();
        let project = seeded_project();
        let item = add_impl(&inbox_conn, &input("task")).unwrap();

        let err = assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: item.id,
                project_path: project.path().to_string_lossy().to_string(),
                epic_id: None,
                priority: Some("urgent".to_string()),
            },
        )
        .unwrap_err();
        assert!(err.contains("Invalid priority"));
    }

    #[test]
    fn unassign_clears_the_link_but_leaves_the_ticket_in_the_project() {
        let inbox_conn = test_db();
        let project = seeded_project();
        let item = add_impl(&inbox_conn, &input("task")).unwrap();
        let assigned = assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: item.id.clone(),
                project_path: project.path().to_string_lossy().to_string(),
                epic_id: None,
                priority: None,
            },
        )
        .unwrap();
        let ticket_id = assigned.ticket_id.unwrap();

        let unassigned = unassign_impl(&inbox_conn, &item.id).unwrap();
        assert!(unassigned.project_path.is_none());
        assert!(unassigned.ticket_id.is_none());
        assert!(unassigned.assigned_at.is_none());

        let project_conn = open_project_db(&project);
        let still_there: i64 = project_conn
            .query_row(
                "SELECT COUNT(*) FROM pm_tickets WHERE id = ?1",
                params![ticket_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(still_there, 1);
    }

    #[test]
    fn overview_reports_has_db_false_for_a_project_without_one() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_string_lossy().to_string();

        let overview = projects_pm_overview_impl(&[path.clone()]);
        assert_eq!(overview.len(), 1);
        assert!(!overview[0].has_db);
        assert!(overview[0].error.is_none());
        assert_eq!(overview[0].open, 0);
    }

    #[test]
    fn overview_never_creates_a_project_database() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_string_lossy().to_string();

        projects_pm_overview_impl(&[path]);

        assert!(!dir.path().join(".auric").exists());
    }

    #[test]
    fn overview_counts_tickets_by_status_excluding_archived() {
        let project = seeded_project();
        let conn = open_project_db(&project);
        conn.execute("INSERT INTO pm_epics (id, name) VALUES ('e1', 'Epic')", [])
            .unwrap();
        for (id, status) in [
            ("t1", "open"),
            ("t2", "open"),
            ("t3", "in_progress"),
            ("t4", "in_review"),
            ("t5", "done"),
            ("t6", "archived"),
            ("t7", "discarded"),
            ("t8", "to_test"),
        ] {
            conn.execute(
                "INSERT INTO pm_tickets (id, epic_id, name, status) VALUES (?1, 'e1', ?1, ?2)",
                params![id, status],
            )
            .unwrap();
        }
        drop(conn);

        let overview = projects_pm_overview_impl(&[project.path().to_string_lossy().to_string()]);
        assert!(overview[0].has_db);
        assert!(overview[0].error.is_none());
        assert_eq!(overview[0].open, 2);
        assert_eq!(overview[0].in_progress, 1);
        assert_eq!(overview[0].in_review, 1);
        assert_eq!(overview[0].done, 1);
    }

    #[test]
    fn overview_lists_non_done_tickets_newest_updated_first() {
        let project = seeded_project();
        let conn = open_project_db(&project);
        conn.execute("INSERT INTO pm_epics (id, name) VALUES ('e1', 'Epic')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO pm_tickets (id, epic_id, name, status, updated_at) \
             VALUES ('t1', 'e1', 'Older', 'open', '2026-01-01 00:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO pm_tickets (id, epic_id, name, status, updated_at) \
             VALUES ('t2', 'e1', 'Newer', 'in_progress', '2026-01-02 00:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO pm_tickets (id, epic_id, name, status, updated_at) \
             VALUES ('t3', 'e1', 'Finished', 'done', '2026-01-03 00:00:00')",
            [],
        )
        .unwrap();
        drop(conn);

        let overview = projects_pm_overview_impl(&[project.path().to_string_lossy().to_string()]);
        let tickets = &overview[0].tickets;
        assert_eq!(tickets.len(), 2);
        assert_eq!(tickets[0].name, "Newer");
        assert_eq!(tickets[1].name, "Older");
        assert_eq!(tickets[0].epic_name, "Epic");
    }

    #[test]
    fn overview_opens_the_project_database_read_only() {
        let project = seeded_project();
        let db_path = project.path().join(".auric").join("project.db");
        let before = std::fs::metadata(&db_path).unwrap().modified().unwrap();

        projects_pm_overview_impl(&[project.path().to_string_lossy().to_string()]);

        let after = std::fs::metadata(&db_path).unwrap().modified().unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn overview_reports_an_error_instead_of_crashing_on_an_old_schema() {
        let dir = TempDir::new().unwrap();
        let auric_dir = dir.path().join(".auric");
        std::fs::create_dir_all(&auric_dir).unwrap();
        let db_path = auric_dir.join("project.db");

        // A schema from before migration 5 (`add_ticket_priority`): pm_tickets
        // has no `priority` column yet.
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE pm_epics (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE pm_tickets (
                 id TEXT PRIMARY KEY,
                 epic_id TEXT NOT NULL,
                 name TEXT NOT NULL,
                 status TEXT NOT NULL DEFAULT 'open',
                 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             );",
        )
        .unwrap();
        drop(conn);

        let overview = projects_pm_overview_impl(&[dir.path().to_string_lossy().to_string()]);
        assert!(overview[0].has_db);
        assert!(overview[0].error.is_some());
        assert_eq!(overview[0].open, 0);
        assert!(overview[0].tickets.is_empty());
    }

    #[test]
    fn overview_never_applies_migrations_through_its_read_only_open() {
        let project = seeded_project();
        let db_path = project.path().join(".auric").join("project.db");
        let migrations_before: i64 = {
            let conn = Connection::open(&db_path).unwrap();
            conn.query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))
                .unwrap()
        };

        projects_pm_overview_impl(&[project.path().to_string_lossy().to_string()]);

        let migrations_after: i64 = {
            let conn = Connection::open(&db_path).unwrap();
            conn.query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(
            migrations_before, migrations_after,
            "a read-only overview must never trigger a migration run"
        );
    }

    /// Documents the actual, verified behaviour rather than the aspiration:
    /// `project.db` itself is never created or written (checked above and by
    /// `overview_opens_the_project_database_read_only`'s unchanged mtime),
    /// but SQLite's read-only open of a WAL database still sets up its
    /// shared-memory index, which does create the `-wal`/`-shm` side files.
    /// See the module doc comment for why that is accepted.
    #[test]
    fn overview_read_only_open_may_create_wal_side_files() {
        let project = seeded_project();
        let auric_dir = project.path().join(".auric");
        let wal_path = auric_dir.join("project.db-wal");
        let shm_path = auric_dir.join("project.db-shm");
        // Migrations themselves are writes, so seeding may already have left
        // these behind; start from a clean slate to observe only what the
        // read-only overview does.
        let _ = std::fs::remove_file(&wal_path);
        let _ = std::fs::remove_file(&shm_path);

        projects_pm_overview_impl(&[project.path().to_string_lossy().to_string()]);

        assert!(
            wal_path.exists() && shm_path.exists(),
            "a read-only WAL open is expected to create its side files; \
             if this starts failing, SQLite's behaviour has changed and the \
             module doc comment should be revisited"
        );
    }

    #[test]
    fn assign_errors_when_the_project_folder_does_not_exist() {
        let inbox_conn = test_db();
        let root = TempDir::new().unwrap();
        let missing_path = root.path().join("no-such-project");
        let item = add_impl(&inbox_conn, &input("task")).unwrap();

        let err = assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: item.id.clone(),
                project_path: missing_path.to_string_lossy().to_string(),
                epic_id: None,
                priority: None,
            },
        )
        .unwrap_err();
        assert!(err.contains("does not exist"));

        // Nothing should have been resurrected on disk, and the item stays
        // unassigned.
        assert!(!missing_path.exists());
        let unchanged = get_impl(&inbox_conn, &item.id).unwrap();
        assert!(unchanged.project_path.is_none());
    }

    #[test]
    fn assign_waits_out_a_brief_lock_instead_of_failing_immediately() {
        use std::thread;
        use std::time::Duration;

        let inbox_conn = test_db();
        let project = seeded_project();
        let db_path = project.path().join(".auric").join("project.db");
        let item = add_impl(&inbox_conn, &input("task")).unwrap();

        // Hold a write lock on the project db, the way a concurrent pm_save
        // or the MCP server would, then release it shortly after.
        let locker = Connection::open(&db_path).unwrap();
        locker.execute_batch("BEGIN IMMEDIATE;").unwrap();
        let release = thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            locker.execute_batch("COMMIT;").unwrap();
        });

        let result = assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: item.id,
                project_path: project.path().to_string_lossy().to_string(),
                epic_id: None,
                priority: None,
            },
        );

        release.join().unwrap();
        assert!(
            result.is_ok(),
            "assign should wait out a brief lock rather than fail immediately: {:?}",
            result.err()
        );
    }

    #[test]
    fn overview_preserves_input_order_across_multiple_projects() {
        let a = TempDir::new().unwrap();
        let b = seeded_project();
        let paths = vec![
            a.path().to_string_lossy().to_string(),
            b.path().to_string_lossy().to_string(),
        ];

        let overview = projects_pm_overview_impl(&paths);
        assert_eq!(overview[0].project_path, paths[0]);
        assert_eq!(overview[1].project_path, paths[1]);
        assert!(!overview[0].has_db);
        assert!(overview[1].has_db);
    }

    fn write_media(dir: &Path, name: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, b"not-a-real-media-file").unwrap();
        path
    }

    #[test]
    fn attach_copies_an_image_and_lists_it_on_the_item() {
        let conn = test_db();
        let item = add_impl(&conn, &input("Screenshot the bug")).unwrap();
        let root = TempDir::new().unwrap();
        let source = write_media(root.path(), "shot.png");
        let attachments_dir = root.path().join("store");

        let updated = attach_impl(&conn, &attachments_dir, &item.id, &source).unwrap();

        assert_eq!(updated.attachments.len(), 1);
        assert_eq!(updated.attachments[0].kind, "image");
        assert_eq!(updated.attachments[0].file_name, "shot.png");
        assert!(Path::new(&updated.attachments[0].stored_path).exists());
        assert_eq!(
            list_impl(&conn).unwrap()[0].attachments.len(),
            1,
            "list must hydrate attachments too"
        );
    }

    #[test]
    fn attach_copies_a_video() {
        let conn = test_db();
        let item = add_impl(&conn, &input("Walkthrough")).unwrap();
        let root = TempDir::new().unwrap();
        let source = write_media(root.path(), "clip.mp4");

        let updated = attach_impl(&conn, &root.path().join("store"), &item.id, &source).unwrap();

        assert_eq!(updated.attachments[0].kind, "video");
        assert_eq!(updated.attachments[0].file_name, "clip.mp4");
    }

    #[test]
    fn attach_rejects_a_non_media_file() {
        let conn = test_db();
        let item = add_impl(&conn, &input("Notes")).unwrap();
        let root = TempDir::new().unwrap();
        let source = write_media(root.path(), "notes.md");

        let err = attach_impl(&conn, &root.path().join("store"), &item.id, &source).unwrap_err();
        assert!(
            err.contains("image") || err.contains("video") || err.contains("media"),
            "unexpected error: {err}"
        );
        assert!(list_impl(&conn).unwrap()[0].attachments.is_empty());
    }

    #[test]
    fn detach_removes_the_file_and_the_row() {
        let conn = test_db();
        let item = add_impl(&conn, &input("bug")).unwrap();
        let root = TempDir::new().unwrap();
        let source = write_media(root.path(), "shot.png");
        let attachments_dir = root.path().join("store");
        let attached = attach_impl(&conn, &attachments_dir, &item.id, &source).unwrap();
        let stored = attached.attachments[0].stored_path.clone();
        let attachment_id = attached.attachments[0].id.clone();

        let updated = detach_impl(&conn, &item.id, &attachment_id).unwrap();

        assert!(updated.attachments.is_empty());
        assert!(!Path::new(&stored).exists());
    }

    #[test]
    fn assign_copies_attachments_into_the_project_and_onto_ticket_context() {
        let inbox_conn = test_db();
        let project = seeded_project();
        let root = TempDir::new().unwrap();
        let item = add_impl(&inbox_conn, &input("Bug with footage")).unwrap();
        attach_impl(
            &inbox_conn,
            &root.path().join("store"),
            &item.id,
            &write_media(root.path(), "shot.png"),
        )
        .unwrap();
        attach_impl(
            &inbox_conn,
            &root.path().join("store"),
            &item.id,
            &write_media(root.path(), "clip.mp4"),
        )
        .unwrap();

        let assigned = assign_impl(
            &inbox_conn,
            &InboxAssignRequest {
                item_id: item.id,
                project_path: project.path().to_string_lossy().to_string(),
                epic_id: None,
                priority: None,
            },
        )
        .unwrap();

        let ticket_id = assigned.ticket_id.clone().unwrap();
        let image_dest = project
            .path()
            .join(".auric")
            .join("inbox-attachments")
            .join(&ticket_id)
            .join("shot.png");
        let video_dest = project
            .path()
            .join(".auric")
            .join("inbox-attachments")
            .join(&ticket_id)
            .join("clip.mp4");
        assert!(
            image_dest.exists(),
            "image should be copied into the project"
        );
        assert!(
            video_dest.exists(),
            "video should be copied into the project"
        );

        let project_conn = open_project_db(&project);
        let context_json: String = project_conn
            .query_row(
                "SELECT context FROM pm_tickets WHERE id = ?1",
                params![ticket_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            context_json.contains(".auric/inbox-attachments/")
                && context_json.contains("shot.png")
                && context_json.contains("clip.mp4"),
            "ticket context should list both transferred files, got {context_json}"
        );
        assert!(
            context_json.contains("\"type\":\"file\"")
                || context_json.contains("\"type\": \"file\""),
            "transferred media must be file context items: {context_json}"
        );
    }
}
