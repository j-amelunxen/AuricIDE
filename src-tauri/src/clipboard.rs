//! Native system clipboard support.
//!
//! Provides a reliable way to copy text to the OS pasteboard across
//! platforms without relying on webview document focus or transient user activation.

use std::io::Write;
use std::process::{Command, Stdio};

/// Writes `text` to the OS system clipboard.
pub fn write_to_system_clipboard(text: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut child = Command::new("/usr/bin/pbcopy")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn pbcopy: {}", e))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| format!("Failed to write to pbcopy: {}", e))?;
        }
        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for pbcopy: {}", e))?;
        if status.success() {
            Ok(())
        } else {
            Err("pbcopy exited with non-zero status".to_string())
        }
    }
    #[cfg(target_os = "linux")]
    {
        let tools: [(&str, &[&str]); 3] = [
            ("wl-copy", &[]),
            ("xclip", &["-selection", "clipboard"]),
            ("xsel", &["--clipboard", "--input"]),
        ];
        for (cmd, args) in tools {
            if let Ok(mut child) = Command::new(cmd).args(args).stdin(Stdio::piped()).spawn() {
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(text.as_bytes());
                }
                if let Ok(status) = child.wait() {
                    if status.success() {
                        return Ok(());
                    }
                }
            }
        }
        Err("No clipboard tool found (wl-copy, xclip, xsel)".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let mut child = Command::new("clip")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn clip: {}", e))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(text.as_bytes())
                .map_err(|e| format!("Failed to write to clip: {}", e))?;
        }
        let status = child
            .wait()
            .map_err(|e| format!("Failed to wait for clip: {}", e))?;
        if status.success() {
            Ok(())
        } else {
            Err("clip exited with non-zero status".to_string())
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Err("Clipboard not supported on this platform".to_string())
    }
}

/// Reads `text` from the OS system clipboard.
pub fn read_from_system_clipboard() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/usr/bin/pbpaste")
            .output()
            .map_err(|e| format!("Failed to execute pbpaste: {}", e))?;
        if output.status.success() {
            String::from_utf8(output.stdout)
                .map_err(|e| format!("Invalid UTF-8 from clipboard: {}", e))
        } else {
            Err("pbpaste exited with non-zero status".to_string())
        }
    }
    #[cfg(target_os = "linux")]
    {
        let tools: [(&str, &[&str]); 3] = [
            ("wl-paste", &[]),
            ("xclip", &["-selection", "clipboard", "-o"]),
            ("xsel", &["--clipboard", "--output"]),
        ];
        for (cmd, args) in tools {
            if let Ok(output) = Command::new(cmd).args(args).output() {
                if output.status.success() {
                    return String::from_utf8(output.stdout)
                        .map_err(|e| format!("Invalid UTF-8 from clipboard: {}", e));
                }
            }
        }
        Err("No clipboard tool found (wl-paste, xclip, xsel)".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", "Get-Clipboard"])
            .output()
            .map_err(|e| format!("Failed to execute powershell Get-Clipboard: {}", e))?;
        if output.status.success() {
            String::from_utf8(output.stdout)
                .map_err(|e| format!("Invalid UTF-8 from clipboard: {}", e))
        } else {
            Err("powershell Get-Clipboard exited with non-zero status".to_string())
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        Err("Clipboard not supported on this platform".to_string())
    }
}

/// Tauri command to write text to the OS clipboard.
#[tauri::command]
pub async fn clipboard_write_text(text: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || write_to_system_clipboard(&text))
        .await
        .map_err(|e| e.to_string())?
}

/// Tauri command to read text from the OS clipboard.
#[tauri::command]
pub async fn clipboard_read_text() -> Result<String, String> {
    tokio::task::spawn_blocking(read_from_system_clipboard)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trips through the real pasteboard, so it clobbers whatever the
    /// person running the suite had copied. Ignored for the same reason
    /// `inspects_this_machine` is: `cargo test clipboard -- --ignored`.
    #[test]
    #[ignore]
    #[cfg(target_os = "macos")]
    fn test_write_and_read_clipboard_macos() {
        let test_val = format!(
            "auric-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        );
        let write_res = write_to_system_clipboard(&test_val);
        assert!(write_res.is_ok());
        let read_res = read_from_system_clipboard();
        assert!(read_res.is_ok());
        assert_eq!(read_res.unwrap(), test_val);
    }
}
