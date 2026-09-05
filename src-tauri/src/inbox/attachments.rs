use super::items::get_impl;
use super::types::*;
use rusqlite::{params, Connection};
use std::path::Path;

pub(crate) fn attachment_from_row(row: &rusqlite::Row) -> rusqlite::Result<InboxAttachment> {
    Ok(InboxAttachment {
        id: row.get(0)?,
        item_id: row.get(1)?,
        kind: row.get(2)?,
        file_name: row.get(3)?,
        stored_path: row.get(4)?,
        created_at: row.get(5)?,
    })
}

pub(crate) fn load_attachments(
    conn: &Connection,
    item_id: &str,
) -> Result<Vec<InboxAttachment>, String> {
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
    if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        return Some("text");
    }
    None
}

/// The file name a pasted document is stored under.
fn text_file_name(raw: &str) -> String {
    let last = raw
        .replace('\\', "/")
        .split('/')
        .next_back()
        .unwrap_or("")
        .trim()
        .to_string();
    let base = if last.is_empty() || last == "." || last == ".." {
        "note".to_string()
    } else {
        last
    };
    let ext = file_extension(Path::new(&base));
    if TEXT_EXTENSIONS.contains(&ext.as_str()) {
        base
    } else {
        format!("{}.{}", base, DEFAULT_TEXT_EXTENSION)
    }
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

    record_attachment(conn, &item, item_id, kind, &dest, &file_name)
}

/// Stores a block of text — most often a whole email — as an attachment.
pub fn attach_text_impl(
    conn: &Connection,
    attachments_dir: &Path,
    item_id: &str,
    file_name: &str,
    body: &str,
) -> Result<InboxItem, String> {
    let item = get_impl(conn, item_id)?;
    if body.trim().is_empty() {
        return Err("Cannot attach an empty text to an inbox item".to_string());
    }

    let name = text_file_name(file_name);
    let dest_dir = attachments_dir.join(item_id);
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create inbox attachments dir: {}", e))?;
    let dest = unique_dest(&dest_dir, &name);
    std::fs::write(&dest, body).map_err(|e| format!("Failed to write attachment: {}", e))?;

    record_attachment(conn, &item, item_id, "text", &dest, &name)
}

fn record_attachment(
    conn: &Connection,
    item: &InboxItem,
    item_id: &str,
    kind: &str,
    dest: &Path,
    fallback_name: &str,
) -> Result<InboxItem, String> {
    conn.execute(
        "INSERT INTO inbox_attachments (id, item_id, kind, file_name, stored_path)
         VALUES (hex(randomblob(16)), ?1, ?2, ?3, ?4)",
        params![
            item_id,
            kind,
            dest.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| fallback_name.to_string()),
            dest.to_string_lossy().to_string()
        ],
    )
    .map_err(|e| {
        let _ = std::fs::remove_file(dest);
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

pub(crate) fn copy_attachments_into_project(
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

pub(crate) fn write_ticket_attachments(
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
