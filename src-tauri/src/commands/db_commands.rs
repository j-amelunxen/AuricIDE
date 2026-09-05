use crate::database::{
    self, AgentPromptHistoryEntry, BlueprintState, DatabaseState, GoalsState, GoalsSyncPayload,
    KvEntry, PmSavePayload, PmState, PmStatusHistoryEntry, RequirementsState, TicketReview,
};
use crate::inbox::{self, ProjectPmOverview};
use std::fs;

#[tauri::command]
pub fn init_project_db(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let mut connections = state.connections.lock().unwrap();
    if connections.contains_key(&project_path) {
        return Ok(());
    }
    let conn = database::init_db(&project_path)?;
    connections.insert(project_path, conn);
    Ok(())
}

#[tauri::command]
pub fn db_get(
    project_path: String,
    namespace: String,
    key: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<Option<String>, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::kv_get(conn, &namespace, &key)
}

#[tauri::command]
pub fn db_set(
    project_path: String,
    namespace: String,
    key: String,
    value: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::kv_set(conn, &namespace, &key, &value)
}

#[tauri::command]
pub fn db_delete(
    project_path: String,
    namespace: String,
    key: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<bool, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::kv_delete(conn, &namespace, &key)
}

#[tauri::command]
pub fn db_list(
    project_path: String,
    namespace: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<Vec<KvEntry>, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::kv_list(conn, &namespace)
}

#[tauri::command]
pub fn close_project_db(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let mut connections = state.connections.lock().unwrap();
    connections.remove(&project_path);
    Ok(())
}

#[tauri::command]
pub fn db_export(
    project_path: String,
    destination_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    {
        let connections = state.connections.lock().unwrap();
        if let Some(conn) = connections.get(&project_path) {
            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .map_err(|e| format!("Failed to checkpoint database: {}", e))?;
        }
    }

    let auric_dir = database::ensure_auric_dir(&project_path)?;
    let db_path = auric_dir.join("project.db");

    if !db_path.exists() {
        return Err("Database file not found".to_string());
    }

    fs::copy(db_path, destination_path)
        .map(|_| ())
        .map_err(|e| format!("Failed to export database: {}", e))
}

#[tauri::command]
pub fn db_import(
    project_path: String,
    source_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    {
        let mut connections = state.connections.lock().unwrap();
        connections.remove(&project_path);
    }

    let auric_dir = database::ensure_auric_dir(&project_path)?;
    let db_path = auric_dir.join("project.db");

    let _ = fs::remove_file(auric_dir.join("project.db-wal"));
    let _ = fs::remove_file(auric_dir.join("project.db-shm"));
    if db_path.exists() {
        fs::remove_file(&db_path).map_err(|e| format!("Failed to remove old database: {}", e))?;
    }

    fs::copy(source_path, &db_path)
        .map(|_| ())
        .map_err(|e| format!("Failed to import database: {}", e))?;

    let conn = database::init_db(&project_path)?;
    let mut connections = state.connections.lock().unwrap();
    connections.insert(project_path, conn);

    Ok(())
}

#[tauri::command]
pub fn pm_save(
    project_path: String,
    payload: PmSavePayload,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::pm_save_impl(conn, &payload)
}

#[tauri::command]
pub fn pm_load(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<PmState, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::pm_load_impl(conn)
}

#[tauri::command]
pub fn pm_load_history(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<Vec<PmStatusHistoryEntry>, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::pm_load_history_impl(conn)
}

#[tauri::command]
pub fn agent_prompt_history_add(
    project_path: String,
    entry: AgentPromptHistoryEntry,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::agent_prompt_history_add_impl(conn, &entry)
}

#[tauri::command]
pub fn agent_prompt_history_list(
    project_path: String,
    limit: Option<usize>,
    state: tauri::State<'_, DatabaseState>,
) -> Result<Vec<AgentPromptHistoryEntry>, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::agent_prompt_history_list_impl(conn, limit)
}

#[tauri::command]
pub fn pm_latest_ticket_review(
    project_path: String,
    ticket_id: String,
    since_iso: Option<String>,
    state: tauri::State<'_, DatabaseState>,
) -> Result<Option<TicketReview>, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::pm_latest_ticket_review_impl(conn, &ticket_id, since_iso.as_deref())
}

#[tauri::command]
pub fn pm_clear(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::pm_clear_impl(conn)
}

#[tauri::command]
pub fn blueprints_save(
    project_path: String,
    payload: BlueprintState,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::blueprints_save_impl(conn, &payload)
}

#[tauri::command]
pub fn blueprints_load(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<BlueprintState, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::blueprints_load_impl(conn)
}

#[tauri::command]
pub fn blueprints_clear(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::blueprints_clear_impl(conn)
}

#[tauri::command]
pub fn requirements_save(
    project_path: String,
    payload: RequirementsState,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::requirements_save_impl(conn, &payload)
}

#[tauri::command]
pub fn requirements_load(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<RequirementsState, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::requirements_load_impl(conn)
}

#[tauri::command]
pub fn requirements_clear(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::requirements_clear_impl(conn)
}

#[tauri::command]
pub fn goals_save(
    project_path: String,
    payload: GoalsSyncPayload,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::goals_sync_impl(conn, &payload)
}

#[tauri::command]
pub fn goals_load(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<GoalsState, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::goals_load_impl(conn)
}

#[tauri::command]
pub fn goals_clear(
    project_path: String,
    state: tauri::State<'_, DatabaseState>,
) -> Result<(), String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(&project_path)
        .ok_or("Database not initialized for this project")?;
    database::goals_clear_impl(conn)
}

#[tauri::command]
pub async fn projects_pm_overview(
    project_paths: Vec<String>,
) -> Result<Vec<ProjectPmOverview>, String> {
    tauri::async_runtime::spawn_blocking(move || inbox::projects_pm_overview_impl(&project_paths))
        .await
        .map_err(|e| e.to_string())
}
