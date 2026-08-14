use crate::agent_persistence::{AgentPersistenceState, PersistedAgent};
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
        .get_or_init(resolve_login_shell_env)
        .await
        .as_slice()
}

/// Shell + flags used to harvest the user's shell environment. `.zshrc`
/// (where user PATH entries like `~/.local/bin` or nvm typically live) is
/// only sourced by *interactive* shells — a plain login shell (`-lc`) misses
/// those entries, which made packaged builds fail to find CLIs that dev
/// runs (inheriting the terminal's PATH) found fine.
fn login_shell_invocation(interactive: bool) -> Option<(&'static str, &'static str)> {
    if cfg!(target_os = "windows") {
        None
    } else if cfg!(target_os = "macos") {
        Some(("/bin/zsh", if interactive { "-ilc" } else { "-lc" }))
    } else {
        // POSIX sh has no interactive rc convention worth sourcing here.
        Some(("sh", "-lc"))
    }
}

async fn resolve_login_shell_env() -> Vec<(String, String)> {
    if cfg!(target_os = "windows") {
        return Vec::new();
    }

    let mut env = harvest_shell_env(true).await;
    // Interactive rc files can misbehave without a TTY — if the harvest
    // produced no usable PATH, retry with a non-interactive login shell.
    if !env.iter().any(|(k, _)| k == "PATH") {
        env = harvest_shell_env(false).await;
    }
    // Never end up with less than the PATH this process inherited: terminal
    // launches (dev) already carry the full user PATH, and if both harvests
    // failed this is the only PATH we have.
    let inherited = std::env::var("PATH").ok();
    apply_inherited_path(&mut env, inherited.as_deref());
    env
}

async fn harvest_shell_env(interactive: bool) -> Vec<(String, String)> {
    let Some((shell, flag)) = login_shell_invocation(interactive) else {
        return Vec::new();
    };

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(8),
        tokio::process::Command::new(shell)
            .arg(flag)
            .arg("command env -0")
            .stdin(std::process::Stdio::null())
            .output(),
    )
    .await;

    match output {
        Ok(Ok(out)) if out.status.success() => parse_env_output(&out.stdout),
        _ => Vec::new(),
    }
}

fn parse_env_output(bytes: &[u8]) -> Vec<(String, String)> {
    String::from_utf8_lossy(bytes)
        .split('\0')
        .filter_map(|entry| entry.split_once('='))
        .filter(|(k, _)| is_valid_env_key(k))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

/// Interactive shells may print rc-file noise to stdout before the `env -0`
/// output; only accept entries whose key is a valid env var name.
fn is_valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Union of both PATH strings, deduplicated, harvested entries first.
fn merge_path(harvested: Option<&str>, inherited: Option<&str>) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut merged: Vec<&str> = Vec::new();
    for path in [harvested, inherited].into_iter().flatten() {
        for segment in path.split(':').filter(|s| !s.is_empty()) {
            if seen.insert(segment) {
                merged.push(segment);
            }
        }
    }
    merged.join(":")
}

fn apply_inherited_path(env: &mut Vec<(String, String)>, inherited: Option<&str>) {
    let harvested = env
        .iter()
        .find(|(k, _)| k == "PATH")
        .map(|(_, v)| v.clone());
    let merged = merge_path(harvested.as_deref(), inherited);
    if merged.is_empty() {
        return;
    }
    if let Some(entry) = env.iter_mut().find(|(k, _)| k == "PATH") {
        entry.1 = merged;
    } else {
        env.push(("PATH".to_string(), merged));
    }
}

// ── Restart persistence ─────────────────────────────────────────────

