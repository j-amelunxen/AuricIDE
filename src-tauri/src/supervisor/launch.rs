//! Supervisor launch admission, CLI/MCP isolation, manager booking and resume adoption.
//!
//! The agent runtime calls these hooks at the same process boundaries as before;
//! the supervisor module owns their policy and persisted identity semantics.

use crate::agents::{AgentConfig, AgentInfo, AgentManager, AgentRole, OwnedFile};
use crate::providers::ProviderRegistryState;
use tauri::{AppHandle, Emitter, Manager};

/// What a Project Manager's launch records: the manager and the instructions
/// text its prompt starts with (`None`: no file).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchToBook {
    pub key: String,
    pub instructions: Option<String>,
    /// A supervisor restored after an app restart: a new session, no launch.
    pub restored: bool,
}

/// The supervisor's one MCP server, and the tool pattern pre-approved for it.
pub const SUPERVISOR_MCP_SERVER: &str = "auric-supervisor";

/// What a supervisor spawn always runs with, whatever the caller asked for:
/// interactive, in its own folder, bound to no project, in Claude's
/// `default` permission mode so its own Bash and Edit calls ask the human.
pub fn supervisor_config(mut config: AgentConfig, cwd: &std::path::Path) -> AgentConfig {
    config.cwd = Some(cwd.to_string_lossy().into_owned());
    config.project_path = None;
    config.headless = Some(false);
    config.permission_mode = Some("default".to_string());
    config.dangerously_ignore_permissions = Some(false);
    config.auto_accept_edits = Some(false);
    config.launch_request_uid = None;
    config.agent_notification_uid = None;
    config.agent_notification_action_id = None;
    config
}

pub const SUPERVISOR_PROVIDERS: [&str; 2] = ["claude", "codex"];

pub fn check_supervisor_provider(provider_id: &str) -> Result<(), String> {
    if SUPERVISOR_PROVIDERS.contains(&provider_id) {
        Ok(())
    } else {
        Err(format!(
            "The supervisor supports Claude Code and Codex in this version; '{provider_id}' cannot run it."
        ))
    }
}

/// Codex flags for a supervisor: `-c` overrides for its one server, `auric-supervisor`.
pub fn supervisor_codex_arguments(
    runtime: &std::path::Path,
    socket: &std::path::Path,
    pm_child_env: &std::collections::BTreeMap<String, String>,
    node: &str,
) -> Result<Vec<String>, String> {
    let runtime_str =
        serde_json::to_string(&runtime.to_string_lossy()).map_err(|e| e.to_string())?;
    let node_str = serde_json::to_string(node).map_err(|e| e.to_string())?;
    let sup_args =
        format!("mcp_servers.{SUPERVISOR_MCP_SERVER}.args=[{runtime_str},\"--supervisor\"]");
    let sup_env = format!(
        "mcp_servers.{SUPERVISOR_MCP_SERVER}.env={}",
        crate::providers::toml_inline_table(&crate::mcp::supervisor_server_env(
            socket,
            pm_child_env
        )?)?
    );
    Ok(vec![
        "-c".to_string(),
        crate::providers::shell_quote_argument(&format!(
            "mcp_servers.{SUPERVISOR_MCP_SERVER}.command={node_str}"
        )),
        "-c".to_string(),
        crate::providers::shell_quote_argument(&sup_args),
        "-c".to_string(),
        crate::providers::shell_quote_argument(&sup_env),
        "-c".to_string(),
        crate::providers::shell_quote_argument(&format!(
            "mcp_servers.{SUPERVISOR_MCP_SERVER}.required=true"
        )),
        "-c".to_string(),
        crate::providers::shell_quote_argument(&format!(
            "mcp_servers.{SUPERVISOR_MCP_SERVER}.default_tools_approval_mode=\"approve\""
        )),
    ])
}

