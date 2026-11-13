#[cfg(target_os = "macos")]
use crate::menu;

#[tauri::command]
pub fn set_menu_command_states(app: tauri::AppHandle, project_open: bool) {
    #[cfg(target_os = "macos")]
    menu::set_command_states(&app, project_open);
    #[cfg(not(target_os = "macos"))]
    let _ = (app, project_open);
}
