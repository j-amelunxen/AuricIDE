mod failure;
mod preflight;

use crate::agents::cached_login_shell_env;
use crate::database::{kv_get, DatabaseState};
use failure::{describe_failure, FailureReport, Stage};
use preflight::{resolve_executable, Preflight};
use reqwest::multipart::{Form, Part};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const SETTINGS_NS: &str = "video_import_settings";

/// The runtime AuricIDE installs and manages itself. A `local_command` equal
/// to this means "whatever Setup produced"; anything else is the user's own
/// choice and is honoured verbatim.
const DEFAULT_LOCAL_COMMAND: &str = "parakeet-mlx";

/// The package Setup installs. Not pinned to a version on purpose: pinning
/// means owning the upgrade, and the preflight check plus the classified
/// errors already keep a bad machine from turning into a stack trace.
const RUNTIME_PACKAGE: &str = "parakeet-mlx";

/// Streamed to the UI while Setup runs, so a multi-minute download is visibly
/// working rather than a frozen button.
const SETUP_PROGRESS_EVENT: &str = "video-import-setup-progress";

/// Full tool output is written next to the work it belongs to. The UI shows a
/// sentence; this is where the rest goes when the sentence is not enough.
fn write_log(path: PathBuf, contents: &str) -> Option<String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }
    std::fs::write(&path, contents).ok()?;
    Some(path.to_string_lossy().to_string())
}

/// `<app_data_dir>/runtime` — the tool environment, its executable and the
/// model cache all live here, so uninstalling is deleting a directory and
/// nothing on the machine outside it is touched.
fn runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime"))
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    start_ms: u64,
    end_ms: u64,
    text: String,
    confidence: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFrame {
    timestamp_ms: u64,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMediaAnalysis {
    import_id: String,
    source_path: String,
    source_name: String,
    duration_ms: u64,
    workspace_path: String,
    transcript: Vec<TranscriptSegment>,
    frames: Vec<VideoFrame>,
    transcription_provider: String,
}

/// A failure the UI can render without ever showing a traceback: one sentence,
/// the trimmed output behind a fold, and the full log on disk.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolFailure {
    summary: String,
    details: String,
    log_path: Option<String>,
}

impl ToolFailure {
    fn new(report: FailureReport, log_path: Option<String>) -> Self {
        Self {
            summary: report.summary,
            details: report.details,
            log_path,
        }
    }

    /// Errors cross the IPC boundary as strings, so the structured form is
    /// carried as JSON and unpacked by the caller. A serialisation failure
    /// must still not produce a traceback, hence the plain-sentence fallback.
    fn into_ipc_error(self) -> String {
        let summary = self.summary.clone();
        serde_json::to_string(&self).unwrap_or(summary)
    }
}

fn tool_error(stage: Stage, raw: &str, log_path: Option<String>) -> String {
    ToolFailure::new(describe_failure(stage, raw), log_path).into_ipc_error()
}

#[derive(Default)]
struct TranscriptionSettings {
    mode: String,
    remote_endpoint: String,
    remote_api_key: String,
    remote_model: String,
    local_command: String,
    local_args: String,
}

/// Every field read for this namespace, in both stores.
const SETTING_KEYS: [&str; 7] = [
    "transcription_mode",
    "remote_endpoint",
    "remote_api_key",
    "remote_model",
    "local_command",
    "local_args",
    "vision_enabled",
];

fn setting(
    settings: &std::collections::BTreeMap<String, String>,
    key: &str,
    default: &str,
) -> String {
    settings
        .get(key)
        .cloned()
        .unwrap_or_else(|| default.to_string())
}

