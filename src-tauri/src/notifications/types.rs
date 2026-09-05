use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

/// How many rows the inbox keeps. Only rows that have been dealt with are ever
/// pruned, so this is a ceiling on history, not on the backlog.
pub const NOTIFICATION_CAP: usize = 1000;

pub struct NotificationsState {
    pub conn: Mutex<Connection>,
    /// Holds the inbox file watcher for the process lifetime. Dropping it
    /// would cut off every dispatch that did not come from this app — the
    /// MCP server's writes would sit in the database unseen. Never read: being
    /// owned is the whole job.
    #[allow(dead_code)]
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

/// Where the inbox lives inside the app data directory. Also handed to the
/// MCP server so its `notify` tools write to the same file.
pub fn db_path_in(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join("notifications.db")
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: i64,
    pub uid: String,
    pub created_at: String,
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    pub source: String,
    pub origin: Option<String>,
    pub kind: String,
    pub severity: String,
    pub title: String,
    pub body: Option<String>,
    pub actions: serde_json::Value,
    pub dedupe_key: Option<String>,
    pub ref_kind: Option<String>,
    pub ref_id: Option<String>,
    pub read_at: Option<String>,
    pub answered_at: Option<String>,
    pub answer: Option<String>,
    pub expires_at: Option<String>,
}

/// What a dispatcher supplies. Everything the store owns — id, timestamps,
/// read state — is absent here on purpose.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotificationInput {
    #[serde(default)]
    pub uid: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
    #[serde(default)]
    pub project_name: Option<String>,
    pub source: String,
    #[serde(default)]
    pub origin: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub severity: Option<String>,
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub actions: Option<serde_json::Value>,
    #[serde(default)]
    pub dedupe_key: Option<String>,
    #[serde(default)]
    pub ref_kind: Option<String>,
    #[serde(default)]
    pub ref_id: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
}
