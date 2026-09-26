use super::persistence::{
    persisted_from_config, persistence_record_exit, persistence_record_spawn,
};
use super::project_binding::resolve_project_binding;

pub(super) fn is_reserved_auric_env(key: &str) -> bool {
    matches!(
        key,
        "AURIC_PROJECT_ROOT" | "AURIC_MCP_DB_PATH" | "AURIC_NOTIFICATIONS_DB"
    )
}
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

/// A bound agent needs provider material that points its MCP at the bound
/// project. Without it the spawn is refused, unless the provider config opted
/// in to starting unbound (`allowUnboundMcp`) because its CLI cannot take one.
pub fn binding_injection_for(
    provider_id: &str,
    injection: crate::providers::SpawnInjection,
    allows_unbound: bool,
) -> Result<crate::providers::SpawnInjection, String> {
    if injection.is_empty() && !allows_unbound {
        return Err(format!(
            "Provider '{provider_id}' does not support an isolated Auric MCP project binding"
        ));
    }
    Ok(injection)
}

pub fn resolve_permitted_provider(
    requested: Option<&str>,
    providers: &ProviderRegistryState,
    policy: &crate::provider_policy::ProviderPolicy,
) -> Result<(String, Arc<dyn crate::providers::AgentProvider>), String> {
    // A named provider is a choice: if it is not installed the spawn fails
    // with that name, instead of quietly running the default in its place.
    // Only an absent (or blank) request means "whatever the default is".
    let provider = match requested.map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => providers.get(id).ok_or_else(|| {
            format!(
                "Provider '{id}' is not installed in AuricIDE. \
                 Import its config under Settings → Providers, or pick an installed one."
            )
        })?,
        None => providers
            .get("claude")
            .unwrap_or_else(|| providers.default_provider()),
    };
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

/// Binds a spawn to its project's Auric MCP server: one private config per
/// agent, the provider's launch material, and the reserved Auric variables.
/// The server's environment (`crate::mcp::agent_mcp_server_env`) is computed
/// once and handed to every provider path.
fn bind_to_project_mcp(
    spawn_cmd: crate::providers::SpawnCommand,
    app: &AppHandle,
    binding: &super::project_binding::ResolvedProjectBinding,
    provider: (&str, &dyn crate::providers::AgentProvider),
    cwd: Option<&str>,
) -> Result<crate::providers::SpawnCommand, String> {
    let runtime_entrypoint = crate::mcp::runtime_entrypoint(app)?;
    let notifications_db = app
        .path()
        .app_data_dir()
        .ok()
        .map(|app_data| crate::notifications::db_path_in(&app_data));
    let agent_cwd = crate::mcp::canonical_agent_cwd(cwd);
    let mcp_env = crate::mcp::agent_mcp_server_env(
        notifications_db.as_deref(),
        app.try_state::<ProviderRegistryState>()
            .as_deref()
            .map(|registry| registry.as_ref()),
        agent_cwd.as_deref(),
    );
    let mcp_configs = crate::mcp::ensure_agent_mcp_config(app, binding.project_root(), &mcp_env)?;
    let provider_binding = binding
        .provider_binding()
        .with_mcp_config_path(mcp_configs.standard.to_string_lossy().into_owned())
        .with_crush_config_path(mcp_configs.crush.to_string_lossy().into_owned())
        .with_runtime_entrypoint(runtime_entrypoint.to_string_lossy().into_owned())
        .with_mcp_env(mcp_env);
    let (provider_id, provider) = provider;
    // Spawning honours `allowUnboundMcp`; `list_agent_providers` deliberately
    // does not (see `providers::supports_isolated_mcp_binding`), so agents
    // started over MCP only ever get providers bound to this project.
    let provider_injection = binding_injection_for(
        provider_id,
        crate::providers::project_binding_material(provider_id, provider, &provider_binding)?,
        provider.allows_unbound_mcp(),
    )?;
    let spawn_cmd = spawn_cmd.with_injection(provider_injection);
    // Reserved Auric variables are applied after provider material so a
    // provider config cannot accidentally point MCP at a different project.
    Ok(spawn_cmd.with_injection(crate::providers::SpawnInjection {
        arguments: Vec::new(),
        env_vars: {
            let mut env = binding.environment();
            if let Some(path) = notifications_db.as_ref() {
                env.push((
                    "AURIC_NOTIFICATIONS_DB".to_string(),
                    path.to_string_lossy().into_owned(),
                ));
            }
            env
        },
    }))
}