/// Application-wide settings with the project's overrides folded on top. The
/// transcription endpoint and its key are the same on this machine whichever
/// project is open; a project that needs its own still says so.
fn load_settings(
    project_path: &str,
    state: &State<'_, DatabaseState>,
    credentials: &State<'_, crate::app_config::AppCredentialsState>,
) -> Result<TranscriptionSettings, String> {
    let global = crate::app_config::global_namespace(credentials.path(), SETTINGS_NS);

    // A project without an open database overrides nothing, rather than
    // failing the import outright.
    let project = {
        let connections = state.connections.lock().unwrap();
        match connections.get(project_path) {
            Some(conn) => {
                let mut found = std::collections::BTreeMap::new();
                for key in SETTING_KEYS {
                    if let Some(value) = kv_get(conn, SETTINGS_NS, key)? {
                        found.insert(key.to_string(), value);
                    }
                }
                found
            }
            None => std::collections::BTreeMap::new(),
        }
    };

    let settings = crate::app_config::merge_namespace(global, project);

    Ok(TranscriptionSettings {
        mode: setting(&settings, "transcription_mode", "automatic"),
        remote_endpoint: setting(&settings, "remote_endpoint", ""),
        remote_api_key: setting(&settings, "remote_api_key", ""),
        remote_model: setting(&settings, "remote_model", "nvidia/parakeet-tdt-0.6b-v3"),
        local_command: setting(&settings, "local_command", "parakeet-mlx"),
        local_args: setting(
            &settings,
            "local_args",
            "{audio} --output-dir {outputDir} --output-format json --highlight-words",
        ),
    })
}

fn safe_source_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("video")
        .to_string()
}

fn import_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("video-{millis}")
}

/// ffmpeg and ffprobe are spawned by absolute path. A bare `Command::new`
/// searches the PATH this process inherited, and an app launched from
/// `/Applications` inherits launchd's PATH — which contains neither Homebrew
/// nor anything else the user installed.
async fn media_tool(name: &'static str) -> Result<PathBuf, String> {
    resolve_executable(name).await.ok_or_else(|| {
        format!("{name} was not found. Video import needs it to read the video and extract its audio. Install it, for example with 'brew install ffmpeg'.")
    })
}

fn parse_duration_ms(raw: &[u8]) -> Result<u64, String> {
    let text = String::from_utf8_lossy(raw);
    let seconds: f64 = text
        .trim()
        .parse()
        .map_err(|_| format!("ffprobe returned an invalid duration: {}", text.trim()))?;
    Ok((seconds.max(0.0) * 1000.0).round() as u64)
}

async fn video_duration_ms(source: &Path) -> Result<u64, String> {
    let output = Command::new(media_tool("ffprobe").await?)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
        ])
        .arg(source)
        .output()
        .await
        .map_err(|e| format!("ffprobe is required for video import: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Could not inspect video: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    parse_duration_ms(&output.stdout)
}

async fn extract_audio(source: &Path, output: &Path) -> Result<(), String> {
    let result = Command::new(media_tool("ffmpeg").await?)
        .args(["-y", "-v", "error", "-i"])
        .arg(source)
        .args(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"])
        .arg(output)
        .output()
        .await
        .map_err(|e| format!("ffmpeg is required for video import: {e}"))?;
    if result.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Could not extract audio: {}",
            String::from_utf8_lossy(&result.stderr)
        ))
    }
}

async fn extract_frames(
    source: &Path,
    dir: &Path,
    duration_ms: u64,
) -> Result<Vec<VideoFrame>, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let ffmpeg = media_tool("ffmpeg").await?;
    let count = ((duration_ms / 30_000) + 4).clamp(4, 16);
    let mut frames = Vec::new();
    for index in 0..count {
        let timestamp_ms = if count <= 1 {
            0
        } else {
            duration_ms.saturating_mul(index) / (count - 1)
        };
        let path = dir.join(format!("frame-{index:03}-{timestamp_ms}ms.jpg"));
        let result = Command::new(&ffmpeg)
            .args([
                "-y",
                "-v",
                "error",
                "-ss",
                &format!("{:.3}", timestamp_ms as f64 / 1000.0),
                "-i",
            ])
            .arg(source)
            .args(["-frames:v", "1", "-vf", "scale='min(1280,iw)':-2"])
            .arg(&path)
            .output()
            .await
            .map_err(|e| format!("Could not extract video frame: {e}"))?;
        if result.status.success() && path.is_file() {
            frames.push(VideoFrame {
                timestamp_ms,
                path: path.to_string_lossy().to_string(),
            });
        }
    }
    Ok(frames)
}

