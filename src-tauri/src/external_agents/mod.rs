//! Runs the IDE tracks but does not run: a sandbox, a remote box, another
//! machine. The contract is `docs/design-external-agents.md`, the
//! machine-checkable half `src/lib/agents/externalAgents.fixtures.json`.
//!
//! An external run is not an agent and never enters the agent list, so limits,
//! the watchdog, the attention model and a restart have nothing to except. A
//! supervisor reaches this through the control socket
//! (`control_socket/external_agents.rs`), the human through the commands below.

mod booking;
mod lookup;
pub mod model;
pub mod store;

pub use booking::{settle, Booked};
pub use lookup::resolve_links;
pub use model::{
    ExternalAgentView, ExternalError, ExternalRegisterParams, ExternalStopParams, CHANGED_EVENT,
};

use crate::agent_usage::capture::{UsageRecordedEvent, USAGE_RECORDED_EVENT};
use crate::supervisor_link::jobs::now_ms;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

fn announce(app: &tauri::AppHandle, booked: Vec<Booked>, changed: bool) {
    for Booked { project_path, row } in booked {
        let _ = app.emit(
            USAGE_RECORDED_EVENT,
            UsageRecordedEvent { project_path, row },
        );
    }
    if changed {
        let _ = app.emit(CHANGED_EVENT, ());
    }
}

/// Every entry on this machine; the timeline picks what belongs to it. It only
/// reads, because the frontend calls it on every change event.
#[tauri::command(async)]
pub fn external_agents_list(app: tauri::AppHandle) -> Result<Vec<ExternalAgentView>, String> {
    let now = now_ms();
    let file = store::read(&app_data(&app)?).map_err(|error| error.to_string())?;
    Ok(file
        .agents
        .iter()
        .filter(|agent| !agent.is_expired(now))
        .map(|agent| agent.view(now))
        .collect())
}

/// A Tauri command and no socket method, so no agent can reach it.
// elementuuid=el_extcls01 kind=api security=docs/security/supervisor-tools.md validation=tauri:id
#[tauri::command(async)]
pub fn external_agent_close(
    app: tauri::AppHandle,
    id: String,
) -> Result<ExternalAgentView, String> {
    let dir = app_data(&app)?;
    let (view, booked, changed) = close(&dir, &id, now_ms()).map_err(|error| error.to_string())?;
    announce(&app, booked, changed);
    Ok(view)
}

/// `external_agent_close` without the app: makes the entry final, then books it.
fn close(
    dir: &std::path::Path,
    id: &str,
    now: u64,
) -> Result<(ExternalAgentView, Vec<Booked>, bool), ExternalError> {
    let (agent, closed) = store::update(dir, now, |file| {
        let answer = model::apply_close(file, id, now)?;
        let touched = answer.1;
        Ok((answer, touched))
    })?;
    let (booked, marked) = settle(dir, now)?;
    let current = store::read(dir)?
        .agents
        .into_iter()
        .find(|entry| entry.id == agent.id)
        .unwrap_or(agent);
    Ok((current.view(now), booked, closed || marked))
}

/// A history write that failed before the last quit gets its next try here,
/// off the setup thread, because a locked database may take seconds to answer.
pub fn spawn_startup_retry(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let Ok(dir) = app_data(&app) else { return };
        match settle(&dir, now_ms()) {
            Ok((booked, marked)) => announce(&app, booked, marked),
            Err(error) => eprintln!("External agents: {error}"),
        }
    });
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
