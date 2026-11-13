//! The Tauri commands of `excalidraw`; `lib.rs` registers them.

use crate::app_config::AppCredentialsState;
use crate::database::DatabaseState;
use crate::excalidraw::{self, contract as excalidraw_contract};

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
