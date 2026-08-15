//! Discovery of user-supplied Theme JSON files.
//! Validation and apply live in the TypeScript layer (single source of truth).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
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

/// User-writable destination for imported themes. Created on first import.
pub fn user_themes_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("themes"))
        .map_err(|e| format!("Could not resolve the app data directory: {e}"))
}

fn is_safe_theme_filename(filename: &str) -> bool {
    let Some(stem) = filename.strip_suffix(".json") else {
        return false;
    };
    // Matches theme id: kebab-case [a-z0-9-], 1–64 chars. No separators.
    if stem.is_empty() || stem.len() > 64 {
        return false;
    }
    let mut chars = stem.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_lowercase() || first.is_ascii_digit())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Write `content` as `filename` inside `themes_dir`. Creates the directory.
/// `filename` must be a bare `*.json` name — no path separators.
pub fn install_theme_file(
    themes_dir: &Path,
    filename: &str,
    content: &str,
) -> Result<ThemeFile, String> {
    if !is_safe_theme_filename(filename) {
        return Err(
            "Theme filename must be kebab-case [a-z0-9-], 1–64 chars, ending in .json".to_string(),
        );
    }
    if content.trim().is_empty() {
        return Err("Theme file is empty".to_string());
    }
    const MAX_BYTES: usize = 256 * 1024;
    if content.len() > MAX_BYTES {
        return Err("Theme file is larger than 256 KB".to_string());
    }

    fs::create_dir_all(themes_dir)
        .map_err(|e| format!("Could not create the themes folder: {e}"))?;

    let dest = themes_dir.join(filename);
    match dest.parent() {
        Some(parent) if parent == themes_dir => {}
        _ => return Err("Theme filename must stay inside the themes folder".to_string()),
    }

    fs::write(&dest, content).map_err(|e| format!("Could not write the theme file: {e}"))?;

    Ok(ThemeFile {
        path: dest.to_string_lossy().to_string(),
        content: content.to_string(),
    })
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

    #[test]
    fn install_theme_file_creates_dir_and_writes_json() {
        let dir = tempfile::tempdir().unwrap();
        let themes = dir.path().join("themes");
        let content = r##"{"schemaVersion":1,"id":"rose","name":"Rose","swatch":"#ff4d6d","tokens":{"primary":"#ff4d6d"}}"##;

        let written = install_theme_file(&themes, "rose.json", content).unwrap();

        assert_eq!(written.path, themes.join("rose.json").to_string_lossy());
        assert_eq!(written.content, content);
        assert_eq!(
            fs::read_to_string(themes.join("rose.json")).unwrap(),
            content
        );
    }

    #[test]
    fn install_theme_file_overwrites_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let themes = dir.path().join("themes");
        fs::create_dir_all(&themes).unwrap();
        fs::write(themes.join("rose.json"), "old").unwrap();

        let written = install_theme_file(&themes, "rose.json", "new").unwrap();
        assert_eq!(written.content, "new");
        assert_eq!(fs::read_to_string(themes.join("rose.json")).unwrap(), "new");
    }

    #[test]
    fn install_theme_file_rejects_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let themes = dir.path().join("themes");
        let err = install_theme_file(&themes, "../escape.json", "{}").unwrap_err();
        assert!(
            err.to_lowercase().contains("filename"),
            "unexpected error: {err}"
        );
        assert!(!dir.path().join("escape.json").exists());
    }

    #[test]
    fn install_theme_file_rejects_nested_paths() {
        let dir = tempfile::tempdir().unwrap();
        let themes = dir.path().join("themes");
        let err = install_theme_file(&themes, "nested/rose.json", "{}").unwrap_err();
        assert!(
            err.to_lowercase().contains("filename"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn install_theme_file_rejects_non_json_extension() {
        let dir = tempfile::tempdir().unwrap();
        let themes = dir.path().join("themes");
        let err = install_theme_file(&themes, "rose.txt", "{}").unwrap_err();
        assert!(
            err.to_lowercase().contains("filename"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn install_theme_file_rejects_empty_content() {
        let dir = tempfile::tempdir().unwrap();
        let themes = dir.path().join("themes");
        let err = install_theme_file(&themes, "rose.json", "   ").unwrap_err();
        assert!(
            err.to_lowercase().contains("empty"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn install_theme_file_rejects_dotdot_inside_stem() {
        let dir = tempfile::tempdir().unwrap();
        let themes = dir.path().join("themes");
        let err = install_theme_file(&themes, "rose../x.json", "{}").unwrap_err();
        assert!(
            err.to_lowercase().contains("filename"),
            "unexpected error: {err}"
        );
    }

    fn tempfile_dir() -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("auric-theme-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        dir
    }
}
