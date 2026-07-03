use serde::Serialize;
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

pub fn start_mcp_server(db_path: &str, script_path: &str) -> Result<Child, String> {
    let mut child = Command::new("npx")
        .args(["tsx", script_path, db_path])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start MCP server: {}", e))?;

    drain_pipes(&mut child);

    Ok(child)
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
