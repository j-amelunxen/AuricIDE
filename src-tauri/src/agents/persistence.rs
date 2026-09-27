use super::types::AgentConfig;
use crate::agent_persistence::{AgentPersistenceState, PersistedAgent};
use tauri::{AppHandle, Manager};

/// Snapshot of a spawn config for the restart-persistence file.
pub fn persisted_from_config(
    config: &AgentConfig,
    id: &str,
    provider_id: &str,
    started_at: u64,
) -> PersistedAgent {
    PersistedAgent {
        id: id.to_string(),
        name: config.name.clone(),
        model: config.model.clone(),
        provider: provider_id.to_string(),
        task: config.task.clone(),
        cwd: config.cwd.clone(),
        project_path: config.project_path.clone(),
        permission_mode: config.permission_mode.clone(),
        dangerously_ignore_permissions: config.dangerously_ignore_permissions.unwrap_or(false),
        auto_accept_edits: config.auto_accept_edits.unwrap_or(false),
        headless: config.headless.unwrap_or(false),
        started_at,
        spawned_by_ticket_id: config.spawned_by_ticket_id.clone(),
        spawned_by_goal_id: config.spawned_by_goal_id.clone(),
        launch_request_uid: config.launch_request_uid.clone(),
    }
}

/// Records a spawned agent as the restart anchor of its run. The anchor is
/// what lets a restart mark a run `interrupted` instead of leaving it
/// `running`, so a failed write is retried in the background: every later
/// save writes the whole list, the new agent included.
pub fn persistence_record_spawn(app: &AppHandle, agent: PersistedAgent) {
    let Some(state) = app.try_state::<AgentPersistenceState>() else {
        return;
    };
    let outcome = state
        .lock()
        .map_err(|_| "Agent persistence is unavailable".to_string())
        .and_then(|mut p| p.record_spawn(agent));
    if let Err(error) = outcome {
        eprintln!("Agent persistence: {error}; retrying");
        let state = state.inner().clone();
        std::thread::spawn(move || {
            let outcome = super::launch_runs::write_with_retry(
                &super::launch_runs::RETRY_DELAYS,
                &std::thread::sleep,
                &mut || {
                    state
                        .lock()
                        .map_err(|_| "Agent persistence is unavailable".to_string())?
                        .save()
                },
            );
            if let Err(error) = outcome {
                eprintln!("Agent persistence: gave up: {error}");
            }
        });
    }
}

/// Lets go of an agent's restart anchor.
pub fn persistence_record_exit(app: &AppHandle, agent_id: &str) -> Result<(), String> {
    let Some(state) = app.try_state::<AgentPersistenceState>() else {
        return Ok(());
    };
    let mut p = state
        .lock()
        .map_err(|_| "Agent persistence is unavailable".to_string())?;
    p.record_exit(agent_id)
}

/// Wraps an interrupted agent's original task in a continuation preamble.
/// Provider-agnostic: the resumed process starts a fresh session, so it must
/// be told that earlier progress may already exist in the working tree.
pub fn resume_task_prompt(original_task: &str) -> String {
    format!(
        "You are resuming work that was interrupted by an IDE restart. \
         The original task was:\n\n{}\n\nFirst inspect the repository's current \
         state — part of the work may already be done. Then continue from where \
         the previous run left off instead of starting over.",
        original_task
    )
}
