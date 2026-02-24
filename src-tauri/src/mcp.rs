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
    let child = Command::new("npx")
        .args(["tsx", script_path, db_path])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start MCP server: {}", e))?;

    Ok(child)
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