/// Sub-goal 09: an agent answering an MCP launch request starts only where
/// that request may run. Checked against the inbox row, not the frontend's
/// word, before any PTY exists.
fn check_launch_request_directory(
    app: &AppHandle,
    request_uid: &str,
    cwd: Option<&str>,
) -> Result<(), String> {
    let inbox = app
        .try_state::<crate::notifications::NotificationsState>()
        .ok_or_else(|| {
            "The inbox is unavailable; a launch request cannot be checked".to_string()
        })?;
    let conn = inbox
        .conn
        .lock()
        .map_err(|_| "The inbox is unavailable; a launch request cannot be checked".to_string())?;
    super::launch_dir::check_launch_directory(&conn, request_uid, cwd)
}

/// Sub-goal 09: an agent-written Start button (notify, an agent's schedule)
/// starts only in the folder the MCP server checked and stamped on it.
fn check_agent_notification_directory(app: &AppHandle, config: &AgentConfig) -> Result<(), String> {
    let Some(uid) = config.agent_notification_uid.as_deref() else {
        return Ok(());
    };
    let action_id = config
        .agent_notification_action_id
        .as_deref()
        .ok_or_else(|| format!("The Start button on '{uid}' names no action"))?;
    let inbox = app
        .try_state::<crate::notifications::NotificationsState>()
        .ok_or_else(|| "The inbox is unavailable; a Start button cannot be checked".to_string())?;
    let conn = inbox
        .conn
        .lock()
        .map_err(|_| "The inbox is unavailable; a Start button cannot be checked".to_string())?;
    super::launch_dir::check_agent_notification_directory(
        &conn,
        uid,
        action_id,
        config.cwd.as_deref(),
    )
}

// code-gate: complexity-cyclomatic, complexity-function-length - existing PTY setup plus output pump; sub-goal 09 moved the MCP binding out, splitting the pump is its own refactor
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
    // Resolve once, before opening the PTY. The resulting binding is immutable
    // for the process lifetime and never follows later UI/project changes.
    let project_binding = resolve_project_binding(config.project_path.as_deref())?;
    if let Some(request_uid) = config.launch_request_uid.as_deref() {
        check_launch_request_directory(app, request_uid, config.cwd.as_deref())?;
    }
    check_agent_notification_directory(app, &config)?;

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

    let policy = match project_binding.as_ref() {
        Some(binding) => crate::provider_policy::policy_for_project(binding.project_root()),
        None => crate::provider_policy::ProviderPolicy::default(),
    };
    let (provider_id, provider) =
        resolve_permitted_provider(config.provider.as_deref(), providers, &policy)?;
    let provider_id = provider_id.as_str();

    let mut spawn_cmd = provider.build_spawn_command(
        &config.model,
        &config.task,
        config.permission_mode.as_deref(),
        config.dangerously_ignore_permissions.unwrap_or(false),
        config.auto_accept_edits.unwrap_or(false),
        config.headless.unwrap_or(false),
    );
    if let Some(binding) = project_binding.as_ref() {
        spawn_cmd = bind_to_project_mcp(
            spawn_cmd,
            app,
            binding,
            (provider_id, provider.as_ref()),
            config.cwd.as_deref(),
        )?;
    }
    let spawn_cmd = attach_usage_sidecar(spawn_cmd, app);

    let mut cmd = CommandBuilder::new(shell);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.arg(&spawn_cmd.command);

    for (key, value) in cached_login_shell_env().await {
        // Project authority must come exclusively from the resolved binding
        // above. In particular, a deliberately general agent must not inherit
        // a stale binding from the shell that launched AuricIDE.
        if !is_reserved_auric_env(key) {
            cmd.env(key, value);
        }
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

    let mut persisted_config = config.clone();
    persisted_config.project_path = project_binding
        .as_ref()
        .map(|binding| binding.project_root().to_string_lossy().into_owned());
    persistence_record_spawn(
        app,
        persisted_from_config(&persisted_config, &id, provider_id, now),
    );

    let info = AgentInfo {
        id: id.clone(),
        name: config.name,
        model: config.model,
        provider: provider_id.to_string(),
        status: AgentStatus::Running,
        current_task: Some(config.task),
        started_at: now,
        last_activity_at: Some(now),
        project_path: project_binding
            .as_ref()
            .map(|binding| binding.project_root().to_string_lossy().into_owned()),
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
