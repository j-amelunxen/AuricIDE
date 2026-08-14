//! Discovery of user-supplied Theme JSON files.
//! Validation and apply live in the TypeScript layer (single source of truth).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeFile {
    pub path: String,
    pub content: String,
}

/// Collect `.json` files from the standard Theme search paths.
pub fn scan_themes(app: Option<&tauri::AppHandle>) -> Vec<ThemeFile> {
    let mut files: Vec<ThemeFile> = Vec::new();
    let mut seen_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    for dir in search_paths(app) {
        if !dir.exists() || !dir.is_dir() {
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let path_str = path.to_string_lossy().to_string();
            if !seen_paths.insert(path_str.clone()) {
                continue;
            }
            match fs::read_to_string(&path) {
                Ok(content) => files.push(ThemeFile {
                    path: path_str,
                    content,
                }),
                Err(e) => eprintln!("Failed to read theme {:?}: {}", path, e),
            }
        }
    }

    files
}

fn search_paths(app: Option<&tauri::AppHandle>) -> Vec<PathBuf> {
    let mut paths = vec![PathBuf::from("themes"), PathBuf::from("../themes")];

    if let Some(app) = app {
        if let Ok(app_data_dir) = app.path().app_data_dir() {
            paths.push(app_data_dir.join("themes"));
        }
        if let Ok(resource_dir) = app.path().resource_dir() {
            paths.push(resource_dir.join("themes"));
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            paths.push(exe_dir.join("themes"));
        }
    }

    paths
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn writes_and_reads_theme_file() {
        let dir = tempfile_dir();
        let themes = dir.join("themes");
        fs::create_dir_all(&themes).unwrap();
        let path = themes.join("rose.json");
        let content = r##"{"schemaVersion":1,"id":"rose","name":"Rose","swatch":"#ff4d6d","tokens":{"primary":"#ff4d6d"}}"##;
        {
            let mut f = fs::File::create(&path).unwrap();
            f.write_all(content.as_bytes()).unwrap();
        }
        let read = fs::read_to_string(&path).unwrap();
        assert!(read.contains("rose"));
        let _ = fs::remove_dir_all(&dir);
    }

    fn tempfile_dir() -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("auric-theme-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        dir
    }
}