/// Claude Code flags for a supervisor (ADR 0004). `--tools` names the only
/// built-in tools it has: the file tools, `Skill`, `ToolSearch` (many MCP
/// tools load deferred, and without it they are out of reach), and `Bash`
/// for background sleep timers. Other shell commands require an approved skill
/// or tool pattern. PM tools of its projects run through `pm_call` on its own
/// server. Claude in Chrome is pre-approved when the policy switches it on
/// (`chrome`). `--restricted` confines the file tools
/// to the working directory (the run folder), ignores the user's, project's
/// and local settings files, so allow rules such as `Bash(npx:*)` there do
/// not apply, and loads no skills from disk; the approved ones come in through
/// `--plugin-dir`. `dontAsk` refuses whatever `--allowedTools` does not name,
/// so a shell command outside the skills' patterns is refused, not asked.
/// `--mcp-config`, `--tools`, `--plugin-dir` and `--allowedTools` take several
/// values, so each is followed by another flag rather than by the task.
/// Checked against Claude Code 2.1.301.
pub fn supervisor_claude_arguments(
    mcp_config_path: &str,
    skills: &crate::supervisor::SkillPlugin,
    chrome: bool,
    denied_tools: &[String],
) -> Vec<String> {
    let quoted = |value: &str| {
        format!(
            "\"{}\"",
            crate::providers::shell_escape_double_quoted(value)
        )
    };
    let mut tools = SUPERVISOR_FILE_TOOLS.to_vec();
    tools.push("Bash");
    let mut arguments = vec![
        "--mcp-config".to_string(),
        quoted(mcp_config_path),
        "--strict-mcp-config".to_string(),
        "--tools".to_string(),
        quoted(&tools.join(",")),
        "--restricted".to_string(),
    ];
    if let Some(dir) = &skills.dir {
        arguments.push("--plugin-dir".to_string());
        arguments.push(quoted(&dir.to_string_lossy()));
    }
    if !skills.dirs.is_empty() {
        arguments.push("--add-dir".to_string());
        arguments.extend(skills.dirs.iter().map(|dir| quoted(dir)));
    }
    arguments.push("--allowedTools".to_string());
    arguments.push(quoted(&format!("mcp__{SUPERVISOR_MCP_SERVER}__*")));
    if chrome {
        arguments.push(quoted(&format!("mcp__{CHROME_MCP_SERVER}__*")));
    }
    arguments.extend(SUPERVISOR_FILE_TOOLS.iter().map(|tool| tool.to_string()));
    // run_in_background changes delivery, not the command permission rule.
    arguments.push(quoted("Bash(sleep *)"));
    arguments.extend(
        skills
            .bash
            .iter()
            .map(|pattern| quoted(&format!("Bash({pattern})"))),
    );
    // Explicit either way: the user's Claude Code may enable Chrome by itself.
    arguments.push(if chrome { "--chrome" } else { "--no-chrome" }.to_string());
    if !denied_tools.is_empty() {
        arguments.push(DENIED_TOOLS_FLAG.to_string());
        arguments.extend(denied_tools.iter().map(|rule| quoted(rule)));
    }
    arguments.push("--permission-mode".to_string());
    arguments.push("dontAsk".to_string());
    arguments
}

/// Fixture `instructions.denyFlag`. Takes several values, so it is followed by
/// another flag, never by the task.
const DENIED_TOOLS_FLAG: &str = "--disallowedTools";

/// A Project Manager may not change its own instructions: they are the
/// human's, and the prompt alone is no proof (fixture `instructions.denyRules`,
/// checked against the real CLI).
pub fn manager_denied_tools() -> Vec<String> {
    ["Edit", "Write"]
        .iter()
        .map(|tool| {
            format!(
                "{tool}(./{})",
                crate::supervisor::managers::INSTRUCTIONS_FILE_NAME
            )
        })
        .collect()
}

