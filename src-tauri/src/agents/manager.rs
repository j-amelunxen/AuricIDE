use super::persistence::{persisted_from_config, persistence_record_spawn};
use super::project_binding::resolve_project_binding;

use crate::machine::cached_login_shell_env;

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
        if !crate::auric_env::is_project_binding(key) {
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
use super::pty::{AgentPty, PendingAgentPty, TerminalState, DEFAULT_PTY_COLS, DEFAULT_PTY_ROWS};
use super::types::*;
use crate::agent_persistence::AgentPersistenceState;
use crate::agent_usage::capture::UsageCapture;
use crate::agent_usage::holdback::ResultHoldback;
use crate::providers::ProviderRegistryState;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

pub async fn list_agents_impl(state: &AgentManagerState) -> Vec<AgentInfo> {
    let manager = state.lock().await;
    manager.agents.values().map(|p| p.info.clone()).collect()
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
        None => providers.default_provider(),
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

async fn resolved_mcp_node(runtime: &std::path::Path) -> String {
    let path_var = crate::machine::path_from_env(cached_login_shell_env().await);
    crate::node_runtime::command_for_mcp(runtime, &path_var)
}

/// The project's extra MCP servers (`extraMcpServers` in its supervisor rules,
/// definitions from `.mcp.json`) that this provider can carry. Whatever is
/// left out is reported by name and reason on stderr, never with a value.
fn resolve_extra_mcp(
    app: &AppHandle,
    binding: Option<&super::project_binding::ResolvedProjectBinding>,
    is_supervisor: bool,
    provider: (&str, &dyn crate::providers::AgentProvider),
) -> Result<Vec<crate::extra_mcp::ExtraMcpServer>, String> {
    let Some(binding) = binding.filter(|_| !is_supervisor) else {
        return Ok(Vec::new());
    };
    let Ok(app_data) = app.path().app_data_dir() else {
        return Ok(Vec::new());
    };
    let (provider_id, provider) = provider;
    let mut resolved = crate::extra_mcp::resolve(
        &crate::supervisor::current_policy(&app_data),
        binding.project_root(),
    );
    let mcp_binding = provider.mcp_binding();
    if !resolved.servers.is_empty() && !mcp_binding.reads_mcp_config() {
        resolved
            .skipped
            .extend(
                resolved
                    .servers
                    .drain(..)
                    .map(|server| crate::extra_mcp::Skipped {
                        name: server.name,
                        reason: format!("provider {provider_id} reads no MCP config file"),
                    }),
            );
    }
    let resolved = crate::extra_mcp::for_provider(mcp_binding, resolved);
    for skipped in &resolved.skipped {
        eprintln!(
            "Extra MCP server {} not started for {provider_id}: {}",
            skipped.name, skipped.reason
        );
    }
    Ok(resolved.servers)
}

/// Binds a spawn to its project's Auric MCP server: one private config per
/// agent, the provider's launch material, and the reserved Auric variables.
/// The server's environment (`crate::mcp::agent_mcp_server_env`) is computed
/// once and handed to every provider path.
// code-gate: complexity-parameter-count - the spawn's already-resolved inputs, each a distinct fact
#[allow(clippy::too_many_arguments)]
fn bind_to_project_mcp(
    spawn_cmd: crate::providers::SpawnCommand,
    app: &AppHandle,
    binding: &super::project_binding::ResolvedProjectBinding,
    provider: (&str, &dyn crate::providers::AgentProvider),
    cwd: Option<&str>,
    connectors: &[crate::connectors::ResolvedConnector],
    extras: &[crate::extra_mcp::ExtraMcpServer],
    node: &str,
    supervised: bool,
) -> Result<crate::providers::SpawnCommand, String> {
    let runtime_entrypoint = crate::mcp::runtime_entrypoint(app)?;
    let notifications_db = app
        .path()
        .app_data_dir()
        .ok()
        .map(|app_data| crate::notifications::db_path_in(&app_data));
    let agent_cwd = crate::mcp::canonical_agent_cwd(cwd);
    let mut mcp_env = crate::mcp::agent_mcp_server_env(
        notifications_db.as_deref(),
        app.try_state::<ProviderRegistryState>()
            .as_deref()
            .map(|registry| registry.as_ref()),
        agent_cwd.as_deref(),
    );
    if supervised {
        if let Ok(app_data) = app.path().app_data_dir() {
            crate::mcp::offer_ask_supervisor(&mut mcp_env, &app_data);
        }
    }
    let mcp_configs = crate::mcp::ensure_agent_mcp_config(
        app,
        binding.project_root(),
        &mcp_env,
        connectors,
        extras,
        node,
    )?;
    let mut provider_binding = binding
        .provider_binding()
        .with_mcp_config_path(mcp_configs.standard.to_string_lossy().into_owned())
        .with_crush_config_path(mcp_configs.crush.to_string_lossy().into_owned())
        .with_runtime_entrypoint(runtime_entrypoint.to_string_lossy().into_owned())
        .with_mcp_command(node)
        .with_mcp_env(mcp_env);
    provider_binding.connectors = connectors.to_vec();
    provider_binding.extra_servers = extras.to_vec();
    let (provider_id, provider) = provider;
    // Spawning honours `allowUnboundMcp`; the provider list handed to MCP
    // (`mcp::agent_providers_env`) deliberately does not, so agents started
    // over MCP only ever get providers bound to this project.
    let provider_injection = crate::providers::binding_injection_for(
        provider_id,
        crate::providers::project_binding_material(provider, &provider_binding)?,
        provider.allows_unbound_mcp(),
    )?;
    let connector_filter =
        crate::providers::connector_tool_filter_injection(runs_claude_code(&spawn_cmd), connectors);
    let spawn_cmd = spawn_cmd
        .with_injection(provider_injection)
        .with_injection(connector_filter);
    // Reserved Auric variables are applied after provider material so a
    // provider config cannot accidentally point MCP at a different project.
    Ok(spawn_cmd.with_injection(crate::providers::SpawnInjection {
        arguments: Vec::new(),
        env_vars: {
            let mut env = binding.environment();
            if let Some(path) = notifications_db.as_ref() {
                env.push((
                    crate::auric_env::NOTIFICATIONS_DB.to_string(),
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
    crate::notifications::with_inbox(app, "a launch request cannot be checked", |conn| {
        super::launch_dir::check_launch_directory(conn, request_uid, cwd)
    })
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
    crate::notifications::with_inbox(app, "a Start button cannot be checked", |conn| {
        super::launch_dir::check_agent_notification_directory(
            conn,
            uid,
            action_id,
            config.cwd.as_deref(),
        )
    })
}

// code-gate: complexity-cyclomatic, complexity-function-length - existing PTY setup plus output pump; sub-goal 09 moved the MCP binding out, splitting the pump is its own refactor
pub async fn spawn_agent_impl(
    config: AgentConfig,
    state: &AgentManagerState,
    terminals: &TerminalState,
    app: &AppHandle,
    providers: &ProviderRegistryState,
) -> Result<(AgentInfo, PendingAgentPty), String> {
    let config = crate::supervisor::admit(
        config,
        crate::supervisor::AdmissionInputs {
            app_data: app.path().app_data_dir().ok().as_deref(),
            home: dirs::home_dir().as_deref(),
            agents: &list_agents_impl(state).await,
            offered: &crate::supervisor::model_names(&crate::supervisor::offered_models(
                providers.as_ref(),
            )),
            modes_for: &|policy| crate::supervisor::provider_modes(providers.as_ref(), policy),
        },
    )?;
    let is_supervisor = config.role() == AgentRole::Supervisor;

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
            rows: DEFAULT_PTY_ROWS,
            cols: DEFAULT_PTY_COLS,
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
    if is_supervisor {
        crate::supervisor::launch::check_supervisor_provider(provider_id)?;
    }
    // Refuse models the CLI no longer accepts. Supervisor policy already
    // filters via model_names; this covers every other spawn path (UI, retry,
    // notification Start) so a stale last-launch default cannot reach the CLI.
    let provider_info = provider.info();
    crate::providers::model_catalog::refuse_unavailable_model(
        &provider_info.name,
        provider_id,
        &config.model,
        &provider_info.models,
    )?;

    // Only the canonical logical project selects grants. No cwd, task, env or kv_store fallback.
    let mut connectors = if !is_supervisor {
        project_binding
            .as_ref()
            .map(|binding| {
                app.path()
                    .app_data_dir()
                    .map(|dir| {
                        crate::connectors::resolve(
                            &crate::supervisor::current_policy(&dir),
                            binding.project_root(),
                        )
                    })
                    .unwrap_or_default()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    if project_binding.is_some() {
        connectors = crate::connectors::for_provider(connectors, provider.as_ref());
    }
    let extra_mcp = resolve_extra_mcp(
        app,
        project_binding.as_ref(),
        is_supervisor,
        (provider_id, provider.as_ref()),
    )?;
    let extra_mcp_names: Vec<String> = extra_mcp.iter().map(|s| s.name.clone()).collect();
    let launch_task = crate::connectors::launch_context(&config.task, &connectors);

    // Removed with the agent's process entry, or here if the spawn fails.
    let mut launch_file: Option<OwnedFile> = None;
    let usage_config = provider.usage_config();
    let (mut spawn_cmd, usage_session_id) = crate::agent_usage::launch::with_session_id(
        provider.build_spawn_command(
            &config.model,
            &launch_task,
            config.permission_mode.as_deref(),
            config.dangerously_ignore_permissions.unwrap_or(false),
            config.auto_accept_edits.unwrap_or(false),
            config.headless.unwrap_or(false),
        ),
        usage_config.as_ref(),
    );
    if is_supervisor {
        let node = resolved_mcp_node(&crate::mcp::runtime_entrypoint(app)?).await;
        let (bound, config_file) = crate::supervisor::launch::bind_to_supervisor_mcp(
            spawn_cmd,
            app,
            provider_id,
            config.cwd.as_deref(),
            &node,
        )?;
        spawn_cmd = bound;
        launch_file = Some(config_file);
    } else if let Some(binding) = project_binding.as_ref() {
        let node = resolved_mcp_node(&crate::mcp::runtime_entrypoint(app)?).await;
        spawn_cmd = bind_to_project_mcp(
            spawn_cmd,
            app,
            binding,
            (provider_id, provider.as_ref()),
            config.cwd.as_deref(),
            &connectors,
            &extra_mcp,
            &node,
            config.spawned_by_agent_id.is_some(),
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
    if is_supervisor {
        let live: Vec<AgentInfo> = manager.agents.values().map(|p| p.info.clone()).collect();
        crate::supervisor::launch::refuse_late_supervisor(&live, &config, || {
            let _ = child.kill();
        })?;
    }
    let id = match manager.next_id() {
        Ok(id) => id,
        Err(error) => {
            let _ = child.kill();
            return Err(error);
        }
    };

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
    let adoption_run_dir = config.resumed_run_dir.clone();
    let replaces = config.replaces_agent_id.clone();
    let launch_to_book = config.launch_to_book.clone();
    let info = AgentInfo {
        role: config.role(),
        spawned_by_agent_id: config.spawned_by_agent_id.clone(),
        supervisor_key: config.supervisor_key.clone(),
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
        extra_mcp_servers: extra_mcp_names,
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

    let pty = AgentPty::new(&id, terminals);
    let pending_pty = pty.prepare(writer, pair.master);
    let pty_for_cleanup = pty.clone();
    let process = AgentSession {
        info: info.clone(),
        pty,
        child,
        launch_request_uid: launch_request_uid.clone(),
        usage: usage.clone(),
        launch_file,
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
    let run_results = app
        .try_state::<super::run_results::RunResultsState>()
        .map(|results| results.inner().clone());
    let finished_info = info.clone();

    tauri::async_runtime::spawn(async move {
        // One counter for everything this agent emits, the error line below
        // included.
        let mut emitted = OutputOffset::default();
        let has_produced_output =
            pump_agent_output(&mut rx, OUTPUT_BATCH_INTERVAL, holdback.as_mut(), |data| {
                if let Some(capture) = &sniffing_usage {
                    capture.sniff(&data);
                }
                if let Some(buffers) = &output_buffers {
                    buffers.append(&id_clone, &data);
                }
                let end_offset = emitted.advance(&data);
                emit_agent_output(&app_clone, &id_clone, &rp_clone, data, end_offset)
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
            let end_offset = emitted.advance(&error_msg);

            let _ = app_clone.emit(
                super::types::AGENT_OUTPUT_EVENT,
                AgentOutputEvent {
                    agent_id: id_clone.clone(),
                    stream: "stderr".to_string(),
                    line: error_msg,
                    timestamp,
                    repo_path: rp_clone.clone(),
                    end_offset,
                },
            );
        }

        let proc_opt = claim_agent(&state_clone, &id_clone).await;
        let report_exit = proc_opt.is_some();

        let (exit_code, raw_exit, finished_info) = match proc_opt {
            Some(mut process) => {
                let info = process.info;
                // The UI keeps its 0 / 1 / -1; the raw status goes to the
                // exit log, because 1 also stands for "killed by a signal".
                let (code, raw) = tokio::task::spawn_blocking(move || match process.child.wait() {
                    Ok(status) => (
                        if status.success() { 0 } else { 1 },
                        Some(super::exit_log::RawExit::new(
                            status.exit_code(),
                            status.signal(),
                        )),
                    ),
                    Err(_) => (-1, None),
                })
                .await
                .unwrap_or((-1, None));
                (code, raw, info)
            }
            None => (0, None, finished_info),
        };
        super::finish::finish_agent(
            super::finish::Context {
                app: &app_clone,
                buffers: output_buffers.as_ref(),
                results: run_results.as_ref(),
            },
            super::finish::Run {
                info: finished_info,
                usage,
                cli_result,
                launch_request_uid,
            },
            super::finish::How::Exit {
                exit_code,
                raw: raw_exit,
                claimed: report_exit,
            },
        )
        .await;
        pty_for_cleanup.remove();
    });

    if let Some(run_dir) = adoption_run_dir.as_deref() {
        crate::supervisor::launch::adopt_children(
            app,
            &mut manager,
            run_dir,
            replaces.as_deref(),
            &id,
        );
    }
    manager.agents.insert(id, process);
    if let Some(booking) = launch_to_book {
        crate::supervisor::launch::book_manager_launch(app, &booking);
    }

    Ok((info, pending_pty))
}

/// Publishes the process's PTY and then re-checks under the manager lock.
/// An immediate exit may clean up before publication; that late registration
/// must not resurrect its writer. Keep this two-phase order with the exit pump.
pub async fn spawn_agent_with_session(
    config: AgentConfig,
    state: &AgentManagerState,
    terminals: &TerminalState,
    providers: &ProviderRegistryState,
    app: AppHandle,
) -> Result<AgentInfo, String> {
    let (info, pending) = spawn_agent_impl(config, state, terminals, &app, providers).await?;
    publish_agent_pty(&info.id, pending, state).await;
    Ok(info)
}

async fn publish_agent_pty(id: &str, pending: PendingAgentPty, state: &AgentManagerState) {
    let pty = pending.publish();
    let manager = state.lock().await;
    if !manager.agents.contains_key(id) {
        pty.remove();
    }
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
    end_offset: u64,
) {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let _ = app.emit(
        super::types::AGENT_OUTPUT_EVENT,
        AgentOutputEvent {
            agent_id: id.to_string(),
            stream: "stdout".to_string(),
            line: data,
            timestamp,
            repo_path: repo_path.clone(),
            end_offset,
        },
    );
}

/// The first process remover owns its usage/result/launch ending.
async fn claim_agent(state: &AgentManagerState, agent_id: &str) -> Option<AgentSession> {
    state.lock().await.agents.remove(agent_id)
}

async fn claim_killed_agent(
    state: &AgentManagerState,
    agent_id: &str,
) -> Result<Option<AgentSession>, String> {
    let mut manager = state.lock().await;
    let Some(process) = manager.agents.get_mut(agent_id) else {
        return Ok(None);
    };
    // Keep the process and its registration available on a native failure.
    // EOF uses this same lock, so it cannot miss a remove/reinsert window.
    // portable-pty's Unix kill may spend its bounded SIGHUP grace here.
    process
        .child
        .kill()
        .map_err(|error| format!("Could not stop agent {agent_id}: {error}"))?;
    let process = manager.agents.remove(agent_id);
    drop(manager);
    // A writer's Drop can re-enter the manager (or another spawn can join).
    // Never drop it while holding the manager lock.
    if let Some(process) = &process {
        process.pty.remove();
    }
    Ok(process)
}

pub async fn kill_agent_impl(
    agent_id: &str,
    state: &AgentManagerState,
    terminals: &TerminalState,
    app: &AppHandle,
) -> Result<(), String> {
    let Some(process) = claim_killed_agent(state, agent_id).await? else {
        AgentPty::new(agent_id, terminals).remove();
        return Err(format!("Agent not found: {}", agent_id));
    };
    finish_killed_agent(process, app).await;
    Ok(())
}

async fn finish_killed_agent(mut process: AgentSession, app: &AppHandle) {
    let buffers = app.try_state::<super::output_buffer::OutputBuffersState>();
    let results = app.try_state::<super::run_results::RunResultsState>();
    super::finish::finish_agent(
        super::finish::Context {
            app,
            buffers: buffers.as_deref(),
            results: results.as_deref(),
        },
        super::finish::Run {
            info: process.info,
            usage: process.usage.take(),
            cli_result: None,
            launch_request_uid: process.launch_request_uid,
        },
        super::finish::How::Kill,
    )
    .await;
}

#[cfg(test)]
#[path = "kill_tests.rs"]
mod kill_tests;

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

/// Longest the app's shutdown waits for the runs still alive to be booked.
const SHUTDOWN_BOOKING_BUDGET: std::time::Duration = std::time::Duration::from_secs(2);

pub async fn cleanup_all_agents(app: AppHandle) {
    let state = app.state::<AgentManagerState>();
    let drained: Vec<(AgentInfo, Option<UsageCapture>)> = {
        let mut manager = state.lock().await;
        manager
            .agents
            .drain()
            .map(|(_, process)| (process.info, process.usage))
            .collect()
    };
    book_at_shutdown(&app, drained).await;
}

/// The runs that were alive when the app quit are booked as killed: tokens
/// spent before the quit were spent. Their transcripts are read within the
/// budget; a run that does not make it is booked without tokens rather than
/// not at all.
async fn book_at_shutdown(app: &AppHandle, runs: Vec<(AgentInfo, Option<UsageCapture>)>) {
    let deadline = tokio::time::Instant::now() + SHUTDOWN_BOOKING_BUDGET;
    let finished_at = chrono::Utc::now();
    for (info, capture) in runs {
        super::finish::finish_agent(
            super::finish::Context {
                app,
                buffers: None,
                results: None,
            },
            super::finish::Run {
                info,
                usage: capture,
                cli_result: None,
                launch_request_uid: None,
            },
            super::finish::How::Quit {
                deadline,
                finished_at,
            },
        )
        .await;
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

#[cfg(test)]
mod session_tests {
    use super::*;
    use portable_pty::{Child, ChildKiller, ExitStatus};
    use std::future::{poll_fn, Future};
    use std::task::Poll;

    #[derive(Debug)]
    struct TestChild;

    impl ChildKiller for TestChild {
        fn kill(&mut self) -> std::io::Result<()> {
            Ok(())
        }
        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(Self)
        }
    }

    impl Child for TestChild {
        fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
            Ok(None)
        }
        fn wait(&mut self) -> std::io::Result<ExitStatus> {
            Ok(ExitStatus::with_exit_code(0))
        }
        fn process_id(&self) -> Option<u32> {
            None
        }
        #[cfg(windows)]
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
            None
        }
    }

    fn session(id: &str, repo: &str, terminals: &TerminalState) -> AgentSession {
        AgentSession {
            info: super::super::tests::session_info(id, Some(repo)),
            child: Box::new(TestChild),
            pty: AgentPty::new(id, terminals),
            launch_request_uid: None,
            usage: None,
            launch_file: None,
        }
    }

    fn pending(pty: &AgentPty) -> PendingAgentPty {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        pty.prepare(Box::new(Vec::new()), pair.master)
    }

    #[tokio::test]
    async fn exit_before_publication_cannot_resurrect_a_terminal() {
        let terminals = TerminalState::default();
        let state = new_agent_manager_state();
        let pty = AgentPty::new("agent-1", &terminals);
        let pending = pending(&pty);
        pty.remove(); // output pump cleaned up before spawn's late publication
        publish_agent_pty("agent-1", pending, &state).await;
        assert!(terminals.sessions.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn exit_between_publication_and_manager_recheck_leaves_no_writer() {
        let terminals = TerminalState::default();
        let state = new_agent_manager_state();
        let mut manager = state.lock().await;
        let process = session("agent-1", "/repo", &terminals);
        let pty = process.pty.clone();
        let pending = pending(&pty);
        manager.agents.insert("agent-1".into(), process);
        let mut publication = Box::pin(publish_agent_pty("agent-1", pending, &state));
        poll_fn(|cx| {
            assert!(
                publication.as_mut().poll(cx).is_pending(),
                "recheck waits for manager"
            );
            Poll::Ready(())
        })
        .await;
        assert_eq!(
            terminals.sessions.lock().unwrap().len(),
            1,
            "writer published first"
        );
        manager.agents.remove("agent-1");
        pty.remove(); // kill/exit cleanup while publication is waiting
        drop(manager);
        publication.await;
        assert!(terminals.sessions.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_live_agent_keeps_its_published_writer_and_only_one_ending_claims_it() {
        let terminals = TerminalState::default();
        let state = new_agent_manager_state();
        let process = session("agent-1", "/repo", &terminals);
        let pending = pending(&process.pty);
        state.lock().await.agents.insert("agent-1".into(), process);
        publish_agent_pty("agent-1", pending, &state).await;
        assert_eq!(terminals.sessions.lock().unwrap().len(), 1);
        let (exit, kill) = tokio::join!(
            claim_agent(&state, "agent-1"),
            claim_agent(&state, "agent-1")
        );
        assert_eq!(usize::from(exit.is_some()) + usize::from(kill.is_some()), 1);
        exit.or(kill).unwrap().pty.remove();
        assert!(terminals.sessions.lock().unwrap().is_empty());
    }
}
