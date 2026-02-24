use crate::providers::ProviderRegistryState;
use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

// ── Data types ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub name: String,
    pub model: String,
    pub task: String,
    pub cwd: Option<String>,
    pub permission_mode: Option<String>,
    pub dangerously_ignore_permissions: Option<bool>,
    pub auto_accept_edits: Option<bool>,
    pub provider: Option<String>,
    pub headless: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Running,
    Idle,
    Queued,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub model: String,
    pub provider: String,
    pub status: AgentStatus,
    pub current_task: Option<String>,
    pub started_at: u64,
    pub last_activity_at: Option<u64>,
    pub repo_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOutputEvent {
    pub agent_id: String,
    pub stream: String,
    pub line: String,
    pub timestamp: u64,
    pub repo_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusEvent {
    pub agent_id: String,
    pub status: AgentStatus,
    pub exit_code: Option<i32>,
    pub repo_path: Option<String>,
}

// ── Internal state (not serialized) ─────────────────────────────────

pub struct AgentProcess {
    pub info: AgentInfo,
    pub _child: Box<dyn PtyChild + Send + Sync>,
}

pub struct AgentManager {
    pub agents: HashMap<String, AgentProcess>,
    pub counter: u64,
}

impl AgentManager {
    fn new() -> Self {
        Self {
            agents: HashMap::new(),
            counter: 0,
        }
    }

    fn next_id(&mut self) -> String {
        self.counter += 1;
        format!("agent-{}", self.counter)
    }
}

pub type AgentManagerState = Arc<Mutex<AgentManager>>;

pub fn new_agent_manager_state() -> AgentManagerState {
    Arc::new(Mutex::new(AgentManager::new()))
}

// ── list_agents ─────────────────────────────────────────────────────

pub async fn list_agents_impl(state: &AgentManagerState) -> Result<Vec<AgentInfo>, String> {
    let manager = state.lock().await;
    let infos: Vec<AgentInfo> = manager.agents.values().map(|p| p.info.clone()).collect();
    Ok(infos)
}

// ── spawn_agent ─────────────────────────────────────────────────────

pub async fn spawn_agent_impl(
    config: AgentConfig,
    state: &AgentManagerState,
    app: &AppHandle,
    providers: &ProviderRegistryState,
) -> Result<
    (
        AgentInfo,
        Box<dyn std::io::Write + Send>,
        Box<dyn MasterPty + Send>,
    ),
    String,
> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let (shell, args) = if cfg!(target_os = "windows") {
        ("cmd", vec!["/C".to_string()])
    } else if cfg!(target_os = "macos") {
        ("/bin/zsh", vec!["-lc".to_string()])
    } else {
        ("sh", vec!["-c".to_string()])
    };

    let provider_id = config.provider.as_deref().unwrap_or("claude");
    let provider = providers
        .get(provider_id)
        .unwrap_or_else(|| providers.default_provider());

    let spawn_cmd = provider.build_spawn_command(
        &config.model,
        &config.task,
        config.permission_mode.as_deref(),
        config.dangerously_ignore_permissions.unwrap_or(false),
        config.auto_accept_edits.unwrap_or(false),
        config.headless.unwrap_or(false),
    );

    let mut cmd = CommandBuilder::new(shell);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.arg(&spawn_cmd.command);

    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    for (key, value) in &spawn_cmd.env_vars {
        cmd.env(key, value);
    }

    if let Some(ref cwd) = config.cwd {
        if std::path::Path::new(cwd).is_dir() {
            cmd.cwd(cwd);
        }
        // Expose the project DB path so spawned agents can connect via MCP
        let db_path = std::path::Path::new(cwd).join(".auric").join("project.db");
        cmd.env("AURIC_MCP_DB_PATH", db_path.to_string_lossy().as_ref());
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn agent PTY: {}", e))?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let mut manager = state.lock().await;
    let id = manager.next_id();

    let info = AgentInfo {
        id: id.clone(),
        name: config.name,
        model: config.model,
        provider: provider_id.to_string(),
        status: AgentStatus::Running,
        current_task: Some(config.task),
        started_at: now,
        last_activity_at: Some(now),
        repo_path: config.cwd.clone(),
    };

    let process = AgentProcess {
        info: info.clone(),
        _child: child,
    };

    // Stream PTY output to the frontend (batched at ~30fps to avoid IPC saturation)
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();

    // Thread for blocking read from PTY
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 {
                break;
            }
            if tx.send(buffer[..n].to_vec()).is_err() {
                break;
            }
        }
    });

    let app_clone = app.clone();
    let id_clone = id.clone();
    let rp_clone = info.repo_path.clone();
    let cli_name = provider_id.to_string();
    let state_clone = state.clone();

    // Async task for batching and emitting (prevents trapping data in buffers)
    tauri::async_runtime::spawn(async move {
        let mut accum = String::new();
        let mut has_produced_output = false;
        let mut last_emit = std::time::Instant::now();
        let batch_interval = std::time::Duration::from_millis(32); // ~30fps

        loop {
            let timeout = tokio::time::sleep(batch_interval);
            tokio::pin!(timeout);

            tokio::select! {
                data = rx.recv() => {
                    match data {
                        Some(bytes) => {
                            has_produced_output = true;
                            accum.push_str(&String::from_utf8_lossy(&bytes));

                            if accum.len() > 16384 || last_emit.elapsed() >= batch_interval {
                                let data = std::mem::take(&mut accum);
                                emit_agent_output(&app_clone, &id_clone, &rp_clone, data).await;
                                last_emit = std::time::Instant::now();
                            }
                        }
                        None => break, // Channel closed (PTY read thread exited)
                    }
                }
                _ = &mut timeout => {
                    if !accum.is_empty() {
                        let data = std::mem::take(&mut accum);
                        emit_agent_output(&app_clone, &id_clone, &rp_clone, data).await;
                        last_emit = std::time::Instant::now();
                    }
                }
            }
        }

        // Final flush of remaining accumulated data
        if !accum.is_empty() {
            emit_agent_output(&app_clone, &id_clone, &rp_clone, accum).await;
        }

        if !has_produced_output {
            let error_msg = format!("\r\n\x1b[31mError: Agent process terminated without output. Check if '{}' CLI is installed.\x1b[0m\r\n", cli_name);
            let _ = app_clone.emit(&format!("terminal-out-agent-{}", id_clone), &error_msg);
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;

            let _ = app_clone.emit(
                "agent-output",
                AgentOutputEvent {
                    agent_id: id_clone.clone(),
                    stream: "stderr".to_string(),
                    line: error_msg,
                    timestamp,
                    repo_path: rp_clone.clone(),
                },
            );
        }

        // Clean up AgentProcess on natural termination (release PTY resources)
        {
            let mut mgr = state_clone.lock().await;
            mgr.agents.remove(&id_clone);
        }

        let _ = app_clone.emit(
            "agent-status",
            AgentStatusEvent {
                agent_id: id_clone,
                status: AgentStatus::Idle,
                exit_code: Some(0),
                repo_path: rp_clone,
            },
        );
    });

    manager.agents.insert(id, process);

    Ok((info, writer, pair.master))
}

