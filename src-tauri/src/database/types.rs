use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

pub struct DatabaseState {
    pub connections: Mutex<HashMap<String, Connection>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct KvEntry {
    pub namespace: String,
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmEpic {
    pub id: String,
    pub name: String,
    pub description: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmContextItem {
    pub id: String,
    pub r#type: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmTicket {
    pub id: String,
    pub epic_id: String,
    pub name: String,
    pub description: String,
    pub status: String,
    pub status_updated_at: String,
    pub sort_order: i32,
    pub working_directory: Option<String>,
    pub context: Option<Vec<PmContextItem>>,
    pub model_power: Option<String>,
    pub priority: String,
    #[serde(default)]
    pub needs_human_supervision: bool,
    #[serde(default)]
    pub goal_id: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub skills: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmTestCase {
    pub id: String,
    pub ticket_id: String,
    pub title: String,
    pub body: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmDependency {
    pub id: String,
    pub source_type: String,
    pub source_id: String,
    pub target_type: String,
    pub target_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmStatusHistoryEntry {
    pub id: String,
    pub ticket_id: String,
    pub from_status: Option<String>,
    pub to_status: String,
    pub changed_at: String,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmSavePayload {
    pub epics: Vec<PmEpic>,
    pub tickets: Vec<PmTicket>,
    pub test_cases: Vec<PmTestCase>,
    pub dependencies: Vec<PmDependency>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmState {
    pub epics: Vec<PmEpic>,
    pub tickets: Vec<PmTicket>,
    pub test_cases: Vec<PmTestCase>,
    pub dependencies: Vec<PmDependency>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Blueprint {
    pub id: String,
    pub name: String,
    pub tech_stack: String,
    pub goal: String,
    pub complexity: String,
    pub category: String,
    pub description: String,
    pub spec: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintState {
    pub blueprints: Vec<Blueprint>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmRequirement {
    pub id: String,
    pub req_id: String,
    pub title: String,
    pub description: String,
    pub r#type: String,
    pub category: String,
    pub priority: String,
    pub status: String,
    pub rationale: String,
    pub acceptance_criteria: String,
    pub source: String,
    pub applies_to: String,
    pub last_verified_at: Option<String>,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmRequirementTestLink {
    pub id: String,
    pub requirement_id: String,
    pub test_case_id: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RequirementsState {
    pub requirements: Vec<PmRequirement>,
    pub test_links: Vec<PmRequirementTestLink>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmGoal {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub description: String,
    pub success_criteria: String,
    pub status: String,
    pub priority: String,
    pub goal_prompt: String,
    pub created_by: String,
    pub achieved_at: Option<String>,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmGoalRun {
    pub id: String,
    pub goal_id: String,
    pub agent_id: String,
    pub ticket_id: Option<String>,
    pub prompt: String,
    pub model: String,
    pub provider: String,
    pub source: String,
    pub outcome: String,
    pub summary: String,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmGoalRequirementLink {
    pub id: String,
    pub goal_id: String,
    pub requirement_id: String,
    pub created_at: String,
}

/// One step of a goal's line. The stored status is only done|planned|fog:
/// "front" is derived by the layout, never persisted, so no writer (UI, MCP,
/// planner commit) has to maintain an exactly-one-front invariant. The
/// `predicate` crosses IPC as a JSON string (the appliesTo pattern).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PmGoalStation {
    pub id: String,
    pub goal_id: String,
    pub name: String,
    pub kind: String,
    pub status: String,
    pub evidence_kind: String,
    pub predicate: String,
    pub evidence_note: String,
    #[serde(default = "default_station_source_context")]
    pub source_context: String,
    pub ticket_id: Option<String>,
    pub lane: i32,
    pub sort_order: i32,
    pub last_checked_at: Option<String>,
    pub done_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn default_station_source_context() -> String {
    "null".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoalsState {
    pub goals: Vec<PmGoal>,
    pub goal_runs: Vec<PmGoalRun>,
    pub requirement_links: Vec<PmGoalRequirementLink>,
    #[serde(default)]
    pub stations: Vec<PmGoalStation>,
}

/// Row-level sync payload: upserts + explicit deletions. Unlike a replace-all
/// save, rows written concurrently by the MCP server (agent-created goals,
/// runs, links) survive a frontend save untouched.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GoalsSyncPayload {
    pub goals: Vec<PmGoal>,
    pub goal_runs: Vec<PmGoalRun>,
    pub requirement_links: Vec<PmGoalRequirementLink>,
    #[serde(default)]
    pub stations: Vec<PmGoalStation>,
    #[serde(default)]
    pub deleted_goal_ids: Vec<String>,
    #[serde(default)]
    pub deleted_run_ids: Vec<String>,
    #[serde(default)]
    pub deleted_link_ids: Vec<String>,
    #[serde(default)]
    pub deleted_station_ids: Vec<String>,
}

/// How many spawn prompts the per-project history retains; older rows are pruned.
pub const AGENT_PROMPT_HISTORY_CAP: usize = 100;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TicketReview {
    pub ticket_id: String,
    pub pass: bool,
    pub reason: String,
    pub reviewer: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptHistoryEntry {
    pub id: String,
    pub prompt: String,
    pub agent_name: String,
    pub model: String,
    pub provider: String,
    pub cwd: Option<String>,
    pub source: String,
    #[serde(default)]
    pub created_at: String,
}
