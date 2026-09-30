use super::persistence::{persisted_from_config, persistence_record_spawn};
use super::project_binding::resolve_project_binding;

pub(super) fn is_reserved_auric_env(key: &str) -> bool {
    matches!(
        key,
        "AURIC_PROJECT_ROOT" | "AURIC_MCP_DB_PATH" | "AURIC_NOTIFICATIONS_DB"
    )
}
use super::shell_env::cached_login_shell_env;

/// Set on every agent process the IDE spawns, and so inherited by every MCP
/// server that agent starts. `auric-mcp --control` refuses to run under it:
/// one agent must not be able to steer another (`docs/design-agent-control.md`).
pub const IDE_AGENT_MARKER: &str = "AURIC_IDE_AGENT";

pub(super) fn apply_agent_env(
    cmd: &mut CommandBuilder,
    shell_env: &[(String, String)],
    spawn_env: &[(String, String)],
) {
    for (key, value) in shell_env {
        // Project authority must come exclusively from the resolved binding
        // above. In particular, a deliberately general agent must not inherit
        // a stale binding from the shell that launched AuricIDE.
        if !is_reserved_auric_env(key) {
            cmd.env(key, value);
        }
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    for (key, value) in spawn_env {
        cmd.env(key, value);
    }
    // Last, so neither the shell nor a provider config can clear it.
    cmd.env(IDE_AGENT_MARKER, "1");
}
use super::types::*;
use crate::agent_persistence::AgentPersistenceState;
use crate::agent_usage::capture::{
    EvidenceWait, UsageCapture, UsageRecordedEvent, EXIT_EVIDENCE_WAIT, USAGE_RECORDED_EVENT,
};
use crate::agent_usage::holdback::ResultHoldback;
use crate::agent_usage::record::Outcome;
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

/// The spawn runs the Claude Code CLI, whichever provider config named it.
fn runs_claude_code(spawn_cmd: &crate::providers::SpawnCommand) -> bool {
    std::path::Path::new(spawn_cmd.executable.split_whitespace().last().unwrap_or(""))
        .file_name()
        .is_some_and(|name| name == "claude")
}

pub fn attach_usage_sidecar(
    spawn_cmd: crate::providers::SpawnCommand,
    app: &AppHandle,
) -> crate::providers::SpawnCommand {
    if !runs_claude_code(&spawn_cmd) {
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

/// Runs the agent under `write_sandbox` when its provider config asks for it
/// for the permission mode this launch resolves to. Applied last, so the
/// sandbox wraps the finished command line and everything it starts.
fn confine_writes_if_declared(
    spawn_cmd: crate::providers::SpawnCommand,
    app: &AppHandle,
    provider: &dyn crate::providers::AgentProvider,
    config: &AgentConfig,
    binding: Option<&super::project_binding::ResolvedProjectBinding>,
) -> Result<crate::providers::SpawnCommand, String> {
    let Some(provider_writable) = provider.write_sandbox(
        config.permission_mode.as_deref(),
        config.dangerously_ignore_permissions.unwrap_or(false),
        config.auto_accept_edits.unwrap_or(false),
    ) else {
        return Ok(spawn_cmd);
    };
    super::write_sandbox::ensure_supported()?;
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("The write sandbox needs the home directory: {e}"))?;
    let notifications_db = app
        .path()
        .app_data_dir()
        .ok()
        .map(|app_data| crate::notifications::db_path_in(&app_data));
    let paths = super::write_sandbox::writable_paths(&super::write_sandbox::SandboxInputs {
        cwd: config.cwd.as_deref().map(std::path::Path::new),
        project_root: binding.map(|b| b.project_root()),
        home: &home,
        provider_writable: &provider_writable,
        notifications_db: notifications_db.as_deref(),
    })?;
    Ok(super::write_sandbox::confine(
        spawn_cmd,
        &super::write_sandbox::profile(&paths),
    ))
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

    let usage_config = provider.usage_config();
    let (mut spawn_cmd, usage_session_id) = crate::agent_usage::launch::with_session_id(
        provider.build_spawn_command(
            &config.model,
            &config.task,
            config.permission_mode.as_deref(),
            config.dangerously_ignore_permissions.unwrap_or(false),
            config.auto_accept_edits.unwrap_or(false),
            config.headless.unwrap_or(false),
        ),
        usage_config.as_ref(),
    );
    if let Some(binding) = project_binding.as_ref() {
        spawn_cmd = bind_to_project_mcp(
            spawn_cmd,
            app,
            binding,
            (provider_id, provider.as_ref()),
            config.cwd.as_deref(),
        )?;
        if runs_claude_code(&spawn_cmd) {
            super::claude_mcp_guard::check_auric_pm_enabled(
                binding.project_root(),
                config.cwd.as_deref().map(std::path::Path::new),
            )?;
        }
    }
    let spawn_cmd = attach_usage_sidecar(spawn_cmd, app);
    let spawn_cmd = confine_writes_if_declared(
        spawn_cmd,
        app,
        provider.as_ref(),
        &config,
        project_binding.as_ref(),
    )?;

    let mut cmd = CommandBuilder::new(shell);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.arg(&spawn_cmd.command);

    apply_agent_env(
        &mut cmd,
        cached_login_shell_env().await,
        &spawn_cmd.env_vars,
    );

    if let Some(ref cwd) = config.cwd {
        if std::path::Path::new(cwd).is_dir() {
            cmd.cwd(cwd);
        }
    }

    let mut child = pair
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

    // Opens the project database, so not while the manager is locked and not
    // on the async runtime.
    let usage = prepare_usage_capture(
        &config,
        project_binding.as_ref(),
        provider_id,
        usage_config,
        usage_session_id,
        now,
    )
    .await;

    let mut manager = state.lock().await;
    let id = manager.next_id();

    let usage = usage.map(|capture| capture.with_agent_id(&id));

    let mut persisted_config = config.clone();
    persisted_config.project_path = project_binding
        .as_ref()
        .map(|binding| binding.project_root().to_string_lossy().into_owned());
    persistence_record_spawn(
        app,
        persisted_from_config(&persisted_config, &id, provider_id, now),
    );

    let launch_request_uid = config.launch_request_uid.clone();
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
        headless: config.headless.unwrap_or(false),
    };

    // Recorded here, before the output pump exists and before the spawn
    // returns: a run that ends at once reports `running` first, and a start
    // that cannot be recorded is ended rather than left to run unrecorded.
    let launch_run = super::launch_runs::started(launch_request_uid.as_deref(), &info);
    let launch_request_uid = launch_run.as_ref().map(|run| run.request_uid.clone());
    if let Some(run) = launch_run {
        super::launch_runs::record_start(app, &run, || {
            let _ = child.kill();
            let _ = super::persistence::persistence_record_exit(app, &id);
        })?;
    }

    let process = AgentProcess {
        info: info.clone(),
        child,
        launch_request_uid: launch_request_uid.clone(),
        usage: usage.clone(),
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
    // Absent only where no app manages it (tests); the console still works.
    let output_buffers = app
        .try_state::<super::output_buffer::OutputBuffersState>()
        .map(|buffers| buffers.inner().clone());
    let mut holdback = usage
        .as_ref()
        .filter(|capture| capture.holds_back_result())
        .map(|_| ResultHoldback::default());
    let sniffing_usage = usage.clone().filter(UsageCapture::sniffs_output);

    tauri::async_runtime::spawn(async move {
        let has_produced_output =
            pump_agent_output(&mut rx, OUTPUT_BATCH_INTERVAL, holdback.as_mut(), |data| {
                if let Some(capture) = &sniffing_usage {
                    capture.sniff(&data);
                }
                if let Some(buffers) = &output_buffers {
                    buffers.append(&id_clone, &data);
                }
                emit_agent_output(&app_clone, &id_clone, &rp_clone, data)
            })
            .await;
        let cli_result = holdback.as_mut().and_then(ResultHoldback::take_result);

        if !has_produced_output {
            let error_msg = format!("\r\n\x1b[31mError: Agent process terminated without output. Check if '{}' CLI is installed.\x1b[0m\r\n", cli_name);
            if let Some(buffers) = &output_buffers {
                buffers.append(&id_clone, &error_msg);
            }
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
        let report_exit = proc_opt.is_some();

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
        if let Some(buffers) = &output_buffers {
            buffers.finish(&id_clone, status.clone());
        }

        let _ = app_clone.emit(
            "agent-status",
            AgentStatusEvent {
                agent_id: id_clone.clone(),
                status,
                exit_code: Some(exit_code),
                repo_path: rp_clone,
            },
        );

        // A kill got there first when the agent is gone from the manager: it
        // reported the verdict and let go of the anchor itself.
        if let (true, Some(capture)) = (report_exit, usage) {
            let outcome = if exit_code == 0 {
                Outcome::Success
            } else {
                Outcome::Error
            };
            // Not awaited: the transcript may still be landing, and the run's
            // exit must not wait for it.
            let app = app_clone.clone();
            tauri::async_runtime::spawn(async move {
                book_usage(
                    &app,
                    capture,
                    outcome,
                    cli_result,
                    EvidenceWait::Poll(EXIT_EVIDENCE_WAIT),
                )
                .await
            });
        }

        if report_exit {
            let verdict = launch_request_uid
                .as_deref()
                .map(|uid| super::launch_runs::ended(uid, &id_clone, exit_code));
            super::launch_runs::end(&app_clone, &id_clone, verdict);
        }
        on_exit(id_clone);
    });

    manager.agents.insert(id, process);

    Ok((info, writer, pair.master))
}

/// The usage capture for a spawn, or `None` (with a log line when something
/// was wrong) if the run cannot be booked.
async fn prepare_usage_capture(
    config: &AgentConfig,
    binding: Option<&super::project_binding::ResolvedProjectBinding>,
    provider_id: &str,
    usage_config: Option<crate::providers::UsageConfig>,
    session_id: Option<String>,
    started_at_ms: u64,
) -> Option<UsageCapture> {
    let project_root = binding?.project_root().to_path_buf();
    let config = config.clone();
    let provider_id = provider_id.to_string();
    let prepared = tokio::task::spawn_blocking(move || {
        UsageCapture::for_spawn(
            &config,
            &project_root,
            &provider_id,
            usage_config,
            session_id,
            started_at_ms,
        )
    })
    .await;
    match prepared {
        Ok(Ok(capture)) => capture,
        Ok(Err(error)) => {
            eprintln!("Agent usage: this run will not be recorded: {error}");
            None
        }
        Err(error) => {
            eprintln!("Agent usage: preparing the capture aborted: {error}");
            None
        }
    }
}

/// Reads a finished run's evidence, appends its usage row and tells the
/// frontend. A failure is logged, never raised: the run itself already ended.
async fn book_usage(
    app: &AppHandle,
    capture: UsageCapture,
    outcome: Outcome,
    cli_result: Option<crate::agent_usage::claude::CliResult>,
    wait: EvidenceWait,
) {
    let Ok(home) = app.path().home_dir() else {
        return;
    };
    let claude_prices = app
        .try_state::<crate::cc_usage::CcUsageService>()
        .and_then(|service| service.plugin_by_id("claude-code"));
    let project_path = capture.event_project_path().to_string();
    let booked = tokio::task::spawn_blocking(move || {
        capture.book(
            &home,
            claude_prices.as_ref(),
            outcome,
            cli_result,
            chrono::Utc::now(),
            wait,
        )
    })
    .await;
    match booked {
        Ok(Ok(Some(row))) => {
            let _ = app.emit(
                USAGE_RECORDED_EVENT,
                UsageRecordedEvent { project_path, row },
            );
        }
        Ok(Ok(None)) => {}
        Ok(Err(error)) => eprintln!("Agent usage: could not record a run: {error}"),
        Err(error) => eprintln!("Agent usage: recording a run aborted: {error}"),
    }
}

/// Longest a decoded chunk waits in the batch before it is emitted.
const OUTPUT_BATCH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(32);

/// A batch this large is emitted at once instead of waiting out the interval.
const OUTPUT_FLUSH_BYTES: usize = 16384;

/// Drains the PTY reader's channel into batched `emit` calls until it closes.
/// Returns whether any bytes arrived at all.
///
/// With a `holdback` the run's final JSON result line never reaches `emit`:
/// prose goes through as it arrives, the result is replaced by its answer text
/// when the stream ends (`agent_usage::holdback`). The caller keeps the
/// holdback and takes the parsed result from it afterwards.
///
/// Batching bounds: a chunk is emitted with the batch at once when the batch
/// passes `OUTPUT_FLUSH_BYTES` or `interval` has passed since the last emit;
/// otherwise it waits at most until `last_emit + interval`. Closing the
/// channel flushes the rest, decoder tail included. With nothing buffered the
/// task only waits on the channel, so an idle agent costs no timer wake-ups.
async fn pump_agent_output<F, Fut>(
    rx: &mut tokio::sync::mpsc::Receiver<Vec<u8>>,
    interval: std::time::Duration,
    mut holdback: Option<&mut ResultHoldback>,
    mut emit: F,
) -> bool
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let mut decoder = crate::utf8_stream::Utf8StreamDecoder::new();
    let mut accum = String::new();
    let mut has_produced_output = false;
    let mut last_emit = tokio::time::Instant::now();

    loop {
        let data = if accum.is_empty() {
            rx.recv().await
        } else {
            tokio::select! {
                data = rx.recv() => data,
                _ = tokio::time::sleep_until(last_emit + interval) => {
                    emit(std::mem::take(&mut accum)).await;
                    last_emit = tokio::time::Instant::now();
                    continue;
                }
            }
        };
        let Some(bytes) = data else { break };
        has_produced_output = true;
        accum.push_str(&shown(&mut holdback, &decoder.push(&bytes)));
        if accum.len() > OUTPUT_FLUSH_BYTES || last_emit.elapsed() >= interval {
            emit(std::mem::take(&mut accum)).await;
            last_emit = tokio::time::Instant::now();
        }
    }

    accum.push_str(&shown(&mut holdback, &decoder.finish()));
    if let Some(holdback) = holdback {
        accum.push_str(&holdback.finish());
    }
    if !accum.is_empty() {
        emit(accum).await;
    }
    has_produced_output
}

/// What of `text` the console gets to see now.
fn shown(holdback: &mut Option<&mut ResultHoldback>, text: &str) -> String {
    match holdback {
        Some(holdback) => holdback.push(text),
        None => text.to_string(),
    }
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
    // Finished now, not when the PTY closes: a grandchild that inherited the
    // PTY can keep it open long after the agent itself is gone.
    if let Some(buffers) = app.try_state::<super::output_buffer::OutputBuffersState>() {
        buffers.finish(agent_id, AgentStatus::Idle);
    }
    // Tokens spent before a kill were spent, so the run is booked from its
    // transcript. Off this call: the kill answers now, the row follows.
    if let Some(capture) = process.usage.take() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            book_usage(
                &app,
                capture,
                Outcome::Killed,
                None,
                EvidenceWait::Poll(EXIT_EVIDENCE_WAIT),
            )
            .await
        });
    }
    let verdict = process
        .launch_request_uid
        .as_deref()
        .map(|uid| super::launch_runs::killed(uid, agent_id));
    super::launch_runs::end(app, agent_id, verdict);

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

