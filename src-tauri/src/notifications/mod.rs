//! The notification inbox: a persistent, cross-project event log.

pub mod commands;
/// Emitted when the inbox changed on disk; the frontend then drains from its cursor.
pub const CHANGED_EVENT: &str = "notifications-changed";

mod coalesce;
pub(crate) mod operations;
mod schema;
mod types;
mod watch;

#[cfg(test)]
mod tests;

pub use operations::*;
pub use schema::*;
pub use types::*;
pub use watch::*;

/// Runs `f` on the app's inbox database. An error names what could not be
/// done (`purpose`) when the app has no inbox yet or its lock is poisoned.
pub fn with_inbox<T>(
    app: &tauri::AppHandle,
    purpose: &str,
    f: impl FnOnce(&mut rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    use tauri::Manager;
    let unavailable = || format!("The inbox is unavailable; {purpose}");
    let state = app
        .try_state::<NotificationsState>()
        .ok_or_else(unavailable)?;
    let mut conn = state.conn.lock().map_err(|_| unavailable())?;
    f(&mut conn)
}

/// Books a notification the backend raised on its own (a supervisor-link
/// proposal, a manager's memory check, the control socket). Nobody waits on
/// it, so a failure is logged under `source` and goes no further.
pub fn dispatch_logged(app: &tauri::AppHandle, input: &NotificationInput, source: &str) {
    if let Err(error) = with_inbox(app, "a notification was not recorded", |conn| {
        dispatch_impl(conn, input)
    }) {
        eprintln!("{source}: could not record a notification: {error}");
    }
}
