use crate::providers::ProviderRegistryState;
use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Mutex, OnceCell};

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
    #[serde(default)]
    pub spawned_by_ticket_id: Option<String>,
    #[serde(default)]
    pub spawned_by_goal_id: Option<String>,
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
    pub spawned_by_ticket_id: Option<String>,
    pub spawned_by_goal_id: Option<String>,
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
    pub child: Box<dyn PtyChild + Send + Sync>,
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

// ── Cached login-shell environment ──────────────────────────────────
//
// Agent processes need the PATH (and any other env vars) that a user's
// login shell would set up (e.g. nvm/homebrew entries from .zprofile /
// .zshrc), because GUI apps on macOS are launched with a minimal PATH.
// Spawning a *login* shell (`-l`) for every single agent re-parses those
// rc files on every spawn, which dominates spawn latency on machines with
// heavier shell configs. Instead we resolve the login-shell environment
// once, cache it for the lifetime of the app, and spawn agents with a
// plain (non-login) shell plus the cached env applied explicitly.
static SHELL_ENV_CACHE: OnceCell<Vec<(String, String)>> = OnceCell::const_new();

/// Pre-resolves the cached login-shell environment so the first real agent
/// spawn doesn't have to pay for it. Safe to call multiple times.
pub async fn warm_shell_env_cache() {
    cached_login_shell_env().await;
}

pub(crate) async fn cached_login_shell_env() -> &'static [(String, String)] {
    SHELL_ENV_CACHE
        .get_or_init(|| async {
            tokio::task::spawn_blocking(resolve_login_shell_env)
                .await
                .unwrap_or_default()
        })
        .await
        .as_slice()
}

fn resolve_login_shell_env() -> Vec<(String, String)> {
    let (shell, flag) = if cfg!(target_os = "windows") {
        return Vec::new();
    } else if cfg!(target_os = "macos") {
        ("/bin/zsh", "-lc")
    } else {
        ("sh", "-lc")
    };

    match std::process::Command::new(shell)
        .arg(flag)
        .arg("env -0")
        .output()
    {
        Ok(out) if out.status.success() => parse_env_output(&out.stdout),
        _ => Vec::new(),
    }
}

fn parse_env_output(bytes: &[u8]) -> Vec<(String, String)> {
    String::from_utf8_lossy(bytes)
        .split('\0')
        .filter_map(|entry| entry.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
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
    // Invoked with the agent id once the process has terminated naturally —
    // the caller owns the terminal-session registry and must drop the PTY
    // handles there, or every finished agent leaks its session + FDs.
    on_exit: impl FnOnce(String) + Send + 'static,
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

    // Non-login shell: the PATH/env a login shell would source is applied
    // explicitly below via the cached login-shell environment, so we avoid
    // re-parsing rc files on every single agent spawn.
    let (shell, args) = if cfg!(target_os = "windows") {
        ("cmd", vec!["/C".to_string()])
    } else if cfg!(target_os = "macos") {
        ("/bin/zsh", vec!["-c".to_string()])
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

    for (key, value) in cached_login_shell_env().await {
        cmd.env(key, value);
    }
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
        spawned_by_ticket_id: config.spawned_by_ticket_id.clone(),
        spawned_by_goal_id: config.spawned_by_goal_id.clone(),
    };

    let process = AgentProcess {
        info: info.clone(),
        child,
    };

    // Stream PTY output to the frontend (batched at ~30fps to avoid IPC
    // saturation). Bounded channel: if the emit task ever lags, the read
    // thread blocks instead of buffering PTY output without limit — the
    // same backpressure a real terminal applies to a fast writer.
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);

    // Thread for blocking read from PTY
    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 {
                break;
            }
            if tx.blocking_send(buffer[..n].to_vec()).is_err() {
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
        let proc_opt = {
            let mut mgr = state_clone.lock().await;
            mgr.agents.remove(&id_clone)
        };

        // Reap the child to get the REAL exit code — a crashed or failed agent
        // must surface as Error, not Idle, so the conductor requeues instead of
        // marking the ticket done.
        let exit_code: i32 = match proc_opt {
            Some(mut process) => tokio::task::spawn_blocking(move || {
                process
                    .child
                    .wait()
                    .map(|status| if status.success() { 0 } else { 1 })
                    .unwrap_or(-1)
            })
            .await
            .unwrap_or(-1),
            // Already removed by the explicit kill path, which emits its own event
            None => 0,
        };

        let status = if exit_code == 0 {
            AgentStatus::Idle
        } else {
            AgentStatus::Error
        };

        let _ = app_clone.emit(
            "agent-status",
            AgentStatusEvent {
                agent_id: id_clone.clone(),
                status,
                exit_code: Some(exit_code),
                repo_path: rp_clone,
            },
        );

        // Release the caller-held terminal session (PTY master + writer).
        on_exit(id_clone);
    });

    manager.agents.insert(id, process);

    Ok((info, writer, pair.master))
}