/// The MCP server name Claude Code gives its Chrome integration.
pub const CHROME_MCP_SERVER: &str = "claude-in-chrome";

/// The built-in tools every supervisor has. They reach only its run folder.
pub const SUPERVISOR_FILE_TOOLS: [&str; 7] = [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "Skill",
    "ToolSearch",
];

/// The deny rules of a run that belongs to a Project Manager, none for any
/// other. A registry that cannot be read says "none": a manager folder cannot
/// have got this far, `admit_supervisor` refuses its resume first, and a new
/// run folder is never one.
fn manager_denied_tools_for_run(app_data: &std::path::Path, run_name: &str) -> Vec<String> {
    let registry = app_data.join(crate::supervisor::managers::REGISTRY_FILE_NAME);
    let is_manager = crate::supervisor::managers::launch_candidates(&registry)
        .is_ok_and(|managers| managers.iter().any(|manager| manager.run_dir == run_name));
    if is_manager {
        manager_denied_tools()
    } else {
        Vec::new()
    }
}

/// Binds a supervisor to its own MCP server (`auric-mcp --supervisor`) and
/// nothing else, and hands it the skills the policy approves.
pub(crate) fn bind_to_supervisor_mcp(
    spawn_cmd: crate::providers::SpawnCommand,
    app: &AppHandle,
    provider_id: &str,
    cwd: Option<&str>,
    node: &str,
) -> Result<(crate::providers::SpawnCommand, OwnedFile), String> {
    let runtime = crate::mcp::runtime_entrypoint(app)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("The supervisor needs the app data directory: {error}"))?;
    let run_name = cwd
        .and_then(|cwd| std::path::Path::new(cwd).file_name())
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The supervisor has no run folder.".to_string())?;
    let policy = crate::supervisor::current_policy(&app_data);
    let denied_tools = manager_denied_tools_for_run(&app_data, run_name);
    let mut skills = crate::supervisor::build_skill_plugin(&app_data, run_name, &policy.skills)?;
    crate::supervisor::apply_tool_grants(&mut skills, &policy.tools);
    // For the project servers `pm_call` starts. No AURIC_AGENT_CWD:
    // `request_agent_launch` stays refused, so every agent a supervisor starts
    // goes through `spawn_agent` and the policy.
    let pm_child_env = crate::mcp::agent_mcp_server_env(
        Some(&crate::notifications::db_path_in(&app_data)),
        app.try_state::<ProviderRegistryState>()
            .as_deref()
            .map(|registry| registry.as_ref()),
        None,
    );
    let config_file = OwnedFile(crate::mcp::ensure_supervisor_mcp_config(
        &app_data,
        &runtime,
        &pm_child_env,
        node,
    )?);
    let arguments = if provider_id == "codex" {
        supervisor_codex_arguments(
            &runtime,
            &crate::control_socket::socket_path_in(&app_data),
            &pm_child_env,
            node,
        )?
    } else {
        supervisor_claude_arguments(
            &config_file.0.to_string_lossy(),
            &skills,
            policy.supervisor.chrome,
            &denied_tools,
        )
    };
    Ok((
        spawn_cmd.with_injection(crate::providers::SpawnInjection {
            arguments,
            env_vars: Vec::new(),
        }),
        config_file,
    ))
}

/// The first gate of every spawn, before anything is resolved or opened
/// (ADR 0004). A supervisor spawn gets its fixed shape (`supervisor_config`);
/// a spawn that names the supervisor that asked for it is checked against the
/// supervisor policy again. The dispatcher checked before the frontend saw
/// the request; this holds whatever route the spawn took from there.
///
/// `app_data` is where the policy file lives, `home` where the supervisor's
/// run folders go; without them, both kinds of spawn are refused rather than
/// run unchecked.
pub struct AdmissionInputs<'a> {
    pub app_data: Option<&'a std::path::Path>,
    pub home: Option<&'a std::path::Path>,
    pub agents: &'a [AgentInfo],
    pub offered: &'a std::collections::BTreeMap<String, Vec<String>>,
    pub modes_for: &'a dyn Fn(
        &super::policy::SupervisorPolicy,
    )
        -> std::collections::BTreeMap<String, super::policy::ProviderModes>,
}