/// Snapshot of a spawn config for the restart-persistence file.
fn persisted_from_config(
    config: &AgentConfig,
    id: &str,
    provider_id: &str,
    started_at: u64,
) -> PersistedAgent {
    PersistedAgent {
        id: id.to_string(),
        name: config.name.clone(),
        model: config.model.clone(),
        provider: provider_id.to_string(),
        task: config.task.clone(),
        cwd: config.cwd.clone(),
        permission_mode: config.permission_mode.clone(),
        dangerously_ignore_permissions: config.dangerously_ignore_permissions.unwrap_or(false),
        auto_accept_edits: config.auto_accept_edits.unwrap_or(false),
        headless: config.headless.unwrap_or(false),
        started_at,
        spawned_by_ticket_id: config.spawned_by_ticket_id.clone(),
        spawned_by_goal_id: config.spawned_by_goal_id.clone(),
    }
}

fn persistence_record_spawn(app: &AppHandle, agent: PersistedAgent) {
    if let Some(state) = app.try_state::<AgentPersistenceState>() {
        if let Ok(mut p) = state.lock() {
            p.record_spawn(agent);
        }
    }
}

fn persistence_record_exit(app: &AppHandle, agent_id: &str) {
    if let Some(state) = app.try_state::<AgentPersistenceState>() {
        if let Ok(mut p) = state.lock() {
            p.record_exit(agent_id);
        }
    }
}

/// Wraps an interrupted agent's original task in a continuation preamble.
/// Provider-agnostic: the resumed process starts a fresh session, so it must
/// be told that earlier progress may already exist in the working tree.
pub fn resume_task_prompt(original_task: &str) -> String {
    format!(
        "You are resuming work that was interrupted by an IDE restart. \
         The original task was:\n\n{}\n\nFirst inspect the repository's current \
         state — part of the work may already be done. Then continue from where \
         the previous run left off instead of starting over.",
        original_task
    )
}

// ── list_agents ─────────────────────────────────────────────────────

pub async fn list_agents_impl(state: &AgentManagerState) -> Result<Vec<AgentInfo>, String> {
    let manager = state.lock().await;
    let infos: Vec<AgentInfo> = manager.agents.values().map(|p| p.info.clone()).collect();
    Ok(infos)
}

// ── spawn_agent ─────────────────────────────────────────────────────