/// Longest the app's shutdown waits for the runs still alive to be booked.
const SHUTDOWN_BOOKING_BUDGET: std::time::Duration = std::time::Duration::from_secs(2);

pub async fn cleanup_all_agents(app: AppHandle) {
    let state = app.state::<AgentManagerState>();
    let captures: Vec<UsageCapture> = {
        let mut manager = state.lock().await;
        manager
            .agents
            .drain()
            .filter_map(|(_, process)| process.usage)
            .collect()
    };
    book_at_shutdown(&app, captures).await;
}

/// The runs that were alive when the app quit are booked as killed: tokens
/// spent before the quit were spent. Their transcripts are read within the
/// budget; a run that does not make it is booked without tokens rather than
/// not at all.
async fn book_at_shutdown(app: &AppHandle, captures: Vec<UsageCapture>) {
    let deadline = tokio::time::Instant::now() + SHUTDOWN_BOOKING_BUDGET;
    for capture in captures {
        let read = book_usage(
            app,
            capture.clone(),
            Outcome::Killed,
            None,
            EvidenceWait::Now,
        );
        if tokio::time::timeout_at(deadline, read).await.is_err() {
            book_usage(app, capture, Outcome::Killed, None, EvidenceWait::Skip).await;
        }
    }
}

#[cfg(test)]
mod output_pump_tests {
    use super::{pump_agent_output, ResultHoldback, OUTPUT_FLUSH_BYTES};
    use std::time::{Duration, Instant};
    use tokio::sync::mpsc;

