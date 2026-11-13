//! The Tauri commands of `crashlog`; `lib.rs` registers them.

use crate::crashlog::{self, CrashLogEntry, FrontendError};
use tauri::Manager;

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