/// Resolves the provider a spawn will really use, then holds it against the
/// project's policy.
///
/// Resolution has to come first. An unrecognised id falls back to the registry
/// default, so checking the *requested* name would let a deny list be dodged by
/// naming a provider that does not exist — by a typo as easily as by a caller
/// that never learned the policy exists. What is checked, persisted and shown
/// is therefore the id that actually resolved.
fn resolve_permitted_provider(
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

    // Before anything is opened or spawned: may this provider run in this
    // project at all? The check lives here rather than in the dialogs because
    // this is the one path every agent takes — the conductor, a retry, a
    // resumed run and a notification action all arrive here too.
    let policy = match config.cwd.as_deref() {
        Some(cwd) => crate::provider_policy::policy_for_project(std::path::Path::new(cwd)),
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

    // Persist the spawn config BEFORE its fields move into `info`, so the
    // agent can be restored (as interrupted) after an app restart.
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
        // PTY reads split multi-byte UTF-8 across chunks; decoding each chunk
        // independently corrupts umlauts/box-drawing into U+FFFD and shifts
        // every following terminal cell.
        let mut decoder = crate::utf8_stream::Utf8StreamDecoder::new();
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
                            accum.push_str(&decoder.push(&bytes));

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

        // The agent ended on its own — it must not reappear after a restart.
        persistence_record_exit(&app_clone, &id_clone);

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

    // Explicitly killed agents must not reappear after a restart.
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

// ── rename_agent ────────────────────────────────────────────────────

/// Gives a running agent a human-chosen name. Every agent spawned into the
/// same repo would otherwise carry the same generated name, which makes a
/// fleet unreadable. The new name is written to both the live agent and the
/// persistence file, so it also survives a restart-and-resume.
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
    use crate::provider_policy::ProviderPolicy;
    use crate::providers::new_provider_registry;

    // The registry's contents depend on which dynamic-providers directory is
    // reachable, so these tests pin nothing but "crush is always there" and
    // whatever the registry itself calls its default.
    fn registry_and_default() -> (ProviderRegistryState, String) {
        let registry = new_provider_registry(None);
        let default_id = registry.default_provider().info().id;
        (registry, default_id)
    }

    fn deny(ids: &[&str]) -> ProviderPolicy {
        ProviderPolicy {
            allow: None,
            deny: ids.iter().map(|id| id.to_string()).collect(),
        }
    }

    #[test]
    fn permits_a_provider_when_no_policy_is_set() {
        let (registry, _) = registry_and_default();

        let (id, _) =
            resolve_permitted_provider(Some("crush"), &registry, &ProviderPolicy::default())
                .expect("an unconfigured project permits everything");

        assert_eq!(id, "crush");
    }

    #[test]
    fn refuses_a_denied_provider() {
        let (registry, _) = registry_and_default();

        let error = resolve_permitted_provider(Some("crush"), &registry, &deny(&["crush"]))
            .err()
            .expect("a denied provider must not spawn");

        // The message has to name the provider — it surfaces in an agent's
        // error row, where "not permitted" alone would say nothing.
        assert!(error.contains("crush"), "unhelpful message: {}", error);
    }

    #[test]
    fn refuses_the_default_when_no_provider_was_requested() {
        let (registry, default_id) = registry_and_default();

        assert!(
            resolve_permitted_provider(None, &registry, &deny(&[&default_id])).is_err(),
            "falling back to the default must not dodge the policy"
        );
    }

    #[test]
    fn an_unknown_provider_name_cannot_slip_past_a_deny_list() {
        // The heart of the gate. An unknown id falls back to the registry
        // default, so checking the *requested* name would let any caller past a
        // deny list by naming a provider that does not exist.
        let (registry, default_id) = registry_and_default();

        assert!(
            resolve_permitted_provider(
                Some("not-a-real-provider"),
                &registry,
                &deny(&[&default_id])
            )
            .is_err(),
            "the resolved provider is what must be checked"
        );
    }

    #[test]
    fn an_allow_list_admits_its_members_and_no_one_else() {
        let (registry, default_id) = registry_and_default();
        let only_default = ProviderPolicy {
            allow: Some(vec![default_id.clone()]),
            deny: Vec::new(),
        };

        let (id, _) = resolve_permitted_provider(None, &registry, &only_default)
            .expect("the allowed provider spawns");
        assert_eq!(id, default_id);

        if default_id != "crush" {
            assert!(
                resolve_permitted_provider(Some("crush"), &registry, &only_default).is_err(),
                "a provider outside the allow list must not spawn"
            );
        }
    }

    #[test]
    fn reports_the_provider_that_actually_resolved() {
        // What gets persisted and shown must be what ran, or Retry relaunches
        // something other than the row the user clicked.
        let (registry, default_id) = registry_and_default();

        let (id, _) = resolve_permitted_provider(
            Some("not-a-real-provider"),
            &registry,
            &ProviderPolicy::default(),
        )
        .expect("an unknown name still falls back");

        assert_eq!(id, default_id);
    }

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
    fn test_persisted_from_config_captures_all_spawn_fields() {
        let config = AgentConfig {
            name: "Agent (alpha)".to_string(),
            model: "opus".to_string(),
            task: "fix the login flow".to_string(),
            cwd: Some("/repo".to_string()),
            permission_mode: Some("acceptEdits".to_string()),
            dangerously_ignore_permissions: None,
            auto_accept_edits: Some(true),
            provider: Some("claude".to_string()),
            headless: Some(false),
            spawned_by_ticket_id: Some("ticket-7".to_string()),
            spawned_by_goal_id: None,
        };
        let persisted = persisted_from_config(&config, "agent-4", "claude", 123);
        assert_eq!(persisted.id, "agent-4");
        assert_eq!(persisted.name, "Agent (alpha)");
        assert_eq!(persisted.model, "opus");
        assert_eq!(persisted.provider, "claude");
        assert_eq!(persisted.task, "fix the login flow");
        assert_eq!(persisted.cwd.as_deref(), Some("/repo"));
        assert_eq!(persisted.permission_mode.as_deref(), Some("acceptEdits"));
        assert!(!persisted.dangerously_ignore_permissions);
        assert!(persisted.auto_accept_edits);
        assert!(!persisted.headless);
        assert_eq!(persisted.started_at, 123);
        assert_eq!(persisted.spawned_by_ticket_id.as_deref(), Some("ticket-7"));
        assert!(persisted.spawned_by_goal_id.is_none());
    }

    #[test]
    fn test_resume_task_prompt_embeds_original_task_and_continuation_hint() {
        let prompt = resume_task_prompt("build the parser");
        assert!(prompt.contains("build the parser"));
        assert!(prompt.contains("interrupted by an IDE restart"));
        assert!(prompt.contains("continue from where the previous run left off"));
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

    #[test]
    fn test_parse_env_output_skips_rc_noise_with_invalid_keys() {
        // Interactive shells may print rc-file noise (echos, prompt setup)
        // to stdout before `env -0` output. Anything whose key is not a
        // valid env var name must be dropped.
        let raw = b"welcome message\0not a var=oops\09LEADING=x\0FOO=bar\0_UNDER=1\0";
        let parsed = parse_env_output(raw);
        assert_eq!(
            parsed,
            vec![
                ("FOO".to_string(), "bar".to_string()),
                ("_UNDER".to_string(), "1".to_string()),
            ]
        );
    }

    #[test]
    fn test_merge_path_unions_and_dedupes_preserving_harvested_order() {
        assert_eq!(merge_path(Some("/a:/b:/c"), Some("/b:/d")), "/a:/b:/c:/d");
    }

    #[test]
    fn test_merge_path_falls_back_to_inherited_when_harvest_missing() {
        assert_eq!(merge_path(None, Some("/x:/y")), "/x:/y");
    }

    #[test]
    fn test_merge_path_keeps_harvested_when_inherited_missing() {
        assert_eq!(merge_path(Some("/a:/b"), None), "/a:/b");
    }

    #[test]
    fn test_merge_path_skips_empty_segments() {
        assert_eq!(merge_path(Some("/a::/b:"), Some(":/c")), "/a:/b:/c");
    }

    #[test]
    fn test_apply_inherited_path_extends_harvested_path_entry() {
        let mut env = vec![
            ("FOO".to_string(), "bar".to_string()),
            ("PATH".to_string(), "/harvest/bin".to_string()),
        ];
        apply_inherited_path(&mut env, Some("/harvest/bin:/proc/bin"));
        assert_eq!(
            env.iter()
                .find(|(k, _)| k == "PATH")
                .map(|(_, v)| v.as_str()),
            Some("/harvest/bin:/proc/bin")
        );
    }

    #[test]
    fn test_apply_inherited_path_inserts_path_when_harvest_lacks_one() {
        let mut env = vec![("FOO".to_string(), "bar".to_string())];
        apply_inherited_path(&mut env, Some("/proc/bin"));
        assert_eq!(
            env.iter()
                .find(|(k, _)| k == "PATH")
                .map(|(_, v)| v.as_str()),
            Some("/proc/bin")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_login_shell_invocation_uses_interactive_flag_on_macos() {
        // .zshrc (where user PATH entries like ~/.local/bin typically live)
        // is only sourced by *interactive* shells, so the harvest must be
        // able to run one.
        assert_eq!(login_shell_invocation(true), Some(("/bin/zsh", "-ilc")));
        assert_eq!(login_shell_invocation(false), Some(("/bin/zsh", "-lc")));
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