async fn emit_agent_output(app: &AppHandle, id: &str, repo_path: &Option<String>, data: String) {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    // Single event channel: the frontend store is the sole consumer and all
    // terminal surfaces replay from it. A parallel terminal-out emit doubled
    // IPC traffic and let terminals drift out of sync with the store.
    let _ = app.emit(
        "agent-output",
        AgentOutputEvent {
            agent_id: id.to_string(),
            stream: "stdout".to_string(),
            line: data,
            timestamp,
            repo_path: repo_path.clone(),
        },
    );
}

// ── kill_agent ──────────────────────────────────────────────────────

pub async fn kill_agent_impl(
    agent_id: &str,
    state: &AgentManagerState,
    app: &AppHandle,
) -> Result<(), String> {
    let mut manager = state.lock().await;
    let mut process = manager
        .agents
        .remove(agent_id)
        .ok_or_else(|| format!("Agent not found: {}", agent_id))?;
    drop(manager);

    // Removing the AgentProcess only drops our handle to the child — the
    // PTY child process itself keeps running unless explicitly killed.
    let _ = process.child.kill();

    let _ = app.emit(
        "agent-status",
        AgentStatusEvent {
            agent_id: agent_id.to_string(),
            status: AgentStatus::Idle,
            exit_code: None,
            repo_path: process.info.repo_path,
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

    #[test]
    fn test_parse_env_output_splits_nul_separated_pairs() {
        let raw = b"FOO=bar\0PATH=/usr/bin:/bin\0EMPTY=\0";
        let parsed = parse_env_output(raw);
        assert_eq!(
            parsed,
            vec![
                ("FOO".to_string(), "bar".to_string()),
                ("PATH".to_string(), "/usr/bin:/bin".to_string()),
                ("EMPTY".to_string(), "".to_string()),
            ]
        );
    }

    #[test]
    fn test_parse_env_output_keeps_equals_signs_in_value() {
        let raw = b"CONNSTRING=user=admin;pass=1\0";
        let parsed = parse_env_output(raw);
        assert_eq!(
            parsed,
            vec![("CONNSTRING".to_string(), "user=admin;pass=1".to_string())]
        );
    }

    #[test]
    fn test_parse_env_output_skips_entries_without_equals() {
        let raw = b"MALFORMED\0FOO=bar\0";
        let parsed = parse_env_output(raw);
        assert_eq!(parsed, vec![("FOO".to_string(), "bar".to_string())]);
    }

    /// Regression test: dropping an `AgentProcess` (e.g. after removing it
    /// from the manager's map) must NOT be relied upon to terminate the
    /// underlying PTY child. `kill_agent_impl` must explicitly call
    /// `.kill()`, otherwise "killed" agents keep running as orphaned
    /// processes indefinitely.
    #[test]
    fn test_child_kill_terminates_the_process() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("failed to open pty");

        let mut cmd = CommandBuilder::new("sleep");
        cmd.arg("30");

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .expect("failed to spawn sleep");
        drop(pair.slave);

        assert!(
            child.try_wait().expect("try_wait failed").is_none(),
            "process should still be running right after spawn"
        );

        child.kill().expect("kill should succeed");

        let mut terminated = false;
        for _ in 0..100 {
            if child.try_wait().expect("try_wait failed").is_some() {
                terminated = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        assert!(
            terminated,
            "process should have exited after calling kill() on the child handle"
        );
    }
}