pub fn admit(mut config: AgentConfig, inputs: AdmissionInputs<'_>) -> Result<AgentConfig, String> {
    let AdmissionInputs {
        app_data,
        home,
        agents,
        offered,
        modes_for,
    } = inputs;
    let needs_app_data = || {
        app_data.ok_or_else(|| {
            "The app data directory is unavailable; a supervisor spawn cannot be checked"
                .to_string()
        })
    };
    if config.role() == AgentRole::Supervisor {
        return admit_supervisor(config, app_data, home, agents);
    }
    if config.supervisor_key.is_some() {
        return Err(crate::supervisor::several::WORKER_KEY_MESSAGE.to_string());
    }
    let Some(supervisor_id) = config.spawned_by_agent_id.clone() else {
        return Ok(config);
    };
    let app_data = needs_app_data()?;
    let policy = crate::supervisor::current_policy(app_data);
    let quota_blocks = crate::quota_blocks::store::active_blocks(app_data);
    let project = config
        .project_path
        .as_deref()
        .map(crate::project_path::canonical_project_path);
    let project_policy = project
        .as_deref()
        .map(|path| crate::provider_policy::policy_for_project(std::path::Path::new(path)))
        .unwrap_or_default();
    // Counting resolves each child's project path. Keep that filesystem
    // snapshot before modes_for, just as the original process gate did.
    let running = crate::supervisor::running_children(agents, &supervisor_id);
    let modes = modes_for(&policy);
    super::admission::ChildAdmission::new(
        running,
        &policy,
        &project_policy,
        offered,
        &modes,
        &quota_blocks,
    )
    .check_config(&config, project.as_deref())?;
    // Booked as the supervisor's, whatever the frontend said.
    config.run_source = Some(crate::control_socket::protocol::RUN_SOURCE_SUPERVISOR.to_string());
    Ok(config)
}