    type Emitted = mpsc::UnboundedReceiver<(Instant, String)>;

    /// Runs the pump on its own task; every emit lands on the returned channel.
    fn start(
        interval: Duration,
    ) -> (
        mpsc::Sender<Vec<u8>>,
        Emitted,
        tokio::task::JoinHandle<bool>,
    ) {
        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(256);
        let (out_tx, out_rx) = mpsc::unbounded_channel();
        let pump = tokio::spawn(async move {
            pump_agent_output(&mut rx, interval, None, move |data| {
                let out = out_tx.clone();
                async move {
                    let _ = out.send((Instant::now(), data));
                }
            })
            .await
        });
        (tx, out_rx, pump)
    }

    async fn next(out: &mut Emitted) -> (Instant, String) {
        tokio::time::timeout(Duration::from_secs(5), out.recv())
            .await
            .expect("an emit within 5 s")
            .expect("pump still has its emitter")
    }

    #[tokio::test]
    async fn quick_chunks_merge_and_flush_at_the_deadline_while_the_channel_is_open() {
        let interval = Duration::from_millis(60);
        let started = Instant::now();
        let (tx, mut out, pump) = start(interval);
        tx.send(b"ab".to_vec()).await.unwrap();
        tx.send(b"cd".to_vec()).await.unwrap();

        let (at, text) = next(&mut out).await;
        assert_eq!(text, "abcd");
        assert!(at - started >= interval, "held for the batch interval");

        drop(tx);
        assert!(pump.await.unwrap());
        assert!(out.recv().await.is_none(), "nothing left after the flush");
    }

