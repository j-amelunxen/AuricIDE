use super::terminal_commands::{TerminalSession, TerminalState};
use crate::agent_persistence::AgentPersistenceState;
use crate::agents::{self, AgentConfig, AgentInfo, AgentManagerState};
use crate::memory_report;
use crate::providers::{PromptTemplate, ProviderRegistryState};
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Arc;
use tauri::Manager;
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;

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
    for (key, value) in agents::cached_login_shell_env().await {
        command.env(key, value);
    }
    let output = command.output().await;

    Ok(output.is_ok() && output.unwrap().status.success())
}

#[tauri::command]
pub async fn list_agents(
    state: tauri::State<'_, AgentManagerState>,
) -> Result<Vec<AgentInfo>, String> {
    agents::list_agents_impl(&state).await
}

#[tauri::command]
pub async fn spawn_agent(
    config: AgentConfig,
    state: tauri::State<'_, AgentManagerState>,
    terminal_state: tauri::State<'_, TerminalState>,
    provider_state: tauri::State<'_, ProviderRegistryState>,
    app: tauri::AppHandle,
) -> Result<AgentInfo, String> {
    spawn_agent_with_session(config, &state, &terminal_state, &provider_state, app).await
}

pub async fn spawn_agent_with_session(
    config: AgentConfig,
    state: &AgentManagerState,
    terminal_state: &TerminalState,
    provider_state: &ProviderRegistryState,
    app: tauri::AppHandle,
) -> Result<AgentInfo, String> {
    let app_for_cleanup = app.clone();
    let (info, writer, master) = agents::spawn_agent_impl(
        config,
        state,
        &app,
        provider_state,
        move |agent_id: String| {
            let ts = app_for_cleanup.state::<TerminalState>();
            let mut sessions = ts.sessions.lock().unwrap();
            sessions.remove(&format!("agent-{}", agent_id));
        },
    )
    .await?;

    let session = Arc::new(AsyncMutex::new(TerminalSession {
        writer: Some(writer),
        master: Some(master),
    }));

    {
        let mut sessions = terminal_state.sessions.lock().unwrap();
        sessions.insert(format!("agent-{}", info.id), session);
    }

    {
        let manager = state.lock().await;
        if !manager.agents.contains_key(&info.id) {
            let mut sessions = terminal_state.sessions.lock().unwrap();
            sessions.remove(&format!("agent-{}", info.id));
        }
    }

    Ok(info)
}

#[tauri::command]
pub async fn kill_agent(
    agent_id: String,
    state: tauri::State<'_, AgentManagerState>,
    terminal_state: tauri::State<'_, TerminalState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    {
        let mut sessions = terminal_state.sessions.lock().unwrap();
        sessions.remove(&format!("agent-{}", agent_id));
    }

    agents::kill_agent_impl(&agent_id, &state, &app).await
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
    // Discarding is the human ending the run: the request learns it first,
    // and only then is the anchor let go, so a failed write or a quit in
    // between leaves the agent to be discarded again (review r2).
    match served {
        Some(uid) => {
            let verdict = agents::launch_runs::killed(&uid, &agent_id);
            agents::launch_runs::finish(
                &agents::launch_runs::RETRY_DELAYS,
                &std::thread::sleep,
                &mut || {
                    let inbox = app
                        .try_state::<crate::notifications::NotificationsState>()
                        .ok_or_else(|| "The inbox is unavailable".to_string())?;
                    let conn = inbox
                        .conn
                        .lock()
                        .map_err(|_| "The inbox is unavailable".to_string())?;
                    crate::notifications::record_launch_run_impl(&conn, &verdict)
                },
                &mut forget,
            )
        }
        None => forget(),
    }
}

/// Whether `agent_id`'s run for `uid` has its verdict.
fn launch_run_is_final(app: &tauri::AppHandle, uid: &str, agent_id: &str) -> Result<bool, String> {
    let inbox = app
        .try_state::<crate::notifications::NotificationsState>()
        .ok_or_else(|| "The inbox is unavailable; the run cannot be checked".to_string())?;
    let conn = inbox
        .conn
        .lock()
        .map_err(|_| "The inbox is unavailable; the run cannot be checked".to_string())?;
    crate::notifications::launch_run_is_final_for(&conn, uid, agent_id)
}

fn launch_request_exists(app: &tauri::AppHandle, uid: &str) -> bool {
    app.try_state::<crate::notifications::NotificationsState>()
        .and_then(|inbox| {
            let conn = inbox.conn.lock().ok()?;
            crate::notifications::is_launch_request(&conn, uid).ok()
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
    let config = agents::resumed_config(persisted, launch_request_uid);

    spawn_agent_with_session(config, &state, &terminal_state, &provider_state, app).await
}

#[tauri::command]
pub async fn kill_agents_for_repo(
    repo_path: String,
    state: tauri::State<'_, AgentManagerState>,
    terminal_state: tauri::State<'_, TerminalState>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    let ids_to_kill: Vec<String> = {
        let manager = state.lock().await;
        manager
            .agents
            .values()
            .filter(|p| p.info.repo_path.as_deref() == Some(&repo_path))
            .map(|p| p.info.id.clone())
            .collect()
    };

    {
        let mut sessions = terminal_state.sessions.lock().unwrap();
        for id in &ids_to_kill {
            sessions.remove(&format!("agent-{}", id));
        }
    }

    agents::kill_agents_for_repo_impl(&repo_path, &state, &app).await
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
            .agents
            .values()
            .filter_map(|agent| {
                agent
                    .child
                    .process_id()
                    .map(|pid| memory_report::KnownProcess {
                        pid,
                        label: format!("Agent: {}", agent.info.name),
                    })
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
