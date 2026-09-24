use crate::agent_log::{self, AgentLogEvent, AgentLogState};
use crate::app_config::AppCredentialsState;
use crate::crashlog::{self, CrashLogEntry, FrontendError};
use crate::database::DatabaseState;
use crate::excalidraw::{self, contract as excalidraw_contract};
use crate::llm::{self, LlmRequest, LlmResponse};
use crate::mcp::{self, McpServerState, McpStatusInfo};
#[cfg(target_os = "macos")]
use crate::menu;
use crate::missions::{self, CreateMissionInput, CreatedMissionWithSchedule};
use crate::notifications::{self, Notification, NotificationInput, NotificationsState};
use crate::providers::{ProviderInfo, ProviderRegistryState};
use crate::schedules::{self, Schedule};
use crate::themes::{self, ThemeFile};
use serde::Serialize;
use std::collections::BTreeMap;
use tauri::{Emitter, Manager};

#[tauri::command]
pub fn list_providers(state: tauri::State<'_, ProviderRegistryState>) -> Vec<ProviderInfo> {
    state.list_providers()
}

#[tauri::command]
pub fn import_provider(
    json: String,
    state: tauri::State<'_, ProviderRegistryState>,
) -> Result<ProviderInfo, String> {
    state.import_provider(&json)
}

#[tauri::command]
pub fn list_themes(app: tauri::AppHandle) -> Vec<ThemeFile> {
    themes::scan_themes(Some(&app))
}

#[tauri::command]
pub fn import_theme(
    app: tauri::AppHandle,
    content: String,
    filename: String,
) -> Result<ThemeFile, String> {
    let dir = themes::user_themes_dir(&app)?;
    themes::install_theme_file(&dir, &filename, &content)
}

#[tauri::command]
pub fn report_frontend_crash(
    error: FrontendError,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let crash_path = crashlog::ensure_crash_dir(&log_dir)?;
    let report = crashlog::format_frontend_report(&error);
    let path = crashlog::write_crash_file(&crash_path, &report)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_crash_logs(app: tauri::AppHandle) -> Result<Vec<CrashLogEntry>, String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let crash_path = crashlog::crash_dir(&log_dir);
    crashlog::list_crash_logs(&crash_path)
}

#[tauri::command]
pub fn read_crash_log(filename: String, app: tauri::AppHandle) -> Result<String, String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let crash_path = crashlog::crash_dir(&log_dir);
    crashlog::read_crash_log(&crash_path, &filename)
}

#[tauri::command]
pub async fn llm_call(
    request: LlmRequest,
    db_state: tauri::State<'_, DatabaseState>,
    credentials: tauri::State<'_, AppCredentialsState>,
) -> Result<LlmResponse, String> {
    llm::llm_call_impl(request, db_state, credentials).await
}

#[tauri::command]
pub async fn excalidraw_test_connection(
    project_path: String,
    db_state: tauri::State<'_, DatabaseState>,
    credentials: tauri::State<'_, AppCredentialsState>,
) -> Result<String, String> {
    excalidraw::test_connection_impl(&project_path, db_state, credentials).await
}

#[tauri::command]
pub async fn excalidraw_list_collections(
    project_path: String,
    db_state: tauri::State<'_, DatabaseState>,
    credentials: tauri::State<'_, AppCredentialsState>,
) -> Result<Vec<excalidraw_contract::Collection>, String> {
    excalidraw::list_collections_impl(&project_path, db_state, credentials).await
}

#[tauri::command]
pub async fn excalidraw_list_scenes(
    project_path: String,
    collection_id: String,
    db_state: tauri::State<'_, DatabaseState>,
    credentials: tauri::State<'_, AppCredentialsState>,
) -> Result<Vec<excalidraw_contract::SceneSummary>, String> {
    excalidraw::list_scenes_impl(&project_path, &collection_id, db_state, credentials).await
}

