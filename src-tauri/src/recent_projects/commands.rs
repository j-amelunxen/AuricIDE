use super::store::{
    apply_starred_settings, push_starred_project, RecentProjectsState, StarredProjectsState,
};
use super::types::{RecentProject, StarredProject, StarredProjectSettings};
use std::path::Path;

#[tauri::command]
pub fn recent_projects_list(
    state: tauri::State<'_, RecentProjectsState>,
) -> Result<Vec<RecentProject>, String> {
    state
        .projects
        .lock()
        .map(|projects| projects.clone())
        .map_err(|_| "Recent projects lock poisoned".to_string())
}

#[tauri::command]
pub fn recent_projects_import(
    legacy_projects: Vec<RecentProject>,
    state: tauri::State<'_, RecentProjectsState>,
) -> Result<Vec<RecentProject>, String> {
    state.update(|projects| projects.extend(legacy_projects))
}

#[tauri::command]
pub fn recent_projects_add(
    path: String,
    state: tauri::State<'_, RecentProjectsState>,
) -> Result<Vec<RecentProject>, String> {
    if path.trim().is_empty() {
        return Err("Project path must not be empty".to_string());
    }
    let name = Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&path)
        .to_string();
    let opened_at = chrono::Utc::now().timestamp_millis().max(0) as u64;
    state.update(|projects| {
        projects.push(RecentProject {
            path,
            name,
            opened_at,
        })
    })
}

#[tauri::command]
pub fn recent_projects_remove(
    path: String,
    state: tauri::State<'_, RecentProjectsState>,
) -> Result<Vec<RecentProject>, String> {
    state.update(|projects| projects.retain(|project| project.path != path))
}

#[tauri::command]
pub fn starred_projects_list(
    state: tauri::State<'_, StarredProjectsState>,
) -> Result<Vec<StarredProject>, String> {
    state
        .projects
        .lock()
        .map(|projects| projects.clone())
        .map_err(|_| "Starred projects lock poisoned".to_string())
}

#[tauri::command]
pub fn starred_projects_import(
    legacy_projects: Vec<StarredProject>,
    state: tauri::State<'_, StarredProjectsState>,
) -> Result<Vec<StarredProject>, String> {
    state.update(|projects| projects.extend(legacy_projects))
}

#[tauri::command]
pub fn starred_projects_add(
    path: String,
    state: tauri::State<'_, StarredProjectsState>,
) -> Result<Vec<StarredProject>, String> {
    if path.trim().is_empty() {
        return Err("Project path must not be empty".to_string());
    }
    let starred_at = chrono::Utc::now().timestamp_millis().max(0) as u64;
    state.update(|projects| push_starred_project(projects, path, starred_at))
}

#[tauri::command]
pub fn starred_projects_remove(
    path: String,
    state: tauri::State<'_, StarredProjectsState>,
) -> Result<Vec<StarredProject>, String> {
    state.update(|projects| projects.retain(|project| project.path != path))
}

/// One coarse command that replaces the whole settings blob. The store rewrites
/// the entire file on every mutation anyway, so fine-grained set-icon /
/// add-skill / reorder commands would buy zero I/O while quadrupling the IPC
/// surface. Convenience belongs in the store slice, not on the wire.
#[tauri::command]
pub fn starred_projects_update_settings(
    path: String,
    settings: StarredProjectSettings,
    state: tauri::State<'_, StarredProjectsState>,
) -> Result<Vec<StarredProject>, String> {
    if path.trim().is_empty() {
        return Err("Project path must not be empty".to_string());
    }
    let mut found = false;
    let projects = state.update(|projects| {
        found = apply_starred_settings(projects, &path, settings);
    })?;
    if !found {
        return Err(format!("Project is not starred: {path}"));
    }
    Ok(projects)
}
