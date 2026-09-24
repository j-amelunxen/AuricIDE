use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::Manager;

pub fn runtime_entrypoint(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not resolve MCP runtime directory: {error}"))?;
    let packaged = resource_dir.join("auric-mcp").join("server.mjs");
    let development = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("auric-mcp")
        .join("server.mjs");
    if packaged.is_file() {
        Ok(packaged)
    } else if development.is_file() {
        Ok(development)
    } else {
        Err("The packaged Auric MCP runtime is missing; run `pnpm mcp:bundle`".to_string())
    }
}

pub struct AgentMcpConfigs {
    pub standard: PathBuf,
    pub crush: PathBuf,
}

static AGENT_CONFIG_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn write_new_private_file(path: &Path, content: &[u8]) -> Result<(), String> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("Could not create private agent MCP config: {error}"))?;
    std::io::Write::write_all(&mut file, content)
        .map_err(|error| format!("Could not write private agent MCP config: {error}"))
}

/// Writes immutable provider configs used by one logical project.
/// The file lives in app data, never in the user's repository, and contains
/// one package-owned runtime plus one canonical project root.
pub fn ensure_agent_mcp_config(
    app: &tauri::AppHandle,
    project_root: &Path,
) -> Result<AgentMcpConfigs, String> {
    let runtime = runtime_entrypoint(app)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve agent MCP config directory: {error}"))?;
    let directory = app_data.join("agent-bindings");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create agent MCP config directory: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Could not secure agent MCP config directory: {error}"))?;
    }

    let mut hasher = DefaultHasher::new();
    project_root.hash(&mut hasher);
    std::process::id().hash(&mut hasher);
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .hash(&mut hasher);
    AGENT_CONFIG_SEQUENCE
        .fetch_add(1, Ordering::Relaxed)
        .hash(&mut hasher);
    let identity = hasher.finish();
    let standard_path = directory.join(format!("project-{identity:016x}.mcp.json"));
    let crush_path = directory.join(format!("project-{identity:016x}.crush.json"));
    let mut server = serde_json::json!({
        "command": "node",
        "args": [runtime.clone(), "--project-root", project_root],
    });
    if let Ok(notifications_dir) = app.path().app_data_dir() {
        server["env"] = serde_json::json!({
            "AURIC_NOTIFICATIONS_DB": crate::notifications::db_path_in(&notifications_dir)
        });
    }
    let content = serde_json::to_vec_pretty(&serde_json::json!({
        "mcpServers": { "auric-pm": server }
    }))
    .map_err(|error| format!("Could not serialize agent MCP config: {error}"))?;
    write_new_private_file(&standard_path, &content)?;
    let crush_content = serde_json::to_vec_pretty(&serde_json::json!({
        "$schema": "https://charm.land/crush.json",
        "mcp": {
            "auric-pm": {
                "type": "stdio",
                "command": "node",
                "args": [runtime, "--project-root", project_root],
                "timeout": 30
            }
        }
    }))
    .map_err(|error| format!("Could not serialize Crush MCP config: {error}"))?;
    write_new_private_file(&crush_path, &crush_content)?;

    Ok(AgentMcpConfigs {
        standard: standard_path,
        crush: crush_path,
    })
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum McpServerStatus {
    Running,
    Stopped,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum McpServerPhase {
    Running,
    Stopped,
    Error,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpStatusInfo {
    pub status: McpServerStatus,
    pub phase: McpServerPhase,
    pub pid: Option<u32>,
    pub project_path: Option<String>,
    pub error: Option<String>,
}

struct ManagedMcpProcess {
    child: Child,
    project_path: String,
}

#[derive(Default)]
struct McpRuntime {
    process: Option<ManagedMcpProcess>,
    last_error: Option<String>,
    generation: u64,
}

pub struct McpServerState {
    runtime: Mutex<McpRuntime>,
}

impl McpServerState {
    pub fn new() -> Self {
        Self {
            runtime: Mutex::new(McpRuntime::default()),
        }
    }

    #[cfg(test)]
    pub(crate) fn start_with<F>(
        &self,
        project_path: &str,
        spawn: F,
    ) -> Result<McpStatusInfo, String>
    where
        F: FnOnce() -> Result<Child, String>,
    {
        let generation = self.reserve_start()?;
        self.start_reserved_with(generation, project_path, spawn)
    }

    pub(crate) fn reserve_start(&self) -> Result<u64, String> {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "MCP server state lock is poisoned".to_string())?;
        runtime.generation = runtime.generation.wrapping_add(1);
        Ok(runtime.generation)
    }

    pub(crate) fn start_reserved_with<F>(
        &self,
        generation: u64,
        project_path: &str,
        spawn: F,
    ) -> Result<McpStatusInfo, String>
    where
        F: FnOnce() -> Result<Child, String>,
    {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "MCP server state lock is poisoned".to_string())?;
        if generation != runtime.generation {
            return Err("MCP start was superseded by a newer lifecycle request".to_string());
        }
        refresh_runtime(&mut runtime);

        if let Some(process) = runtime.process.as_mut() {
            if process.project_path == project_path {
                return Ok(runtime_status(&runtime));
            }

            if let Err(error) = stop_mcp_server(&mut process.child) {
                runtime.last_error = Some(error.clone());
                return Err(error);
            }
            runtime.process = None;
            runtime.last_error = None;
        }

        match spawn() {
            Ok(child) => {
                runtime.process = Some(ManagedMcpProcess {
                    child,
                    project_path: project_path.to_string(),
                });
                runtime.last_error = None;
                Ok(runtime_status(&runtime))
            }
            Err(error) => {
                runtime.last_error = Some(error.clone());
                Err(error)
            }
        }
    }

    pub(crate) fn stop_with<F>(&self, stop: F) -> Result<(), String>
    where
        F: FnOnce(&mut Child) -> Result<(), String>,
    {
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "MCP server state lock is poisoned".to_string())?;
        runtime.generation = runtime.generation.wrapping_add(1);
        refresh_runtime(&mut runtime);

        let Some(process) = runtime.process.as_mut() else {
            runtime.last_error = None;
            return Ok(());
        };

        match stop(&mut process.child) {
            Ok(()) => {
                runtime.process = None;
                runtime.last_error = None;
                Ok(())
            }
            Err(error) => {
                runtime.last_error = Some(error.clone());
                Err(error)
            }
        }
    }

    pub fn status(&self) -> McpStatusInfo {
        let Ok(mut runtime) = self.runtime.lock() else {
            return McpStatusInfo {
                status: McpServerStatus::Stopped,
                phase: McpServerPhase::Error,
                pid: None,
                project_path: None,
                error: Some("MCP server state lock is poisoned".to_string()),
            };
        };
        refresh_runtime(&mut runtime);
        runtime_status(&runtime)
    }
}

