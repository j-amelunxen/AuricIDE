use crate::agent_persistence::AgentPersistenceState;
use crate::agents::pty::TerminalState;
use crate::agents::{self, AgentConfig, AgentInfo, AgentManagerState};
use crate::memory_report;
use crate::providers::{PromptTemplate, ProviderRegistryState};
use crate::supervisor::attachments::copy_image_attachment;
use std::fs::OpenOptions;
use std::io::Write;
use tauri::Manager;
use tokio::process::Command;

#[tauri::command]
pub async fn check_cli_status(
    provider_id: Option<String>,
    providers: tauri::State<'_, ProviderRegistryState>,
) -> Result<bool, String> {
    let provider = match provider_id.as_deref() {
        Some(id) => providers
            .get(id)
            .unwrap_or_else(|| providers.default_provider()),
        None => providers.default_provider(),
    };
    let vc = provider.version_check();

    let mut command = Command::new(&vc.command);
    command.args(&vc.args);
    for (key, value) in crate::machine::cached_login_shell_env().await {
        command.env(key, value);
    }
    let output = command.output().await;

    Ok(output.is_ok() && output.unwrap().status.success())
}

#[tauri::command]
pub async fn list_agents(
    state: tauri::State<'_, AgentManagerState>,
) -> Result<Vec<AgentInfo>, String> {
    Ok(agents::list_agents_impl(&state).await)
}

/// Copies human-provided image files into the running supervisor's restricted
/// working directory. The agent id, not a caller-supplied folder, selects the
/// destination so an ordinary agent cannot turn this into an arbitrary copy API.
#[tauri::command]
pub async fn copy_supervisor_image_attachments(
    agent_id: String,
    paths: Vec<String>,
    state: tauri::State<'_, AgentManagerState>,
) -> Result<Vec<String>, String> {
    let run_dir = {
        let manager = state.lock().await;
        let info = manager.info(&agent_id).ok_or("Supervisor is not running")?;
        if info.role != agents::AgentRole::Supervisor {
            return Err("Only the supervisor may receive restricted attachments".to_string());
        }
        info.repo_path
            .clone()
            .ok_or("The supervisor has no run folder")?
    };
    paths
        .iter()
        .map(|path| {
            copy_image_attachment(std::path::Path::new(&run_dir), std::path::Path::new(path))
        })
        .map(|result| result.map(|path| path.to_string_lossy().into_owned()))
        .collect()
}

#[tauri::command]
pub async fn spawn_agent(
    config: AgentConfig,
    state: tauri::State<'_, AgentManagerState>,
    terminal_state: tauri::State<'_, TerminalState>,
    provider_state: tauri::State<'_, ProviderRegistryState>,
    app: tauri::AppHandle,
) -> Result<AgentInfo, String> {
    agents::spawn_agent_with_session(config, &state, &terminal_state, &provider_state, app).await
}

#[tauri::command]
pub async fn kill_agent(
    agent_id: String,
    state: tauri::State<'_, AgentManagerState>,
    terminal_state: tauri::State<'_, TerminalState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    agents::kill_agent_impl(&agent_id, &state, &terminal_state, &app).await
}

#[tauri::command]
pub async fn rename_agent(
    agent_id: String,
    name: String,
    state: tauri::State<'_, AgentManagerState>,
    app: tauri::AppHandle,
) -> Result<AgentInfo, String> {
    agents::rename_agent_impl(&agent_id, &name, &state, &app).await
}

#[tauri::command]
pub async fn list_interrupted_agents(
    persistence: tauri::State<'_, AgentPersistenceState>,
) -> Result<Vec<crate::agent_persistence::PersistedAgent>, String> {
    let p = persistence.lock().map_err(|e| e.to_string())?;
    Ok(p.interrupted())
}

#[tauri::command]
pub async fn discard_interrupted_agent(
    agent_id: String,
    persistence: tauri::State<'_, AgentPersistenceState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let served = {
        let p = persistence.lock().map_err(|e| e.to_string())?;
        p.interrupted()
            .into_iter()
            .find(|agent| agent.id == agent_id)
            .ok_or_else(|| format!("Interrupted agent not found: {}", agent_id))?
            .launch_request_uid
            .filter(|uid| launch_request_exists(&app, uid))
    };
    let mut forget = || {
        persistence
            .lock()
            .map_err(|_| "Agent persistence is unavailable".to_string())?
            .take_interrupted(&agent_id)
            .map(|_| ())
    };
    match served {
        Some(uid) => agents::launch_runs::discard(&app, &uid, &agent_id, &mut forget),
        None => forget(),
    }
}

