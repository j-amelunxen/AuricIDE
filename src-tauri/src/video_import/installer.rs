use super::failure::{self, Stage};
use super::preflight::{self, resolve_executable, Preflight};
use super::{runtime_dir, tool_error, write_log, ToolFailure};
use crate::agents::cached_login_shell_env;
use std::process::Stdio;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// The package Setup installs. Not pinned to a version on purpose: pinning
/// means owning the upgrade, and the preflight check plus the classified
/// errors already keep a bad machine from turning into a stack trace.
pub const RUNTIME_PACKAGE: &str = "parakeet-mlx";

/// Streamed to the UI while Setup runs, so a multi-minute download is visibly
/// working rather than a frozen button.
pub const SETUP_PROGRESS_EVENT: &str = "video-import-setup-progress";

/// How long Setup may take before we call it stuck. Generous — it downloads
/// roughly 130 MB of wheels and possibly a Python — but finite, because an
/// install with no upper bound is indistinguishable from a frozen panel.
const SETUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30 * 60);

struct StreamedRun {
    success: bool,
    output: String,
}

/// Forward one of the child's streams: each line to the UI as progress, and
/// every line to the transcript that becomes the log.
fn pump<R>(
    app: tauri::AppHandle,
    collected: std::sync::Arc<std::sync::Mutex<String>>,
    stream: R,
) -> tokio::task::JoinHandle<()>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let mut lines = BufReader::new(stream).lines();
    tokio::spawn(async move {
        while let Ok(Some(line)) = lines.next_line().await {
            let readable = failure::readable_details(&line);
            if !readable.trim().is_empty() {
                let _ = app.emit(SETUP_PROGRESS_EVENT, readable);
            }
            if let Ok(mut buffer) = collected.lock() {
                buffer.push_str(&line);
                buffer.push('\n');
            }
        }
    })
}

/// Run a command, emitting each output line to the UI as it arrives and
/// keeping the whole transcript for the log.
async fn run_streaming(
    app: &tauri::AppHandle,
    mut command: Command,
) -> Result<StreamedRun, String> {
    let mut child = command
        .spawn()
        .map_err(|e| format!("The installer could not be started: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let collected = std::sync::Arc::new(std::sync::Mutex::new(String::new()));

    let mut readers = Vec::new();
    if let Some(stream) = stdout {
        readers.push(pump(app.clone(), collected.clone(), stream));
    }
    if let Some(stream) = stderr {
        readers.push(pump(app.clone(), collected.clone(), stream));
    }

    let status = match tokio::time::timeout(SETUP_TIMEOUT, child.wait()).await {
        Ok(result) => result.map_err(|e| format!("The installer could not be run: {e}"))?,
        Err(_) => {
            let _ = child.start_kill();
            return Err(ToolFailure {
                summary: "Setup was stopped after 30 minutes without finishing. Check the network connection and try again.".to_string(),
                details: collected.lock().map(|b| b.clone()).unwrap_or_default(),
                log_path: None,
            }
            .into_ipc_error());
        }
    };
    for reader in readers {
        let _ = reader.await;
    }
    let output = collected.lock().map(|b| b.clone()).unwrap_or_default();
    Ok(StreamedRun {
        success: status.success(),
        output,
    })
}

pub async fn install_local(app: &tauri::AppHandle) -> Result<Preflight, String> {
    let runtime = runtime_dir(app)?;
    let report = preflight::inspect(&runtime).await;
    if report.ready {
        return Ok(report);
    }
    if !report.can_install {
        let blocker = report
            .checks
            .iter()
            .find(|check| !check.ok)
            .map(|check| check.detail.clone())
            .unwrap_or_else(|| "This machine cannot run the local runtime.".to_string());
        return Err(ToolFailure {
            summary: blocker,
            details: String::new(),
            log_path: None,
        }
        .into_ipc_error());
    }

    let uv = resolve_executable("uv")
        .await
        .ok_or_else(|| "uv was not found.".to_string())?;
    let bin_dir = runtime.join("bin");
    let tool_dir = runtime.join("tools");
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&tool_dir).map_err(|e| e.to_string())?;

    let mut command = Command::new(&uv);
    command.args(["tool", "install", "--force", RUNTIME_PACKAGE]);
    for (key, value) in cached_login_shell_env().await {
        command.env(key, value);
    }
    command.env("UV_TOOL_DIR", &tool_dir);
    command.env("UV_TOOL_BIN_DIR", &bin_dir);
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let transcript = run_streaming(app, command).await?;
    let log = write_log(runtime.join("setup.log"), &transcript.output);
    if !transcript.success {
        return Err(tool_error(Stage::Install, &transcript.output, log));
    }

    let report = preflight::inspect(&runtime).await;
    if !report.ready {
        // uv exits 0 while only warning that its bin directory is not on PATH,
        // so a green exit code is not proof the executable is where we need it.
        return Err(ToolFailure {
            summary: "The install reported success, but the runtime executable is not where it was expected.".to_string(),
            details: failure::readable_details(&transcript.output),
            log_path: log,
        }
        .into_ipc_error());
    }
    Ok(report)
}
