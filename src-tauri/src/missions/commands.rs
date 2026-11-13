//! The Tauri commands of `missions`; `lib.rs` registers them.

use crate::missions::{self, CreateMissionInput, CreatedMissionWithSchedule};
use crate::notifications::NotificationsState;

#[tauri::command]
pub fn mission_create(
    input: CreateMissionInput,
    state: tauri::State<'_, NotificationsState>,
) -> Result<CreatedMissionWithSchedule, String> {
    let conn = state.conn.lock().unwrap();
    missions::create_with_schedule_impl(&conn, &input, chrono::Utc::now())
}