/// Whether `agent_id`'s run for `uid` has its verdict.
fn launch_run_is_final(app: &tauri::AppHandle, uid: &str, agent_id: &str) -> Result<bool, String> {
    crate::notifications::with_inbox(app, "the run cannot be checked", |conn| {
        crate::notifications::launch_run_is_final_for(conn, uid, agent_id)
    })
}

fn launch_request_exists(app: &tauri::AppHandle, uid: &str) -> bool {
    // An inbox that cannot be read holds no request this agent could serve.
    crate::notifications::with_inbox(app, "a launch request cannot be checked", |conn| {
        crate::notifications::is_launch_request(conn, uid)
    })
    .unwrap_or(false)
}

#[tauri::command]
pub async fn resume_interrupted_agent(
    agent_id: String,
    persistence: tauri::State<'_, AgentPersistenceState>,
    state: tauri::State<'_, AgentManagerState>,
    terminal_state: tauri::State<'_, TerminalState>,
    provider_state: tauri::State<'_, ProviderRegistryState>,
    app: tauri::AppHandle,
) -> Result<AgentInfo, String> {
    let persisted = {
        let mut p = persistence.lock().map_err(|e| e.to_string())?;
        // An agent whose run already has its verdict ended; resuming it would
        // start a finished run again (review r4). It leaves the list instead.
        if let Some(agent) = p.interrupted().into_iter().find(|a| a.id == agent_id) {
            // Fail closed: a run whose state cannot be read is not resumed.
            let ended = match agent.launch_request_uid.as_deref() {
                Some(uid) => launch_run_is_final(&app, uid, &agent_id)?,
                None => false,
            };
            let is_final = |_: &str, _: &str| ended;
            if let Err(refusal) = agents::launch_runs::refuse_finished(&agent, &is_final) {
                if let Err(error) = p.settle(std::slice::from_ref(&agent_id)) {
                    eprintln!("Agent persistence: {error}");
                }
                return Err(refusal);
            }
        }
        p.take_interrupted(&agent_id)?
            .ok_or_else(|| format!("Interrupted agent not found: {}", agent_id))?
    };

    // Keeps reporting to the request, as long as the request still exists:
    // a cleared one would refuse the spawn outright.
    let launch_request_uid = persisted
        .launch_request_uid
        .clone()
        .filter(|uid| launch_request_exists(&app, uid));
    let offer = persisted.clone();
    let config = agents::resumed_config(persisted, launch_request_uid);

    let spawned =
        agents::spawn_agent_with_session(config, &state, &terminal_state, &provider_state, app)
            .await;
    // A supervisor whose run folder or key another live supervisor holds can
    // be resumed once that one ends, and an archived Project Manager once it
    // is restored; the offer is not used up by trying.
    if let Err(refusal) = &spawned {
        if crate::supervisor::several::keeps_restore_offer(refusal) {
            if let Err(error) = persistence
                .lock()
                .map_err(|e| e.to_string())
                .and_then(|mut p| p.restore_interrupted(offer))
            {
                eprintln!("Agent persistence: {error}");
            }
        }
    }
    spawned
}

#[tauri::command]
pub fn get_prompt_template(
    provider_id: Option<String>,
    state: tauri::State<'_, ProviderRegistryState>,
) -> PromptTemplate {
    let provider = match provider_id.as_deref() {
        Some(id) => state.get(id).unwrap_or_else(|| state.default_provider()),
        None => state.default_provider(),
    };
    provider.prompt_template()
}

#[tauri::command]
pub async fn get_system_memory(
    agent_state: tauri::State<'_, AgentManagerState>,
) -> Result<Vec<memory_report::SystemProcessEntry>, String> {
    let known: Vec<memory_report::KnownProcess> = {
        let manager = agent_state.lock().await;
        manager
            .processes()
            .map(|(pid, info)| memory_report::KnownProcess {
                pid,
                label: format!("Agent: {}", info.name),
            })
            .collect()
    };

    let entries = memory_report::read_ps_entries();
    Ok(memory_report::build_memory_report(
        std::process::id(),
        &entries,
        &known,
    ))
}

#[tauri::command]
pub fn append_metrics_log(line: String, app: tauri::AppHandle) -> Result<(), String> {
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;

    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    }

    let log_path = log_dir.join("memory-metrics.jsonl");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open metrics log: {}", e))?;

    writeln!(file, "{}", line).map_err(|e| format!("Failed to write metrics log: {}", e))?;

    Ok(())
}