fn json_segments(value: &serde_json::Value, duration_ms: u64) -> Vec<TranscriptSegment> {
    let source = value
        .get("segments")
        .or_else(|| value.get("sentences"))
        .and_then(|v| v.as_array());
    match source {
        Some(segments) => segments
            .iter()
            .filter_map(|segment| {
                let text = segment.get("text")?.as_str()?.trim().to_string();
                if text.is_empty() {
                    return None;
                }
                let start = segment.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let end = segment
                    .get("end")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(duration_ms as f64 / 1000.0);
                Some(TranscriptSegment {
                    start_ms: (start.max(0.0) * 1000.0).round() as u64,
                    end_ms: (end.max(start) * 1000.0).round() as u64,
                    text,
                    confidence: segment.get("confidence").and_then(|v| v.as_f64()),
                })
            })
            .collect(),
        None => value
            .get("text")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(|text| {
                vec![TranscriptSegment {
                    start_ms: 0,
                    end_ms: duration_ms,
                    text: text.to_string(),
                    confidence: None,
                }]
            })
            .unwrap_or_default(),
    }
}

fn parse_transcription(raw: &[u8], duration_ms: u64) -> Result<Vec<TranscriptSegment>, String> {
    let value: serde_json::Value = serde_json::from_slice(raw)
        .or_else(|_| {
            let text = String::from_utf8_lossy(raw).trim().to_string();
            if text.is_empty() {
                Err(serde_json::Error::io(std::io::Error::other(
                    "empty transcription",
                )))
            } else {
                Ok(serde_json::json!({ "text": text }))
            }
        })
        .map_err(|e| format!("Could not parse transcription: {e}"))?;
    let segments = json_segments(&value, duration_ms);
    if segments.is_empty() {
        Err("Transcription returned no speech".to_string())
    } else {
        Ok(segments)
    }
}

async fn transcribe_remote(
    audio: &Path,
    settings: &TranscriptionSettings,
    duration_ms: u64,
    raw_output: &Path,
) -> Result<Vec<TranscriptSegment>, String> {
    if settings.remote_endpoint.trim().is_empty() {
        return Err("Remote transcription endpoint is not configured".to_string());
    }
    let bytes = tokio::fs::read(audio).await.map_err(|e| e.to_string())?;
    let file_name = audio
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("audio.wav")
        .to_string();
    let form = Form::new()
        .part(
            "file",
            Part::bytes(bytes)
                .file_name(file_name)
                .mime_str("audio/wav")
                .map_err(|e| e.to_string())?,
        )
        .text("model", settings.remote_model.clone())
        .text("response_format", "verbose_json");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.post(settings.remote_endpoint.trim()).multipart(form);
    if !settings.remote_api_key.trim().is_empty() {
        request = request.bearer_auth(settings.remote_api_key.trim());
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Remote transcription failed: {e}"))?;
    let status = response.status();
    let body = response.bytes().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "Remote transcription returned {status}: {}",
            String::from_utf8_lossy(&body)
        ));
    }
    std::fs::write(raw_output, &body).map_err(|e| e.to_string())?;
    parse_transcription(&body, duration_ms)
}

fn expand_local_args(template: &str, audio: &Path, output_dir: &Path) -> Vec<String> {
    template
        .split_whitespace()
        .map(|arg| {
            arg.replace("{audio}", &audio.to_string_lossy())
                .replace("{outputDir}", &output_dir.to_string_lossy())
        })
        .collect()
}

/// Where the runtime executable lives, in the order of who gets to decide: a
/// command the user configured explicitly, then the one we installed
/// ourselves, then PATH as a last resort. PATH is last on purpose — it is the
/// least reliable of the three inside a bundled app.
async fn local_executable(
    settings: &TranscriptionSettings,
    runtime_dir: &Path,
) -> Result<PathBuf, String> {
    let configured = settings.local_command.trim();
    let is_default = configured.is_empty() || configured == DEFAULT_LOCAL_COMMAND;
    if !is_default {
        return resolve_executable(configured).await.ok_or_else(|| {
            format!("The configured local command '{configured}' was not found on this machine.")
        });
    }
    if let Some(installed) = preflight::runtime_executable(runtime_dir) {
        return Ok(installed);
    }
    resolve_executable(DEFAULT_LOCAL_COMMAND).await.ok_or_else(|| {
        "The local transcription runtime is not installed. Run Setup in Settings > Video Import, or configure a remote endpoint.".to_string()
    })
}

