//! The Tauri commands of `mcp`; `lib.rs` registers them.

use crate::mcp::{self, McpServerState, McpStatusInfo};
use crate::notifications::{self};
use serde::Serialize;
use std::collections::BTreeMap;
use tauri::Manager;

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
pub async fn mcp_launch_spec(
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
    let database_path = crate::database::project_db_path(&project_root);
    if !database_path.is_file() {
        return Err(format!(
            "AuricIDE project is not initialized: {}",
            project_root.display()
        ));
    }

    let runtime = mcp::runtime_entrypoint(&app)?;
    let path_var = crate::machine::path_from_env(crate::machine::cached_login_shell_env().await);
    let command = crate::node_runtime::command_for_mcp(&runtime, &path_var);

    let mut env = BTreeMap::new();
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        env.insert(
            crate::auric_env::NOTIFICATIONS_DB.to_string(),
            notifications::db_path_in(&app_data_dir)
                .to_string_lossy()
                .into_owned(),
        );
    }

    Ok(McpLaunchSpec {
        command,
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
    let mut shell_env = crate::machine::cached_login_shell_env().await.to_vec();

    if let Ok(dir) = app.path().app_data_dir() {
        shell_env.push((
            crate::auric_env::NOTIFICATIONS_DB.to_string(),
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
    state.status()
}