#[tauri::command]
pub async fn excalidraw_get_scene_content(
    project_path: String,
    scene_id: String,
    db_state: tauri::State<'_, DatabaseState>,
    credentials: tauri::State<'_, AppCredentialsState>,
) -> Result<String, String> {
    excalidraw::get_scene_content_impl(&project_path, &scene_id, db_state, credentials).await
}

#[tauri::command]
pub fn excalidraw_scene_url(workspace_id: Option<String>, scene_id: String) -> String {
    excalidraw::scene_url_impl(workspace_id.as_deref(), &scene_id)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpLaunchSpec {
    command: String,
    args: Vec<String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    env: BTreeMap<String, String>,
}

/// Returns the exact, package-owned stdio command external MCP clients should
/// launch. The project contributes only data; executable code always comes
/// from the installed AuricIDE runtime.
#[tauri::command]
pub fn mcp_launch_spec(
    project_path: String,
    app: tauri::AppHandle,
) -> Result<McpLaunchSpec, String> {
    let project_root = std::path::Path::new(&project_path)
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project path '{project_path}': {error}"))?;
    if !project_root.is_dir() {
        return Err(format!(
            "Project path '{}' is not a directory",
            project_root.display()
        ));
    }
    let database_path = project_root.join(".auric").join("project.db");
    if !database_path.is_file() {
        return Err(format!(
            "AuricIDE project is not initialized: {}",
            project_root.display()
        ));
    }

    let runtime = mcp::runtime_entrypoint(&app)?;

    let mut env = BTreeMap::new();
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        env.insert(
            "AURIC_NOTIFICATIONS_DB".to_string(),
            notifications::db_path_in(&app_data_dir)
                .to_string_lossy()
                .into_owned(),
        );
    }

    Ok(McpLaunchSpec {
        command: "node".to_string(),
        args: vec![
            runtime.to_string_lossy().into_owned(),
            "--project-root".to_string(),
            project_root.to_string_lossy().into_owned(),
        ],
        env,
    })
}

#[tauri::command]
pub async fn start_mcp(
    project_path: String,
    state: tauri::State<'_, McpServerState>,
    app: tauri::AppHandle,
) -> Result<McpStatusInfo, String> {
    let generation = state.reserve_start()?;
    let binding = crate::agents::project_binding::resolve_project_binding(Some(&project_path))?
        .ok_or_else(|| "A project is required to start MCP".to_string())?;
    let canonical_root = binding.project_root().to_path_buf();
    let canonical_project = canonical_root.to_string_lossy().into_owned();
    let runtime = mcp::runtime_entrypoint(&app)?;
    let mut shell_env = crate::agents::cached_login_shell_env().await.to_vec();

    if let Ok(dir) = app.path().app_data_dir() {
        shell_env.push((
            "AURIC_NOTIFICATIONS_DB".to_string(),
            notifications::db_path_in(&dir)
                .to_string_lossy()
                .to_string(),
        ));
    }
    shell_env.extend(binding.environment());

    state.start_reserved_with(generation, &canonical_project, move || {
        mcp::start_packaged_mcp_server(&runtime, &canonical_root, &shell_env)
    })
}

#[tauri::command]
pub fn stop_mcp(state: tauri::State<'_, McpServerState>) -> Result<(), String> {
    state.stop_with(mcp::stop_mcp_server)
}

#[tauri::command]
pub fn mcp_status(state: tauri::State<'_, McpServerState>) -> McpStatusInfo {
    mcp::get_mcp_status(&state)
}

#[tauri::command]
pub fn set_menu_command_states(app: tauri::AppHandle, project_open: bool) {
    #[cfg(target_os = "macos")]
    menu::set_command_states(&app, project_open);
    #[cfg(not(target_os = "macos"))]
    let _ = (app, project_open);
}

// --- Notifications -----------------------------------------------------------

#[tauri::command]
pub fn notifications_dispatch(
    payload: NotificationInput,
    state: tauri::State<'_, NotificationsState>,
) -> Result<Notification, String> {
    let mut conn = state.conn.lock().unwrap();
    notifications::dispatch_impl(&mut conn, &payload)
}