async fn transcribe_local(
    audio: &Path,
    settings: &TranscriptionSettings,
    duration_ms: u64,
    model_cache: &Path,
    raw_output: &Path,
    runtime_dir: &Path,
) -> Result<Vec<TranscriptSegment>, String> {
    let executable = local_executable(settings, runtime_dir).await?;
    let output_dir = audio.parent().unwrap_or_else(|| Path::new("."));
    let mut command = Command::new(&executable);
    command.args(expand_local_args(&settings.local_args, audio, output_dir));
    // `--cache-dir` on the CLI; keeps the ~1.2 GB model with the app's data
    // rather than in whatever cache the ambient environment points at.
    command.env("PARAKEET_CACHE_DIR", model_cache);
    for (key, value) in cached_login_shell_env().await {
        command.env(key, value);
    }
    let output = command
        .output()
        .await
        .map_err(|e| format!("The local transcription runtime could not be started: {e}"))?;
    if !output.status.success() {
        let mut raw = String::from_utf8_lossy(&output.stdout).to_string();
        raw.push_str(&String::from_utf8_lossy(&output.stderr));
        let log = write_log(raw_output.with_file_name("transcription.log"), &raw);
        return Err(tool_error(Stage::Transcribe, &raw, log));
    }
    let json_path = output_dir.join(format!(
        "{}.json",
        audio
            .file_stem()
            .and_then(|v| v.to_str())
            .unwrap_or("audio")
    ));
    if json_path.is_file() {
        let body = std::fs::read(&json_path).map_err(|e| e.to_string())?;
        std::fs::write(raw_output, &body).map_err(|e| e.to_string())?;
        parse_transcription(&body, duration_ms)
    } else {
        // Custom local commands may intentionally emit JSON to stdout.
        std::fs::write(raw_output, &output.stdout).map_err(|e| e.to_string())?;
        parse_transcription(&output.stdout, duration_ms)
    }
}

async fn transcribe(
    audio: &Path,
    settings: &TranscriptionSettings,
    duration_ms: u64,
    model_cache: &Path,
    raw_output: &Path,
    runtime_dir: &Path,
) -> Result<(Vec<TranscriptSegment>, String), String> {
    let local = || {
        transcribe_local(
            audio,
            settings,
            duration_ms,
            model_cache,
            raw_output,
            runtime_dir,
        )
    };
    match settings.mode.as_str() {
        "remote" => Ok((
            transcribe_remote(audio, settings, duration_ms, raw_output).await?,
            "remote".to_string(),
        )),
        "local" => Ok((local().await?, "local".to_string())),
        _ if !settings.remote_endpoint.trim().is_empty() => {
            match transcribe_remote(audio, settings, duration_ms, raw_output).await {
                Ok(result) => Ok((result, "remote".to_string())),
                // Both lanes failed. The local half is the structured one, so it
                // carries the message; the remote reason rides along as detail
                // rather than being concatenated into an unreadable sentence.
                Err(remote_error) => local()
                    .await
                    .map(|result| (result, "local".to_string()))
                    .map_err(|local_error| combine_lane_failures(&remote_error, local_error)),
            }
        }
        _ => Ok((local().await?, "local".to_string())),
    }
}

/// Automatic mode tries remote and then local. When both fail the user needs
/// one sentence about the lane they can act on, not two errors glued together.
fn combine_lane_failures(remote_error: &str, local_error: String) -> String {
    let Ok(mut failure) = serde_json::from_str::<serde_json::Value>(&local_error) else {
        return local_error;
    };
    if let Some(object) = failure.as_object_mut() {
        let note = format!("Remote transcription was tried first and failed: {remote_error}");
        let details = object
            .get("details")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        let combined = if details.is_empty() {
            note
        } else {
            format!("{note}\n\n{details}")
        };
        object.insert("details".to_string(), serde_json::Value::String(combined));
    }
    failure.to_string()
}

/// Everything the local runtime needs, checked and reported per dependency.
/// Cheap enough to call whenever the settings panel opens.
#[tauri::command]
pub async fn video_import_preflight(app: tauri::AppHandle) -> Result<Preflight, String> {
    Ok(preflight::inspect(&runtime_dir(&app)?).await)
}

/// Install the runtime, but only onto a machine the preflight has cleared.
///
/// The install is bounded, streamed and confined: bounded by a timeout so a
/// stalled download cannot hang the panel forever, streamed so the user sees
/// it working, and confined to `<app_data_dir>/runtime` via uv's own directory
/// variables. That last part matters more than it looks — sharing
/// `~/.local/share/uv/tools` with the rest of the machine means anything else
/// touching it can break a transcription mid-run, and the way that surfaces is
/// a Python traceback.
#[tauri::command]
pub async fn video_import_install_local(app: tauri::AppHandle) -> Result<Preflight, String> {
    let runtime = runtime_dir(&app)?;
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

    let transcript = run_streaming(&app, command).await?;
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

/// How long Setup may take before we call it stuck. Generous — it downloads
/// roughly 130 MB of wheels and possibly a Python — but finite, because an
/// install with no upper bound is indistinguishable from a frozen panel.
const SETUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30 * 60);

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

