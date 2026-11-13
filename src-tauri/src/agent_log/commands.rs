//! The Tauri commands of `agent_log`; `lib.rs` registers them.

use crate::agent_log::{self, AgentLogEvent, AgentLogState};

#[tauri::command]
pub fn agent_log_append(
    events: Vec<AgentLogEvent>,
    state: tauri::State<'_, AgentLogState>,
) -> Result<(), String> {
    state.with_connection(|conn| agent_log::append_impl(conn, &events))
}

#[tauri::command]
pub fn agent_log_load(
    limit: u32,
    state: tauri::State<'_, AgentLogState>,
) -> Result<Vec<AgentLogEvent>, String> {
    state.with_connection(|conn| agent_log::load_impl(conn, limit))
}

#[tauri::command]
pub fn agent_log_prune(
    retention_days: u32,
    max_rows: u32,
    state: tauri::State<'_, AgentLogState>,
) -> Result<u64, String> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    state.with_connection(|conn| agent_log::prune_impl(conn, retention_days, max_rows, now_ms))
}

#[tauri::command]
pub fn agent_log_purge(state: tauri::State<'_, AgentLogState>) -> Result<(), String> {
    state.with_connection(|conn| agent_log::purge_impl(conn))
}
