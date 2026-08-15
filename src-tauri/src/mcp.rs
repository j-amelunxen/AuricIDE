use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum McpServerStatus {
    Running,
    Stopped,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpStatusInfo {
    pub status: McpServerStatus,
    pub pid: Option<u32>,
}

pub struct McpServerState {
    pub process: Mutex<Option<Child>>,
}

impl McpServerState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }
}

pub fn start_mcp_server(
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

    let mut child = Command::new(npx)
        .args(["tsx", script_path, db_path])
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start MCP server: {}", e))?;

    drain_pipes(&mut child);

    Ok(child)
}

/// Resolves a bare command name against a PATH we were handed rather than the
/// one this process inherited — see `start_mcp_server` for why that matters.
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
    child
        .kill()
        .map_err(|e| format!("Failed to stop MCP server: {}", e))?;
    let _ = child.wait();
    Ok(())
}

pub fn get_mcp_status(state: &McpServerState) -> McpStatusInfo {
    let mut guard = state.process.lock().unwrap();
    if let Some(ref mut child) = *guard {
        match child.try_wait() {
            Ok(Some(_)) => {
                // Process has exited
                *guard = None;
                McpStatusInfo {
                    status: McpServerStatus::Stopped,
                    pid: None,
                }
            }
            Ok(None) => McpStatusInfo {
                status: McpServerStatus::Running,
                pid: Some(child.id()),
            },
            Err(_) => {
                *guard = None;
                McpStatusInfo {
                    status: McpServerStatus::Stopped,
                    pid: None,
                }
            }
        }
    } else {
        McpStatusInfo {
            status: McpServerStatus::Stopped,
            pid: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_server_state_new() {
        let state = McpServerState::new();
        let guard = state.process.lock().unwrap();
        assert!(guard.is_none());
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
        write_executable(dir.path(), "npx", "#!/bin/sh\nsleep 5\n");
        let env = vec![("PATH".to_string(), dir.path().display().to_string())];

        let mut child =
            start_mcp_server("/tmp/fake.db", "/tmp/fake-server.ts", &env).expect("should spawn");
        assert!(child.id() > 0);
        stop_mcp_server(&mut child).unwrap();
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
        let child = Command::new("sleep")
            .arg("10")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("Failed to spawn sleep");

        {
            let mut guard = state.process.lock().unwrap();
            *guard = Some(child);
        }

        let status = get_mcp_status(&state);
        assert_eq!(status.status, McpServerStatus::Running);
        assert!(status.pid.is_some());

        // Clean up
        let mut guard = state.process.lock().unwrap();
        if let Some(ref mut c) = *guard {
            let _ = c.kill();
            let _ = c.wait();
        }
    }

    #[test]
    fn test_get_mcp_status_detects_exited_process() {
        let state = McpServerState::new();
        let child = Command::new("true").spawn().expect("Failed to spawn true");

        {
            let mut guard = state.process.lock().unwrap();
            *guard = Some(child);
        }

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
}
