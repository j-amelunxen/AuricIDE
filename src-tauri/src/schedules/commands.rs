//! The Tauri commands of `schedules`; `lib.rs` registers them.

use crate::notifications::NotificationsState;
use crate::schedules::{self, Schedule};
use tauri::{Emitter, Manager};

const SCHEDULE_TICK_SECS: u64 = 30;

pub fn spawn_schedule_runner(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        {
            let state = app.state::<NotificationsState>();
            let mut conn = match state.conn.lock() {
                Ok(conn) => conn,
                Err(_) => break,
            };
            match schedules::run_due_impl(&mut conn, chrono::Utc::now()) {
                Ok(fired) if fired > 0 => {
                    drop(conn);
                    let _ = app.emit(crate::notifications::CHANGED_EVENT, ());
                }
                Ok(_) => {}
                Err(error) => eprintln!("Schedule runner failed: {error}"),
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(SCHEDULE_TICK_SECS));
    });
}

#[tauri::command]
pub fn schedules_list(
    state: tauri::State<'_, NotificationsState>,
) -> Result<Vec<Schedule>, String> {
    let conn = state.conn.lock().unwrap();
    schedules::list_impl(&conn)
}

#[tauri::command]
pub fn schedules_upsert(
    schedule: Schedule,
    state: tauri::State<'_, NotificationsState>,
) -> Result<Schedule, String> {
    let conn = state.conn.lock().unwrap();
    let existing = schedules::list_impl(&conn)?
        .into_iter()
        .find(|candidate| candidate.id == schedule.id);
    schedules::validate_mission_link_edit(existing.as_ref(), &schedule)?;
    schedules::upsert_impl(&conn, &schedule)
}

#[tauri::command]
pub fn schedules_delete(
    id: String,
    state: tauri::State<'_, NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    schedules::delete_impl(&conn, &id)
}

#[tauri::command]
pub fn schedules_set_enabled(
    id: String,
    enabled: bool,
    state: tauri::State<'_, NotificationsState>,
) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    schedules::set_enabled_impl(&conn, &id, enabled)
}

#[tauri::command]
pub fn schedules_preview(schedule: Schedule, count: Option<usize>) -> Result<Vec<String>, String> {
    schedules::preview_impl(&schedule, chrono::Utc::now(), count.unwrap_or(3))
}

#[tauri::command]
pub fn schedules_occurrences(
    schedules: Vec<Schedule>,
    from: String,
    to: String,
    per_schedule_cap: Option<usize>,
) -> Result<Vec<schedules::ScheduleOccurrences>, String> {
    let parse = |raw: &str| {
        schedules::parse_ts(raw).ok_or_else(|| format!("Unreadable timestamp \"{}\"", raw))
    };
    schedules::occurrences_impl(
        &schedules,
        parse(&from)?,
        parse(&to)?,
        per_schedule_cap.unwrap_or(200),
    )
}