/// A supervisor spawn: its run folder (new, or an earlier one no live
/// supervisor works in) and its key (its own, else on a resume the run's;
/// well formed and free among the live supervisors), written back to the run
/// folder so the next resume finds it.
///
/// A run folder and a key that belong to a Project Manager are one thing
/// (`several::manager_launch`, fixture `launchKey`): the launch runs as that
/// manager, under its name, and books the instructions it starts with.
fn admit_supervisor(
    mut config: AgentConfig,
    app_data: Option<&std::path::Path>,
    home: Option<&std::path::Path>,
    agents: &[AgentInfo],
) -> Result<AgentConfig, String> {
    use crate::supervisor::{managers, several};
    if config.spawned_by_agent_id.is_some() {
        return Err("A supervisor cannot start another supervisor.".to_string());
    }
    let home = home.ok_or_else(|| {
        "The home directory is unavailable; the supervisor has nowhere to work".to_string()
    })?;
    let requested_dir = config.resume_run_dir.take();
    let requested_key = config.supervisor_key.take();
    let registry = app_data.map(|dir| dir.join(managers::REGISTRY_FILE_NAME));
    let candidates = if requested_dir.is_some() || requested_key.is_some() {
        let registry = registry.as_deref().ok_or_else(|| {
            "The app data directory is unavailable; a Project Manager cannot be looked up"
                .to_string()
        })?;
        managers::launch_candidates(registry)?
    } else {
        Vec::new()
    };
    let runs_root = crate::supervisor::supervisor_runs_root(home);
    let resume_dir = requested_dir
        .map(|requested| {
            crate::supervisor::reuse_supervisor_run_dir(home, &requested).map_err(|error| {
                managers::missing_manager_folder(&candidates, &runs_root, &requested)
                    .unwrap_or(error)
            })
        })
        .transpose()?;
    let resume_folder = resume_dir
        .as_deref()
        .and_then(|dir| dir.file_name())
        .map(|name| name.to_string_lossy().into_owned());
    let manager = several::manager_launch(
        &candidates,
        resume_folder.as_deref(),
        requested_key.as_deref(),
    )?;
    // A key that opens a manager's folder is checked before the folder: the
    // client named the key, so "key in use" is the answer it can act on.
    if let (Some(manager), None) = (manager, &resume_dir) {
        several::check_key(agents, &manager.key)?;
    }
    let resuming = resume_dir.is_some() || manager.is_some();
    let cwd = match (resume_dir, manager) {
        (Some(dir), _) => dir,
        (None, Some(manager)) => {
            let folder = managers::resolve_manager_run(&runs_root, &manager.run_dir)?;
            crate::supervisor::reuse_supervisor_run_dir(home, &folder.to_string_lossy())?
        }
        (None, None) => {
            let started = chrono::Local::now().format("%Y-%m-%d_%H%M%S").to_string();
            crate::supervisor::new_supervisor_run_dir(home, &started)?
        }
    };
    if resuming {
        if let Some(holder) = several::run_dir_holder(agents, &cwd) {
            return Err(several::run_dir_in_use_message(&cwd, &holder.id));
        }
    }
    let own_key = manager.map(|m| m.key.clone()).or(requested_key);
    let from_run = own_key.is_none();
    let key = several::launch_key(own_key, &cwd, resuming);
    // A key the folder merely remembers must not turn a plain run into a
    // manager: the key is the manager's address, and only its own folder answers.
    if let (None, true, Some(key)) = (manager, from_run, key.as_deref()) {
        if let Some(holder) = candidates.iter().find(|m| m.key == key) {
            return Err(several::manager_key_reserved_message(
                &holder.key,
                &holder.name,
            ));
        }
    }
    if let Some(key) = key.as_deref() {
        match several::live_supervisor_with_key(agents, key) {
            Some(holder) if from_run => {
                return Err(several::run_key_in_use_message(&cwd, key, &holder.id));
            }
            _ => several::check_key(agents, key)?,
        }
    }
    if let (Some(manager), Some(registry)) = (manager, registry.as_deref()) {
        let instructions = managers::read_instructions(registry, &runs_root, &manager.key)?;
        // A restored session replays the prompt it started with, so what
        // it was launched with is not these instructions: it books a new
        // session and leaves the launch as it was.
        config.launch_to_book = Some(LaunchToBook {
            key: manager.key.clone(),
            restored: config.replaces_agent_id.is_some(),
            instructions,
        });
        config.name = manager.name.clone();
    }
    // The key is an address, not something the run depends on: a folder that
    // cannot take the file still runs, it only forgets the key on a resume.
    if let Err(error) = several::write_run_key(&cwd, key.as_deref()) {
        eprintln!("Supervisor: {error}");
    }
    config.supervisor_key = key;
    config.resumed_run_dir = resuming.then(|| cwd.to_string_lossy().into_owned());
    Ok(supervisor_config(config, &cwd))
}

/// Books the launch of a Project Manager once its process really runs, so a
/// spawn that failed on the way leaves `lastLaunch` as it was.
pub(crate) fn book_manager_launch(app: &AppHandle, booking: &LaunchToBook) {
    let Ok(app_data) = app.path().app_data_dir() else {
        return;
    };
    let registry = app_data.join(crate::supervisor::managers::REGISTRY_FILE_NAME);
    if let Err(error) = apply_booking(&registry, booking) {
        eprintln!("Project Manager: {error}");
    }
}

