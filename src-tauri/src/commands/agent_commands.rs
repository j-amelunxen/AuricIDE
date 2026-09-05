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
) -> Result<(), String> {
    let mut p = persistence.lock().map_err(|e| e.to_string())?;
    if p.discard_interrupted(&agent_id) {
        Ok(())
    } else {
        Err(format!("Interrupted agent not found: {}", agent_id))
    }
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
        p.take_interrupted(&agent_id)
            .ok_or_else(|| format!("Interrupted agent not found: {}", agent_id))?
    };

    let config = AgentConfig {
        name: persisted.name,
        model: persisted.model,
        task: agents::resume_task_prompt(&persisted.task),
        cwd: persisted.cwd,
        permission_mode: persisted.permission_mode,
        dangerously_ignore_permissions: Some(persisted.dangerously_ignore_permissions),
        auto_accept_edits: Some(persisted.auto_accept_edits),
        provider: Some(persisted.provider),
        headless: Some(persisted.headless),
        spawned_by_ticket_id: persisted.spawned_by_ticket_id,
        spawned_by_goal_id: persisted.spawned_by_goal_id,
    };

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