async fn emit_agent_output(app: &AppHandle, id: &str, repo_path: &Option<String>, data: String) {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let _ = app.emit(
        "agent-output",
        AgentOutputEvent {
            agent_id: id.to_string(),
            stream: "stdout".to_string(),
            line: data.clone(),
            timestamp,
            repo_path: repo_path.clone(),
        },
    );
    let _ = app.emit(&format!("terminal-out-agent-{}", id), data);
}

// ── kill_agent ──────────────────────────────────────────────────────

pub async fn kill_agent_impl(
    agent_id: &str,
    state: &AgentManagerState,
    app: &AppHandle,
) -> Result<(), String> {
    let mut manager = state.lock().await;
    let _process = manager
        .agents
        .remove(agent_id)
        .ok_or_else(|| format!("Agent not found: {}", agent_id))?;

    let _ = app.emit(
        "agent-status",
        AgentStatusEvent {
            agent_id: agent_id.to_string(),
            status: AgentStatus::Idle,
            exit_code: None,
            repo_path: None,
        },
    );

    Ok(())
}

// ── kill_agents_for_repo ────────────────────────────────────────────

pub async fn kill_agents_for_repo_impl(
    repo_path: &str,
    state: &AgentManagerState,
    app: &AppHandle,
) -> Result<u32, String> {
    let ids_to_kill: Vec<String> = {
        let manager = state.lock().await;
        manager
            .agents
            .values()
            .filter(|p| p.info.repo_path.as_deref() == Some(repo_path))
            .map(|p| p.info.id.clone())
            .collect()
    };

    let count = ids_to_kill.len() as u32;
    for id in ids_to_kill {
        kill_agent_impl(&id, state, app).await?;
    }
    Ok(count)
}

// ── cleanup ─────────────────────────────────────────────────────────

pub async fn cleanup_all_agents(app: AppHandle) {
    let state = app.state::<AgentManagerState>();
    let mut manager = state.lock().await;
    manager.agents.clear();
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_config_deserializes_camel_case() {
        let json = r#"{
            "name": "Test Agent",
            "model": "sonnet",
            "task": "do stuff",
            "cwd": "/tmp",
            "permissionMode": "bypassPermissions",
            "dangerouslyIgnorePermissions": true,
            "autoAcceptEdits": false,
            "provider": "claude",
            "headless": true
        }"#;
        let config: AgentConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.name, "Test Agent");
        assert_eq!(config.model, "sonnet");
        assert_eq!(config.task, "do stuff");
        assert_eq!(config.cwd.as_deref(), Some("/tmp"));
        assert_eq!(config.permission_mode.as_deref(), Some("bypassPermissions"));
        assert_eq!(config.dangerously_ignore_permissions, Some(true));
        assert_eq!(config.auto_accept_edits, Some(false));
        assert_eq!(config.provider.as_deref(), Some("claude"));
        assert_eq!(config.headless, Some(true));
    }

    #[test]
    fn test_agent_config_optional_fields_default_to_none() {
        let json = r#"{
            "name": "Minimal",
            "model": "auto",
            "task": "hello"
        }"#;
        let config: AgentConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.name, "Minimal");
        assert_eq!(config.model, "auto");
        assert_eq!(config.task, "hello");
        assert!(config.cwd.is_none());
        assert!(config.permission_mode.is_none());
        assert!(config.dangerously_ignore_permissions.is_none());
        assert!(config.auto_accept_edits.is_none());
        assert!(config.provider.is_none());
        assert!(config.headless.is_none());
    }
}