    #[tokio::test]
    async fn a_batch_over_the_threshold_is_emitted_without_waiting() {
        let (tx, mut out, pump) = start(Duration::from_secs(3600));
        let big = vec![b'x'; OUTPUT_FLUSH_BYTES + 1];
        tx.send(big).await.unwrap();

        let (_, text) = next(&mut out).await;
        assert_eq!(text.len(), OUTPUT_FLUSH_BYTES + 1);
        drop(tx);
        assert!(pump.await.unwrap());
    }

    #[tokio::test]
    async fn closing_the_channel_flushes_the_batch_and_the_decoder_tail() {
        let (tx, mut out, pump) = start(Duration::from_secs(3600));
        tx.send(vec![b'w', 0xC3]).await.unwrap();
        tx.send(vec![0xA4, b'r', 0xE2]).await.unwrap();
        drop(tx);

        assert!(pump.await.unwrap());
        let mut all = String::new();
        while let Ok((_, text)) = out.try_recv() {
            all.push_str(&text);
        }
        assert_eq!(all, "wär\u{FFFD}");
    }

    #[tokio::test]
    async fn a_run_without_bytes_reports_no_output_and_emits_nothing() {
        let (tx, mut out, pump) = start(Duration::from_millis(10));
        tokio::time::sleep(Duration::from_millis(50)).await;
        drop(tx);
        assert!(!pump.await.unwrap());
        assert!(out.recv().await.is_none());
    }