impl Default for McpServerState {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for McpServerState {
    fn drop(&mut self) {
        // `std::process::Child` does not terminate on drop. The supervisor owns
        // this process tree, so application shutdown must not orphan `npx` or
        // its Node descendant.
        let _ = self.stop_with(stop_mcp_server);
    }
}

#[cfg(test)]
fn start_mcp_server(
    db_path: &str,
    script_path: &str,
    env: &[(String, String)],
) -> Result<Child, String> {
    // Resolve `npx` against the login-shell PATH we were handed: the parent
    // process PATH is minimal when the packaged app is launched from Finder
    // and typically lacks nvm/homebrew node installs.
    let npx = env
        .iter()
        .find(|(k, _)| k == "PATH")
        .and_then(|(_, path)| find_in_path("npx", path))
        .unwrap_or_else(|| PathBuf::from("npx"));

    let mut command = Command::new(npx);
    command
        .args(["tsx", script_path, db_path])
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start MCP server: {}", e))?;

    drain_pipes(&mut child);

    std::thread::sleep(std::time::Duration::from_millis(200));
    match child.try_wait() {
        Ok(Some(status)) => {
            return Err(format!(
                "MCP server exited during startup with status {status}"
            ));
        }
        Ok(None) => {}
        Err(error) => {
            let _ = stop_mcp_server(&mut child);
            return Err(format!(
                "Failed to inspect MCP server during startup: {error}"
            ));
        }
    }

    Ok(child)
}

pub fn start_packaged_mcp_server(
    runtime: &Path,
    project_root: &Path,
    env: &[(String, String)],
) -> Result<Child, String> {
    let node = env
        .iter()
        .find(|(key, _)| key == "PATH")
        .and_then(|(_, path)| find_in_path("node", path))
        .ok_or_else(|| "Could not find Node.js in the login-shell PATH".to_string())?;
    let mut command = Command::new(node);
    command
        .arg(runtime)
        .arg("--project-root")
        .arg(project_root)
        .envs(
            env.iter()
                .map(|(key, value)| (key.as_str(), value.as_str())),
        )
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start packaged MCP server: {error}"))?;
    drain_pipes(&mut child);
    std::thread::sleep(std::time::Duration::from_millis(200));
    match child.try_wait() {
        Ok(Some(status)) => Err(format!(
            "Packaged MCP server exited during startup with status {status}"
        )),
        Ok(None) => Ok(child),
        Err(error) => {
            let _ = stop_mcp_server(&mut child);
            Err(format!(
                "Failed to inspect packaged MCP server during startup: {error}"
            ))
        }
    }
}

/// Resolves a bare command name against a PATH we were handed rather than the
/// one this process inherited — packaged GUI apps typically inherit a minimal
/// PATH that does not include nvm/homebrew installations.
pub(crate) fn find_in_path(cmd: &str, path_var: &str) -> Option<PathBuf> {
    path_var
        .split(':')
        .filter(|dir| !dir.is_empty())
        .map(|dir| Path::new(dir).join(cmd))
        .find(|candidate| is_executable_file(candidate))
}

#[cfg(unix)]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

/// Continuously drain a child's stdout/stderr into the void. Nothing consumes
/// these pipes (agents spawn their own MCP transport), but an undrained pipe
/// blocks the subprocess as soon as ~64KB of log output accumulate.
pub fn drain_pipes(child: &mut Child) {
    use std::io::Read;

    if let Some(mut out) = child.stdout.take() {
        std::thread::spawn(move || {
            let mut sink = [0u8; 8192];
            while matches!(out.read(&mut sink), Ok(n) if n > 0) {}
        });
    }
    if let Some(mut err) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut sink = [0u8; 8192];
            while matches!(err.read(&mut sink), Ok(n) if n > 0) {}
        });
    }
}

