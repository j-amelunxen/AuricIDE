//! The Tauri commands of `notifications`; `lib.rs` registers them.

use crate::notifications::{self, Notification, NotificationInput, NotificationsState};

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
pub fn notifications_record_launch_run(
    input: notifications::AgentLaunchRunInput,
    state: tauri::State<'_, NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    notifications::record_launch_run_impl(&conn, &input)
}

/// The atomic gate in front of an automatic start under a launch grant; see
/// `claim_launch_impl`. Anything but `claimed` means: do not spawn.
#[tauri::command]
pub fn notifications_claim_launch(
    input: notifications::AgentLaunchClaimInput,
    state: tauri::State<'_, NotificationsState>,
) -> Result<notifications::LaunchClaimOutcome, String> {
    let mut conn = state.conn.lock().unwrap();
    notifications::claim_launch_impl(
        &mut conn,
        &input,
        &notifications::goal_is_under_root_in_project,
    )
}

/// the owner's switch in the goal panel. Returns the stored grant, or the
/// error; the UI shows the grant only after this answered.
#[tauri::command]
pub fn notifications_save_launch_grant(
    input: notifications::LaunchGrantInput,
    state: tauri::State<'_, NotificationsState>,
) -> Result<notifications::LaunchGrant, String> {
    let mut conn = state.conn.lock().unwrap();
    notifications::save_launch_grant_impl(&mut conn, &input)
}

#[tauri::command]
pub fn notifications_revoke_launch_grant(
    grant_id: String,
    state: tauri::State<'_, NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    notifications::revoke_launch_grant_impl(&conn, &grant_id)
}

#[tauri::command]
pub fn notifications_list_launch_grants(
    project_path: Option<String>,
    state: tauri::State<'_, NotificationsState>,
) -> Result<Vec<notifications::LaunchGrant>, String> {
    let conn = state.conn.lock().unwrap();
    notifications::list_launch_grants_impl(&conn, project_path.as_deref())
}

/// Frees a claimed slot after a start that did not happen.
#[tauri::command]
pub fn notifications_release_launch_claim(
    request_uid: String,
    state: tauri::State<'_, NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    notifications::release_launch_claim_impl(&conn, &request_uid)
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