    #[tokio::test]
    async fn a_chunk_after_an_idle_interval_is_emitted_on_arrival() {
        let interval = Duration::from_millis(30);
        let (tx, mut out, pump) = start(interval);
        tokio::time::sleep(interval * 3).await;
        let sent = Instant::now();
        tx.send(b"late".to_vec()).await.unwrap();

        let (at, text) = next(&mut out).await;
        assert_eq!(text, "late");
        assert!(
            at - sent < interval,
            "no extra batching after an idle spell"
        );
        drop(tx);
        assert!(pump.await.unwrap());
    }

    /// The pump with a holdback, which also hands back what the holdback read.
    fn start_holding_back() -> (
        mpsc::Sender<Vec<u8>>,
        Emitted,
        tokio::task::JoinHandle<Option<crate::agent_usage::claude::CliResult>>,
    ) {
        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(256);
        let (out_tx, out_rx) = mpsc::unbounded_channel();
        let pump = tokio::spawn(async move {
            let mut holdback = ResultHoldback::default();
            pump_agent_output(
                &mut rx,
                Duration::from_millis(5),
                Some(&mut holdback),
                move |data| {
                    let out = out_tx.clone();
                    async move {
                        let _ = out.send((Instant::now(), data));
                    }
                },
            )
            .await;
            holdback.take_result()
        });
        (tx, out_rx, pump)
    }

