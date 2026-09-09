use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub struct InboxState {
    pub conn: Mutex<Connection>,
    pub attachments_dir: std::path::PathBuf,
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
    pub daily_goal: bool,
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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct InboxItemInput {
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub daily_goal: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct InboxItemPatch {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub priority: Option<String>,
    /// `None` leaves the date alone; `Some("")` clears it; a calendar day sets it.
    pub due_date: Option<String>,
    pub daily_goal: Option<bool>,
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

pub const VALID_PRIORITIES: [&str; 4] = ["low", "normal", "high", "critical"];
pub const VALID_TICKET_STATUSES: [&str; 7] = [
    "open",
    "in_progress",
    "to_test",
    "in_review",
    "done",
    "archived",
    "discarded",
];
pub const INBOX_EPIC_NAME: &str = "Inbox";

pub const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif",
];
pub const VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "mov", "m4v", "ogv"];
pub const TEXT_EXTENSIONS: &[&str] = &["md", "markdown", "txt", "text", "eml", "log"];
pub const DEFAULT_TEXT_EXTENSION: &str = "md";

pub const SELECT_COLUMNS: &str = "id, title, notes, created_at, updated_at, \
     project_path, project_name, ticket_id, assigned_at, dismissed_at, \
     priority, due_date, daily_goal";
