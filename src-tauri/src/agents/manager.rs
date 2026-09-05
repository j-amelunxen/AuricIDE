use super::persistence::{
    persisted_from_config, persistence_record_exit, persistence_record_spawn,
};
use super::shell_env::cached_login_shell_env;
use super::types::*;
use crate::agent_persistence::AgentPersistenceState;
use crate::providers::ProviderRegistryState;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::Read;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

pub async fn list_agents_impl(state: &AgentManagerState) -> Result<Vec<AgentInfo>, String> {
    let manager = state.lock().await;
    let infos: Vec<AgentInfo> = manager.agents.values().map(|p| p.info.clone()).collect();
    Ok(infos)
}

pub fn resolve_permitted_provider(
    requested: Option<&str>,
    providers: &ProviderRegistryState,
    policy: &crate::provider_policy::ProviderPolicy,
) -> Result<(String, Arc<dyn crate::providers::AgentProvider>), String> {
    let provider = providers
        .get(requested.unwrap_or("claude"))
        .unwrap_or_else(|| providers.default_provider());
    let resolved_id = provider.info().id;

    if !crate::provider_policy::is_provider_allowed(&resolved_id, policy) {
        return Err(format!(
            "Provider '{}' is not permitted in this project. \
             Its provider policy decides which agents may run here — \
             change it under Settings → Project → Providers.",
            resolved_id
        ));
    }

    Ok((resolved_id, provider))
}

pub fn attach_usage_sidecar(
    spawn_cmd: crate::providers::SpawnCommand,
    app: &AppHandle,
) -> crate::providers::SpawnCommand {
    let is_claude =
        std::path::Path::new(spawn_cmd.executable.split_whitespace().last().unwrap_or(""))
            .file_name()
            .is_some_and(|name| name == "claude");
    if !is_claude {
        return spawn_cmd;
    }

    let Some(service) = app.try_state::<crate::usage_limits::UsageLimitsService>() else {
        return spawn_cmd;
    };
    if !service.is_enabled() {
        return spawn_cmd;
    }

    match service.ensure_claude_sidecar() {
        Ok(settings) => {
            spawn_cmd.with_flag_after_executable("--settings", &settings.display().to_string())
        }
        Err(error) => {
            eprintln!("Usage limits: could not prepare the statusLine sidecar: {error}");
            spawn_cmd
        }
    }
}

pub async fn spawn_agent_impl(
    config: AgentConfig,
    state: &AgentManagerState,
    app: &AppHandle,
    providers: &ProviderRegistryState,
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

    let (shell, args) = if cfg!(target_os = "windows") {
        ("cmd", vec!["/C".to_string()])
    } else if cfg!(target_os = "macos") {
        ("/bin/zsh", vec!["-c".to_string()])
    } else {
        ("sh", vec!["-c".to_string()])
    };

    let policy = match config.cwd.as_deref() {
        Some(cwd) => {
            let project = crate::git::primary_project_path(std::path::Path::new(cwd))
                .unwrap_or_else(|| std::path::PathBuf::from(cwd));
            crate::provider_policy::policy_for_project(&project)
        }
        None => crate::provider_policy::ProviderPolicy::default(),
    };
    let (provider_id, provider) =
        resolve_permitted_provider(config.provider.as_deref(), providers, &policy)?;
    let provider_id = provider_id.as_str();

    let spawn_cmd = provider.build_spawn_command(
        &config.model,
        &config.task,
        config.permission_mode.as_deref(),
        config.dangerously_ignore_permissions.unwrap_or(false),
        config.auto_accept_edits.unwrap_or(false),
        config.headless.unwrap_or(false),
    );
    let spawn_cmd = attach_usage_sidecar(spawn_cmd, app);

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
        let project = crate::git::primary_project_path(std::path::Path::new(cwd))
            .unwrap_or_else(|| std::path::PathBuf::from(cwd));
        let db_path = project.join(".auric").join("project.db");
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

    persistence_record_spawn(app, persisted_from_config(&config, &id, provider_id, now));

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

    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);

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

    tauri::async_runtime::spawn(async move {
        let mut decoder = crate::utf8_stream::Utf8StreamDecoder::new();
        let mut accum = String::new();
        let mut has_produced_output = false;
        let mut last_emit = std::time::Instant::now();
        let batch_interval = std::time::Duration::from_millis(32);

        loop {
            let timeout = tokio::time::sleep(batch_interval);
            tokio::pin!(timeout);

            tokio::select! {
                data = rx.recv() => {
                    match data {
                        Some(bytes) => {
                            has_produced_output = true;
                            accum.push_str(&decoder.push(&bytes));

                            if accum.len() > 16384 || last_emit.elapsed() >= batch_interval {
                                let data = std::mem::take(&mut accum);
                                emit_agent_output(&app_clone, &id_clone, &rp_clone, data).await;
                                last_emit = std::time::Instant::now();
                            }
                        }
                        None => break,
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

        accum.push_str(&decoder.finish());
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

        let proc_opt = {
            let mut mgr = state_clone.lock().await;
            mgr.agents.remove(&id_clone)
        };

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

        persistence_record_exit(&app_clone, &id_clone);
        on_exit(id_clone);
    });

    manager.agents.insert(id, process);

    Ok((info, writer, pair.master))
}

pub async fn emit_agent_output(
    app: &AppHandle,
    id: &str,
    repo_path: &Option<String>,
    data: String,
) {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

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

    let _ = process.child.kill();
    persistence_record_exit(app, agent_id);

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

pub async fn rename_agent_impl(
    agent_id: &str,
    name: &str,
    state: &AgentManagerState,
    app: &AppHandle,
) -> Result<AgentInfo, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Agent name must not be empty".to_string());
    }

    let mut manager = state.lock().await;
    let process = manager
        .agents
        .get_mut(agent_id)
        .ok_or_else(|| format!("Agent not found: {}", agent_id))?;
    process.info.name = name.to_string();
    let info = process.info.clone();
    drop(manager);

    if let Some(persistence) = app.try_state::<AgentPersistenceState>() {
        if let Ok(mut p) = persistence.lock() {
            p.rename(agent_id, name);
        }
    }

    Ok(info)
}

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

pub async fn cleanup_all_agents(app: AppHandle) {
    let state = app.state::<AgentManagerState>();
    let mut manager = state.lock().await;
    manager.agents.clear();
}