    async fn everything_emitted(mut out: Emitted) -> String {
        let mut all = String::new();
        while let Some((_, text)) = out.recv().await {
            all.push_str(&text);
        }
        all
    }

    const RESULT_LINE: &str = include_str!("../agent_usage/fixtures/claude-result.json");

    #[tokio::test]
    async fn prose_flows_while_the_result_line_is_held_and_then_replaced_by_prose() {
        let (tx, mut out, pump) = start_holding_back();
        tx.send(b"thinking...\r\n".to_vec()).await.unwrap();
        let (_, first) = next(&mut out).await;
        assert_eq!(first, "thinking...\r\n", "prose is not held back");

        tx.send(RESULT_LINE.trim_end().as_bytes().to_vec())
            .await
            .unwrap();
        tx.send(b"\r\n".to_vec()).await.unwrap();
        drop(tx);

        let result = pump
            .await
            .unwrap()
            .expect("the result object was recognised");
        assert_eq!(result.cost_usd(), Some(0.12199465));
        assert_eq!(
            everything_emitted(out).await,
            "hello\r\n\u{2014} 187.6k tokens \u{b7} $0.12 \u{b7} 1 turn\r\n"
        );
    }

    #[tokio::test]
    async fn a_line_that_only_looks_like_json_is_emitted_raw_when_the_run_ends() {
        let (tx, out, pump) = start_holding_back();
        tx.send(b"{ not json at all\r\n".to_vec()).await.unwrap();
        drop(tx);

        assert!(pump.await.unwrap().is_none());
        assert_eq!(everything_emitted(out).await, "{ not json at all\r\n");
    }

    #[tokio::test]
    async fn a_multibyte_character_cut_in_two_chunks_still_reaches_the_holdback_whole() {
        let (tx, out, pump) = start_holding_back();
        tx.send(vec![b'w', 0xC3]).await.unwrap();
        tx.send(vec![0xA4, b'r', b'\n']).await.unwrap();
        drop(tx);

        pump.await.unwrap();
        assert_eq!(everything_emitted(out).await, "w\u{e4}r\n");
    }
}