#[tauri::command]
pub fn notifications_list(
    since_id: Option<i64>,
    limit: Option<usize>,
    project_path: Option<String>,
    state: tauri::State<'_, NotificationsState>,
) -> Result<Vec<Notification>, String> {
    let conn = state.conn.lock().unwrap();
    notifications::list_impl(&conn, since_id, limit, project_path.as_deref())
}

#[tauri::command]
pub fn notifications_mark_read(
    uids: Vec<String>,
    state: tauri::State<'_, NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    notifications::mark_read_impl(&conn, &uids)
}

#[tauri::command]
pub fn notifications_mark_all_read(
    project_path: Option<String>,
    state: tauri::State<'_, NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    notifications::mark_all_read_impl(&conn, project_path.as_deref())
}

#[tauri::command]
pub fn notifications_answer(
    uid: String,
    answer: String,
    state: tauri::State<'_, NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    notifications::answer_impl(&conn, &uid, &answer)
}

#[tauri::command]
pub fn notifications_unread_count(
    project_path: Option<String>,
    state: tauri::State<'_, NotificationsState>,
) -> Result<i64, String> {
    let conn = state.conn.lock().unwrap();
    notifications::unread_count_impl(&conn, project_path.as_deref())
}

#[tauri::command]
pub fn notifications_clear(
    project_path: Option<String>,
    state: tauri::State<'_, NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    notifications::clear_impl(&conn, project_path.as_deref())
}

#[tauri::command]
pub fn notifications_delete(
    uids: Vec<String>,
    state: tauri::State<'_, NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    notifications::delete_impl(&conn, &uids)
}

// --- Agent log ---------------------------------------------------------------

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

// --- Schedules ---------------------------------------------------------------

const SCHEDULE_TICK_SECS: u64 = 30;

pub fn spawn_schedule_runner(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        {
            let state = app.state::<NotificationsState>();
            let mut conn = match state.conn.lock() {
                Ok(conn) => conn,
                Err(_) => break,
            };
            match schedules::run_due_impl(&mut conn, chrono::Utc::now()) {
                Ok(fired) if fired > 0 => {
                    drop(conn);
                    let _ = app.emit("notifications-changed", ());
                }
                Ok(_) => {}
                Err(error) => eprintln!("Schedule runner failed: {error}"),
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(SCHEDULE_TICK_SECS));
    });
}

#[tauri::command]
pub fn schedules_list(
    state: tauri::State<'_, NotificationsState>,
) -> Result<Vec<Schedule>, String> {
    let conn = state.conn.lock().unwrap();
    schedules::list_impl(&conn)
}

#[tauri::command]
pub fn schedules_upsert(
    schedule: Schedule,
    state: tauri::State<'_, NotificationsState>,
) -> Result<Schedule, String> {
    let conn = state.conn.lock().unwrap();
    let existing = schedules::list_impl(&conn)?
        .into_iter()
        .find(|candidate| candidate.id == schedule.id);
    schedules::validate_mission_link_edit(existing.as_ref(), &schedule)?;
    schedules::upsert_impl(&conn, &schedule)
}

#[tauri::command]
pub fn schedules_delete(
    id: String,
    state: tauri::State<'_, NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    schedules::delete_impl(&conn, &id)
}

#[tauri::command]
pub fn schedules_set_enabled(
    id: String,
    enabled: bool,
    state: tauri::State<'_, NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    schedules::set_enabled_impl(&conn, &id, enabled)
}

#[tauri::command]
pub fn schedules_preview(schedule: Schedule, count: Option<usize>) -> Result<Vec<String>, String> {
    schedules::preview_impl(&schedule, chrono::Utc::now(), count.unwrap_or(3))
}

#[tauri::command]
pub fn mission_create(
    input: CreateMissionInput,
    state: tauri::State<'_, NotificationsState>,
) -> Result<CreatedMissionWithSchedule, String> {
    let conn = state.conn.lock().unwrap();
    missions::create_with_schedule_impl(&conn, &input, chrono::Utc::now())
}