pub fn stop_mcp_server(child: &mut Child) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|error| format!("Failed to inspect MCP server before stop: {error}"))?
        .is_some()
    {
        return Ok(());
    }

    #[cfg(unix)]
    if let Err(error) = kill_process_group(child.id()) {
        if error.raw_os_error() == Some(3) {
            child
                .kill()
                .map_err(|fallback| format!("Failed to stop MCP server: {fallback}"))?;
        } else {
            return Err(format!("Failed to stop MCP server process group: {error}"));
        }
    }
    #[cfg(windows)]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .status()
            .map_err(|error| format!("Failed to launch taskkill for MCP server: {error}"))?;
        if !status.success() {
            return Err(format!("Failed to stop MCP server process tree: {status}"));
        }
    }
    #[cfg(not(any(unix, windows)))]
    child
        .kill()
        .map_err(|error| format!("Failed to stop MCP server: {error}"))?;

    let _ = child.wait();
    Ok(())
}

#[cfg(unix)]
fn kill_process_group(leader_pid: u32) -> Result<(), std::io::Error> {
    const SIGKILL: i32 = 9;

    extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }

    let process_group = i32::try_from(leader_pid).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("MCP process id {leader_pid} exceeds the platform limit"),
        )
    })?;
    // SAFETY: `kill` has no pointer arguments. A negative PID addresses the
    // dedicated process group created in `start_mcp_server`.
    if unsafe { kill(-process_group, SIGKILL) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

fn refresh_runtime(runtime: &mut McpRuntime) {
    let Some(process) = runtime.process.as_mut() else {
        return;
    };

    match process.child.try_wait() {
        Ok(Some(status)) => {
            runtime.process = None;
            runtime.last_error = Some(format!(
                "MCP server exited unexpectedly with status {status}"
            ));
        }
        Ok(None) => {}
        Err(error) => {
            runtime.last_error = Some(format!("Failed to inspect MCP server: {error}"));
        }
    }
}

fn runtime_status(runtime: &McpRuntime) -> McpStatusInfo {
    match runtime.process.as_ref() {
        Some(process) => McpStatusInfo {
            status: McpServerStatus::Running,
            phase: if runtime.last_error.is_some() {
                McpServerPhase::Error
            } else {
                McpServerPhase::Running
            },
            pid: Some(process.child.id()),
            project_path: Some(process.project_path.clone()),
            error: runtime.last_error.clone(),
        },
        None => McpStatusInfo {
            status: McpServerStatus::Stopped,
            phase: if runtime.last_error.is_some() {
                McpServerPhase::Error
            } else {
                McpServerPhase::Stopped
            },
            pid: None,
            project_path: None,
            error: runtime.last_error.clone(),
        },
    }
}

pub fn get_mcp_status(state: &McpServerState) -> McpStatusInfo {
    state.status()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_server_state_new() {
        let state = McpServerState::new();
        let status = state.status();
        assert_eq!(status.status, McpServerStatus::Stopped);
        assert_eq!(status.phase, McpServerPhase::Stopped);
        assert!(status.project_path.is_none());
    }

    #[test]
    fn test_get_mcp_status_when_stopped() {
        let state = McpServerState::new();
        let status = get_mcp_status(&state);
        assert_eq!(status.status, McpServerStatus::Stopped);
        assert!(status.pid.is_none());
    }

    #[cfg(unix)]
    fn write_executable(dir: &std::path::Path, name: &str, contents: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        std::fs::write(&path, contents).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn test_find_in_path_locates_executable() {
        let dir = tempfile::tempdir().unwrap();
        let bin = write_executable(dir.path(), "npx", "#!/bin/sh\nexit 0\n");
        let path_var = format!("/nonexistent:{}", dir.path().display());
        assert_eq!(find_in_path("npx", &path_var), Some(bin));
    }

    #[test]
    fn test_find_in_path_returns_none_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path_var = dir.path().display().to_string();
        assert_eq!(find_in_path("npx", &path_var), None);
    }

    #[cfg(unix)]
    #[test]
    fn test_find_in_path_skips_non_executable_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("npx"), "not executable").unwrap();
        let path_var = dir.path().display().to_string();
        assert_eq!(find_in_path("npx", &path_var), None);
    }

    /// The MCP server must resolve `npx` against the PATH of the *login-shell*
    /// env passed in — not the parent process PATH, which is minimal when the
    /// packaged app is launched from Finder.
    #[cfg(unix)]
    #[test]
    fn test_start_mcp_server_resolves_npx_via_provided_env_path() {
        let dir = tempfile::tempdir().unwrap();
        write_executable(dir.path(), "npx", "#!/bin/sh\n/bin/sleep 5\n");
        let env = vec![("PATH".to_string(), dir.path().display().to_string())];

        let mut child =
            start_mcp_server("/tmp/fake.db", "/tmp/fake-server.ts", &env).expect("should spawn");
        assert!(child.id() > 0);
        stop_mcp_server(&mut child).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn stopping_mcp_terminates_descendants_started_by_the_npx_wrapper() {
        let dir = tempfile::tempdir().unwrap();
        let descendant_pid_file = dir.path().join("descendant.pid");
        let wrapper = format!(
            "#!/bin/sh\nsleep 30 &\necho $! > '{}'\nwait\n",
            descendant_pid_file.display()
        );
        write_executable(dir.path(), "npx", &wrapper);
        let env = vec![(
            "PATH".to_string(),
            format!("{}:/bin:/usr/bin", dir.path().display()),
        )];

        let mut child =
            start_mcp_server("/tmp/fake.db", "/tmp/fake-server.ts", &env).expect("should spawn");
        let descendant_pid = (0..20)
            .find_map(|_| {
                let pid = std::fs::read_to_string(&descendant_pid_file)
                    .ok()
                    .and_then(|raw| raw.trim().parse::<u32>().ok());
                if pid.is_none() {
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
                pid
            })
            .expect("wrapper did not report descendant pid");

        stop_mcp_server(&mut child).unwrap();

        let descendant_stopped = (0..20).any(|_| {
            let stopped = !Command::new("kill")
                .args(["-0", &descendant_pid.to_string()])
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false);
            if !stopped {
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            stopped
        });
        if !descendant_stopped {
            let _ = Command::new("kill")
                .args(["-9", &descendant_pid.to_string()])
                .status();
        }
        assert!(descendant_stopped, "MCP descendant survived wrapper stop");
    }

    #[cfg(unix)]
    #[test]
    fn start_mcp_server_rejects_a_wrapper_that_exits_during_startup() {
        let dir = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("/usr/bin/false", dir.path().join("npx")).unwrap();
        let env = vec![(
            "PATH".to_string(),
            format!("{}:/bin:/usr/bin", dir.path().display()),
        )];

        let error = match start_mcp_server("/tmp/fake.db", "/tmp/fake-server.ts", &env) {
            Err(error) => error,
            Ok(mut child) => {
                let command = Command::new("ps")
                    .args(["-p", &child.id().to_string(), "-o", "command="])
                    .output()
                    .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
                    .unwrap_or_default();
                let _ = stop_mcp_server(&mut child);
                panic!("an early wrapper exit was still running as: {command}");
            }
        };

        assert!(error.contains("exited during startup"));
        assert!(error.contains("status"));
    }

    #[test]
    fn test_start_and_stop_mcp_server() {
        // Use a simple command that stays alive briefly
        let mut child = Command::new("sleep")
            .arg("10")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Failed to spawn sleep");

        assert!(child.id() > 0);
        stop_mcp_server(&mut child).unwrap();
    }

    #[test]
    fn test_drain_pipes_prevents_pipe_full_blocking() {
        // Writes ~1MB to stdout — far past the ~64KB pipe buffer. Without
        // draining, the child blocks mid-write and wait() hangs forever.
        let mut child = Command::new("/bin/sh")
            .args([
                "-c",
                "head -c 1000000 /dev/zero; head -c 1000000 /dev/zero 1>&2",
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Failed to spawn writer");

        drain_pipes(&mut child);

        let status = child.wait().expect("wait failed");
        assert!(status.success());
    }

    #[test]
    fn test_get_mcp_status_when_running() {
        let state = McpServerState::new();
        state
            .start_with("/repo/alpha", || {
                Command::new("sleep")
                    .arg("10")
                    .spawn()
                    .map_err(|error| error.to_string())
            })
            .unwrap();

        let status = get_mcp_status(&state);
        assert_eq!(status.status, McpServerStatus::Running);
        assert!(status.pid.is_some());
        assert_eq!(status.project_path.as_deref(), Some("/repo/alpha"));
        state.stop_with(stop_mcp_server).unwrap();
    }

    #[test]
    fn test_get_mcp_status_detects_exited_process() {
        let state = McpServerState::new();
        state
            .start_with("/repo/alpha", || {
                Command::new("true")
                    .spawn()
                    .map_err(|error| error.to_string())
            })
            .unwrap();

        // Wait for the process to actually exit (with retry)
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let s = get_mcp_status(&state);
            if s.status == McpServerStatus::Stopped {
                assert!(s.pid.is_none());
                return;
            }
        }
        panic!("Process did not exit within timeout");
    }

    #[test]
    fn start_for_the_same_project_is_idempotent() {
        let state = McpServerState::new();
        let first = state
            .start_with("/repo/alpha", || {
                Command::new("sleep")
                    .arg("10")
                    .spawn()
                    .map_err(|error| error.to_string())
            })
            .unwrap();

        let second = state
            .start_with("/repo/alpha", || {
                panic!("same-project start must not spawn again")
            })
            .unwrap();

        assert_eq!(second.pid, first.pid);
        assert_eq!(second.project_path.as_deref(), Some("/repo/alpha"));
        state.stop_with(stop_mcp_server).unwrap();
    }

    #[test]
    fn start_for_a_different_project_stops_the_old_child_before_spawning() {
        let state = McpServerState::new();
        let first = state
            .start_with("/repo/alpha", || {
                Command::new("sleep")
                    .arg("10")
                    .spawn()
                    .map_err(|error| error.to_string())
            })
            .unwrap();

        let second = state
            .start_with("/repo/beta", || {
                Command::new("sleep")
                    .arg("10")
                    .spawn()
                    .map_err(|error| error.to_string())
            })
            .unwrap();

        assert_ne!(second.pid, first.pid);
        assert_eq!(second.project_path.as_deref(), Some("/repo/beta"));
        state.stop_with(stop_mcp_server).unwrap();
    }

    #[test]
    fn stop_is_idempotent() {
        let state = McpServerState::new();

        assert_eq!(state.stop_with(stop_mcp_server), Ok(()));
        assert_eq!(state.stop_with(stop_mcp_server), Ok(()));
    }

    #[test]
    fn stop_supersedes_a_start_reserved_before_async_preparation() {
        let state = McpServerState::new();
        let stale_generation = state.reserve_start().unwrap();
        state.stop_with(stop_mcp_server).unwrap();

        let error = state
            .start_reserved_with(stale_generation, "/repo/alpha", || {
                panic!("a superseded start must not spawn")
            })
            .unwrap_err();

        assert!(error.contains("superseded"));
        assert_eq!(state.status().status, McpServerStatus::Stopped);
    }

    #[test]
    fn dropping_the_supervisor_stops_its_managed_child() {
        let child_pid;
        {
            let state = McpServerState::new();
            let status = state
                .start_with("/repo/alpha", || {
                    Command::new("sleep")
                        .arg("10")
                        .spawn()
                        .map_err(|error| error.to_string())
                })
                .unwrap();
            child_pid = status.pid.unwrap();
        }

        #[cfg(unix)]
        assert!(!Command::new("kill")
            .args(["-0", &child_pid.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(false));
    }

    #[test]
    fn failed_stop_keeps_the_child_and_binding_tracked() {
        let state = McpServerState::new();
        state
            .start_with("/repo/alpha", || {
                Command::new("sleep")
                    .arg("10")
                    .spawn()
                    .map_err(|error| error.to_string())
            })
            .unwrap();

        let error = state
            .stop_with(|_| Err("injected kill failure".to_string()))
            .unwrap_err();
        let status = state.status();

        assert_eq!(error, "injected kill failure");
        assert_eq!(status.status, McpServerStatus::Running);
        assert_eq!(status.phase, McpServerPhase::Error);
        assert_eq!(status.project_path.as_deref(), Some("/repo/alpha"));
        assert_eq!(status.error.as_deref(), Some("injected kill failure"));
        assert!(status.pid.is_some());
        state.stop_with(stop_mcp_server).unwrap();
    }

    #[test]
    fn status_reaps_a_dead_child_and_clears_its_binding() {
        let state = McpServerState::new();
        state
            .start_with("/repo/alpha", || {
                Command::new("true")
                    .spawn()
                    .map_err(|error| error.to_string())
            })
            .unwrap();

        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let status = state.status();
            if status.status == McpServerStatus::Stopped {
                assert_eq!(status.phase, McpServerPhase::Error);
                assert!(status.project_path.is_none());
                assert!(status.pid.is_none());
                assert!(status
                    .error
                    .as_deref()
                    .unwrap()
                    .contains("exited unexpectedly"));
                return;
            }
        }
        panic!("Process did not exit within timeout");
    }
}