#[tauri::command]
pub fn video_import_save_process(
    project_path: String,
    import_id: String,
    process_json: String,
) -> Result<String, String> {
    let path = Path::new(&project_path)
        .join(".auric")
        .join("video-imports")
        .join(import_id)
        .join("process-analysis.json");
    let _: serde_json::Value = serde_json::from_str(&process_json)
        .map_err(|e| format!("Process analysis must be valid JSON: {e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, process_json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn video_import_analyze_media(
    project_path: String,
    source_path: String,
    db_state: State<'_, DatabaseState>,
    credentials: State<'_, crate::app_config::AppCredentialsState>,
    app: tauri::AppHandle,
) -> Result<VideoMediaAnalysis, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err("Choose an existing video file".to_string());
    }
    let settings = load_settings(&project_path, &db_state, &credentials)?;
    let duration_ms = video_duration_ms(&source).await?;
    let id = import_id();
    // Import artifacts are durable project provenance, not disposable OS temp files.
    let workspace = Path::new(&project_path)
        .join(".auric")
        .join("video-imports")
        .join(&id);
    let frame_dir = workspace.join("frames");
    std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
    let source_extension = source
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("video");
    let durable_source = workspace.join(format!("source.{source_extension}"));
    if std::fs::hard_link(&source, &durable_source).is_err() {
        std::fs::copy(&source, &durable_source)
            .map_err(|e| format!("Could not preserve the source video: {e}"))?;
    }
    let audio = workspace.join("audio.wav");
    extract_audio(&source, &audio).await?;
    let model_cache = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models")
        .join("parakeet");
    std::fs::create_dir_all(&model_cache).map_err(|e| e.to_string())?;
    let raw_transcript = workspace.join("transcription-response.json");
    let (transcript, provider) = transcribe(
        &audio,
        &settings,
        duration_ms,
        &model_cache,
        &raw_transcript,
        &runtime_dir(&app)?,
    )
    .await?;
    let frames = extract_frames(&source, &frame_dir, duration_ms).await?;
    let source_name = safe_source_name(&source);
    let result = VideoMediaAnalysis {
        import_id: id,
        source_path: source_path.clone(),
        source_name,
        duration_ms,
        workspace_path: workspace.to_string_lossy().to_string(),
        transcript,
        frames,
        transcription_provider: provider,
    };
    let manifest = serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?;
    std::fs::write(workspace.join("media-analysis.json"), manifest).map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn video_import_clear(import_id: String, app: tauri::AppHandle) -> Result<(), String> {
    // Only cache-era imports can be removed here. Durable project imports are intentionally
    // outside this command's reach so cancel/cleanup can never erase provenance.
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let path = cache.join("video-imports").join(import_id);
    if path.is_dir() {
        std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_verbose_json_segments_without_losing_text() {
        let raw = br#"{"segments":[{"start":1.25,"end":2.5,"text":" First step "},{"start":3,"end":4,"text":"Second step"}],"text":"First step Second step"}"#;
        let segments = parse_transcription(raw, 5_000).unwrap();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].start_ms, 1_250);
        assert_eq!(segments[0].text, "First step");
        assert_eq!(segments[1].text, "Second step");
    }

    #[test]
    fn plain_text_is_preserved_as_one_full_duration_segment() {
        let segments = parse_transcription(b"Everything the speaker said", 9_000).unwrap();
        assert_eq!(segments[0].end_ms, 9_000);
        assert_eq!(segments[0].text, "Everything the speaker said");
    }

    #[test]
    fn local_argument_template_substitutes_audio_path() {
        let args = expand_local_args(
            "{audio} --output-dir {outputDir} --output-format json",
            Path::new("/tmp/a file.wav"),
            Path::new("/tmp/out dir"),
        );
        assert_eq!(
            args,
            vec![
                "/tmp/a file.wav",
                "--output-dir",
                "/tmp/out dir",
                "--output-format",
                "json"
            ]
        );
    }
}
