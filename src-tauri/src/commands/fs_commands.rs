use super::fs_utils::{
    copy_dir_recursive, ensure_scratch_dir, read_directory_dated_by, read_file_impl,
    search_in_files_impl, write_file_impl, FileEntry, SearchMatch, SEARCH_MAX_RESULTS,
};
use crate::recent_creations::RecentCreations;
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tauri::Manager;
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
pub struct ProjectFileInfo {
    pub path: String,
    pub extension: String,
    pub line_count: usize,
}

#[tauri::command]
pub async fn read_directory(
    path: String,
    recent: tauri::State<'_, Arc<RecentCreations>>,
) -> Result<Vec<FileEntry>, String> {
    let recent = recent.inner().clone();
    read_directory_dated_by(&path, |dir| {
        recent
            .newest_by_child(&dir.to_string_lossy())
            .unwrap_or_else(|| super::fs_utils::newest_file_created_at_by_child(dir))
    })
}

#[tauri::command]
pub fn exists(path: &str) -> bool {
    Path::new(path).exists()
}

#[tauri::command]
pub fn is_dir(path: &str) -> bool {
    Path::new(path).is_dir()
}

#[tauri::command]
pub fn read_file(path: &str) -> Result<String, String> {
    read_file_impl(path)
}

#[tauri::command]
pub fn read_file_base64(path: &str) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let bytes = fs::read(path).map_err(|e| format!("Failed to read binary file: {}", e))?;
    Ok(general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn write_file(path: &str, content: &str) -> Result<(), String> {
    write_file_impl(path, content)
}

#[tauri::command]
pub fn copy_file(source: String, destination: String) -> Result<(), String> {
    let src = Path::new(&source);
    let dest = Path::new(&destination);

    if src.is_dir() {
        copy_dir_recursive(src, dest).map_err(|e| e.to_string())
    } else {
        fs::copy(src, dest).map(|_| ()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn move_path(source: String, destination: String) -> Result<(), String> {
    let src = Path::new(&source);
    let dest = Path::new(&destination);

    if !src.exists() {
        return Err(format!("Source no longer exists: {}", source));
    }
    if dest.exists() {
        let name = dest
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("that name");
        return Err(format!("An item named \"{}\" already exists here", name));
    }
    if src.is_dir() {
        if let (Ok(src_canon), Some(parent)) = (src.canonicalize(), dest.parent()) {
            if let Ok(parent_canon) = parent.canonicalize() {
                if parent_canon == src_canon || parent_canon.starts_with(&src_canon) {
                    return Err("Cannot move a folder into itself".to_string());
                }
            }
        }
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    match fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            if src.is_dir() {
                copy_dir_recursive(src, dest).map_err(|e| e.to_string())?;
                fs::remove_dir_all(src).map_err(|e| e.to_string())?;
            } else {
                fs::copy(src, dest).map_err(|e| e.to_string())?;
                fs::remove_file(src).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn list_all_files(root_path: String) -> Result<Vec<String>, String> {
    let root = Path::new(&root_path);
    if !root.is_dir() {
        return Err("Invalid root path".to_string());
    }

    let entries: Vec<String> = WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            name != ".git" && name != "node_modules" && name != "target" && name != ".auric"
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.path().to_string_lossy().to_string())
        .collect();

    Ok(entries)
}

#[tauri::command]
pub async fn get_project_files_info(root_path: String) -> Result<Vec<ProjectFileInfo>, String> {
    let root = Path::new(&root_path);
    if !root.is_dir() {
        return Err("Invalid root path".to_string());
    }

    let entries: Vec<ProjectFileInfo> = WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            name != ".git" && name != "node_modules" && name != "target" && name != ".auric"
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let path = e.path();
            let extension = path
                .extension()
                .map(|ext| ext.to_string_lossy().to_string())
                .unwrap_or_default();

            let is_text = matches!(
                extension.as_str(),
                "ts" | "tsx"
                    | "js"
                    | "jsx"
                    | "rs"
                    | "py"
                    | "md"
                    | "json"
                    | "html"
                    | "css"
                    | "toml"
                    | "yml"
                    | "yaml"
                    | "txt"
            );

            if !is_text {
                return None;
            }

            let content = fs::read_to_string(path).ok()?;
            let line_count = content.lines().count();

            Some(ProjectFileInfo {
                path: path.to_string_lossy().to_string(),
                extension,
                line_count,
            })
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
pub async fn search_in_files(
    root_path: String,
    query: String,
    case_sensitive: bool,
) -> Result<Vec<SearchMatch>, String> {
    search_in_files_impl(&root_path, &query, case_sensitive, SEARCH_MAX_RESULTS)
}

#[tauri::command]
pub fn save_image_to_path(base64_data: String, path: String) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    use std::io::Write;

    let data = base64_data
        .split(',')
        .next_back()
        .ok_or("Invalid base64 data")?;

    let bytes = general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;

    let file_path = Path::new(&path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut file = fs::File::create(file_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn save_temp_image(base64_data: String, app: tauri::AppHandle) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    use std::io::Write;

    let data = base64_data
        .split(',')
        .next_back()
        .ok_or("Invalid base64 data")?;

    let bytes = general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;

    let temp_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    if !temp_dir.exists() {
        fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    }

    let file_name = format!(
        "screenshot_{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    let file_path = temp_dir.join(file_name);
    let mut file = fs::File::create(&file_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_scratch_dir(app: tauri::AppHandle) -> Result<String, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = ensure_scratch_dir(base)?;
    Ok(dir.to_string_lossy().to_string())
}
