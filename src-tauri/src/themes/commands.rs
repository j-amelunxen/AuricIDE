//! The Tauri commands of `themes`; `lib.rs` registers them.

use crate::themes::{self, ThemeFile};

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
