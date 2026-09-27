use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

/// How many rows the inbox keeps. Only rows that have been dealt with are ever
/// pruned, so this is a ceiling on history, not on the backlog.
pub const NOTIFICATION_CAP: usize = 1000;

pub struct NotificationsState {
    pub conn: Mutex<Connection>,
    /// Holds the inbox watch for the process lifetime. Dropping it
    /// would cut off every dispatch that did not come from this app — the
    /// MCP server's writes would sit in the database unseen. Never read: being
    /// owned is the whole job.
    #[allow(dead_code)]
    pub watcher: Mutex<Option<super::InboxWatch>>,
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

/// What became of one agent launch request (MCP `request_agent_launch`).
/// Keyed by the request's uid; read back by MCP `get_agent_run`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchRunInput {
    pub request_uid: String,
    pub agent_id: String,
    #[serde(default)]
    pub agent_name: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    /// `running`, `interrupted`, `completed`, `failed` or `killed`.
    pub status: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    /// Set by the frontend: it adds the summary it derived from the logs and
    /// never a status. The status is the backend's alone (review r2): an
    /// `idle` the store saw first must not turn a kill into `completed`.
    #[serde(default)]
    pub summary_only: bool,
}

/// Jennifer's standing permission for one mission root, as the UI asks for
/// it. The id is minted by the caller; the row is written only through the
/// IDE's Tauri command, never through MCP.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LaunchGrantInput {
    pub id: String,
    pub project_path: String,
    pub root_goal_id: String,
    #[serde(default)]
    pub root_goal_name: String,
    pub max_concurrent: i64,
    pub launch_budget: i64,
}

/// A grant in force, with what it has paid for so far.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchGrant {
    pub id: String,
    pub project_path: String,
    pub root_goal_id: String,
    pub root_goal_name: String,
    pub max_concurrent: i64,
    pub launch_budget: i64,
    pub granted_at: String,
    pub launches_used: i64,
}

/// One automatic start a launch grant wants to make. Only the ids travel:
/// limits, project and mission root are read from the grant row, the goal
/// from the request row, inside the claim.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchClaimInput {
    pub request_uid: String,
    pub grant_id: String,
}

/// What a claim decided. Only `Claimed` may lead to a spawn.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LaunchClaimOutcome {
    Claimed,
    /// The grant is unknown, revoked, or belongs to another project.
    NoGrant,
    /// The request's goal is not under the grant's mission root in project.db.
    OutsideRoot,
    AlreadyClaimed,
    AtCapacity,
    BudgetSpent,
    NotARequest,
}