/// A restore books a new session only; any other start books the launch too.
fn apply_booking(registry: &std::path::Path, booking: &LaunchToBook) -> Result<(), String> {
    use crate::supervisor::managers;
    if booking.restored {
        managers::record_session_start(registry, &booking.key)
    } else {
        managers::record_launch(registry, &booking.key, booking.instructions.as_deref())
    }
}

/// A supervisor that resumed a run takes over the children of the
/// supervisors that worked there before it: on the running agents, in the
/// restart file and in the kept results, and the frontend is told so its
/// list follows (`supervisor::several::CHILDREN_ADOPTED_EVENT`). Without
/// this a resumed supervisor would see none of its earlier children.
pub(crate) fn adopt_children(
    app: &AppHandle,
    manager: &mut AgentManager,
    run_dir: &str,
    replaces: Option<&str>,
    new_id: &str,
) {
    let persistence = app.try_state::<crate::agent_persistence::AgentPersistenceState>();
    let results = app.try_state::<crate::agents::run_results::RunResultsState>();
    adopt_into(
        manager.infos_mut(),
        persistence.as_deref(),
        results.as_deref().map(|results| results.as_ref()),
        (run_dir, replaces, new_id),
        |adoption| {
            let _ = app.emit(crate::supervisor::several::CHILDREN_ADOPTED_EVENT, adoption);
        },
    );
}

/// The checks of `admit_spawn` again, over the manager's list at the moment
/// the started supervisor is entered into it. The loser of a race is stopped
/// (`kill`) before the refusal is returned, so it never runs unlisted.
pub(crate) fn refuse_late_supervisor(
    live: &[AgentInfo],
    config: &AgentConfig,
    kill: impl FnOnce(),
) -> Result<(), String> {
    let checked = crate::supervisor::several::recheck(
        live,
        config.supervisor_key.as_deref(),
        config.resumed_run_dir.as_deref(),
    );
    if checked.is_err() {
        kill();
    }
    checked
}

/// `adopt_children` without the app: the live agents, the restart file and
/// the kept results, then `emit` once with what moved. `target` is the run
/// folder, the id the supervisor replaces by name, and its new id.
fn adopt_into<'a>(
    live: impl IntoIterator<Item = &'a mut AgentInfo>,
    persistence: Option<&crate::agent_persistence::AgentPersistenceState>,
    results: Option<&crate::agents::run_results::RunResults>,
    (run_dir, replaces, new_id): (&str, Option<&str>, &str),
    emit: impl FnOnce(&crate::supervisor::several::Adoption),
) -> Option<crate::supervisor::several::Adoption> {
    use crate::supervisor::several::{adoption_for, Earlier};
    let persisted: Vec<crate::agent_persistence::PersistedAgent> = persistence
        .and_then(|state| state.lock().ok().map(|p| p.agents().cloned().collect()))
        .unwrap_or_default();
    let finished = results
        .map(|results| results.finished_agents())
        .unwrap_or_default();
    let earlier = persisted
        .iter()
        .map(|agent| Earlier {
            id: &agent.id,
            role: agent.role,
            cwd: agent.cwd.as_deref(),
        })
        .chain(finished.iter().map(|agent| Earlier {
            id: &agent.id,
            role: Some(agent.role),
            cwd: agent.repo_path.as_deref(),
        }));
    let adoption = adoption_for(std::path::Path::new(run_dir), new_id, replaces, earlier)?;
    for info in live {
        adoption.apply(&mut info.spawned_by_agent_id);
    }
    if let Some(state) = persistence {
        let saved = state
            .lock()
            .map_err(|_| "Agent persistence is unavailable".to_string())
            .and_then(|mut p| p.adopt_children(&adoption));
        if let Err(error) = saved {
            eprintln!("Agent persistence: {error}");
        }
    }
    if let Some(results) = results {
        results.adopt_children(&adoption);
    }
    emit(&adoption);
    Some(adoption)
}

#[cfg(test)]
#[path = "launch_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "manager_deny_tui_tests.rs"]
mod manager_deny_tui_tests;
