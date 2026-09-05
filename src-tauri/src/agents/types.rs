use portable_pty::Child as PtyChild;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub name: String,
    pub model: String,
    pub task: String,
    pub cwd: Option<String>,
    pub permission_mode: Option<String>,
    pub dangerously_ignore_permissions: Option<bool>,
    pub auto_accept_edits: Option<bool>,
    pub provider: Option<String>,
    pub headless: Option<bool>,
    #[serde(default)]
    pub spawned_by_ticket_id: Option<String>,
    #[serde(default)]
    pub spawned_by_goal_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Running,
    Idle,
    Queued,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub model: String,
    pub provider: String,
    pub status: AgentStatus,
    pub current_task: Option<String>,
    pub started_at: u64,
    pub last_activity_at: Option<u64>,
    pub repo_path: Option<String>,
    pub spawned_by_ticket_id: Option<String>,
    pub spawned_by_goal_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOutputEvent {
    pub agent_id: String,
    pub stream: String,
    pub line: String,
    pub timestamp: u64,
    pub repo_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusEvent {
    pub agent_id: String,
    pub status: AgentStatus,
    pub exit_code: Option<i32>,
    pub repo_path: Option<String>,
}

pub struct AgentProcess {
    pub info: AgentInfo,
    pub child: Box<dyn PtyChild + Send + Sync>,
}

pub struct AgentManager {
    pub agents: HashMap<String, AgentProcess>,
    pub counter: u64,
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentManager {
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
            counter: 0,
        }
    }

    pub fn next_id(&mut self) -> String {
        self.counter += 1;
        format!("agent-{}", self.counter)
    }
}

pub type AgentManagerState = Arc<Mutex<AgentManager>>;

pub fn new_agent_manager_state() -> AgentManagerState {
    Arc::new(Mutex::new(AgentManager::new()))
}
