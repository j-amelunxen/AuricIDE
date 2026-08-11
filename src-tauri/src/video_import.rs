use crate::agents::cached_login_shell_env;
use crate::database::{kv_get, DatabaseState};
use reqwest::multipart::{Form, Part};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{Manager, State};
use tokio::process::Command;

const SETTINGS_NS: &str = "video_import_settings";

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalParakeetStatus {
    available: bool,
    executable: Option<String>,
    detail: String,
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

fn setting(conn: &rusqlite::Connection, key: &str, default: &str) -> Result<String, String> {
    Ok(kv_get(conn, SETTINGS_NS, key)?.unwrap_or_else(|| default.to_string()))
}

fn load_settings(
    project_path: &str,
    state: &State<'_, DatabaseState>,
) -> Result<TranscriptionSettings, String> {
    let connections = state.connections.lock().unwrap();
    let conn = connections
        .get(project_path)
        .ok_or("Database not initialized for this project")?;
    Ok(TranscriptionSettings {
        mode: setting(conn, "transcription_mode", "automatic")?,
        remote_endpoint: setting(conn, "remote_endpoint", "")?,
        remote_api_key: setting(conn, "remote_api_key", "")?,
        remote_model: setting(conn, "remote_model", "nvidia/parakeet-tdt-0.6b-v3")?,
        local_command: setting(conn, "local_command", "parakeet-mlx")?,
        local_args: setting(
            conn,
            "local_args",
            "{audio} --output-dir {outputDir} --output-format json --highlight-words",
        )?,
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

async fn command_available(command: &str) -> bool {
    if command.contains(std::path::MAIN_SEPARATOR) {
        return Path::new(command).is_file();
    }
    let mut probe = Command::new("sh");
    probe.args(["-lc", &format!("command -v {}", shell_escape(command))]);
    for (key, value) in cached_login_shell_env().await {
        probe.env(key, value);
    }
    probe.stdout(Stdio::null()).stderr(Stdio::null());
    probe.status().await.map(|s| s.success()).unwrap_or(false)
}

fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
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
    let output = Command::new("ffprobe")
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
    let result = Command::new("ffmpeg")
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
    let count = ((duration_ms / 30_000) + 4).clamp(4, 16);
    let mut frames = Vec::new();
    for index in 0..count {
        let timestamp_ms = if count <= 1 {
            0
        } else {
            duration_ms.saturating_mul(index) / (count - 1)
        };
        let path = dir.join(format!("frame-{index:03}-{timestamp_ms}ms.jpg"));
        let result = Command::new("ffmpeg")
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

async fn transcribe_local(
    audio: &Path,
    settings: &TranscriptionSettings,
    duration_ms: u64,
    model_cache: &Path,
    raw_output: &Path,
) -> Result<Vec<TranscriptSegment>, String> {
    if !command_available(&settings.local_command).await {
        return Err(format!("Local Parakeet is not installed (command: {}). Configure Remote transcription or install the local runtime in Settings.", settings.local_command));
    }
    let output_dir = audio.parent().unwrap_or_else(|| Path::new("."));
    let mut command = Command::new(&settings.local_command);
    command.args(expand_local_args(&settings.local_args, audio, output_dir));
    command.env("PARAKEET_CACHE_DIR", model_cache);
    for (key, value) in cached_login_shell_env().await {
        command.env(key, value);
    }
    let output = command
        .output()
        .await
        .map_err(|e| format!("Could not start local Parakeet: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Local Parakeet failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
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
) -> Result<(Vec<TranscriptSegment>, String), String> {
    match settings.mode.as_str() {
        "remote" => Ok((transcribe_remote(audio, settings, duration_ms, raw_output).await?, "remote".to_string())),
        "local" => Ok((transcribe_local(audio, settings, duration_ms, model_cache, raw_output).await?, "local".to_string())),
        _ if !settings.remote_endpoint.trim().is_empty() => match transcribe_remote(audio, settings, duration_ms, raw_output).await {
            Ok(result) => Ok((result, "remote".to_string())),
            Err(remote_error) => transcribe_local(audio, settings, duration_ms, model_cache, raw_output).await
                .map(|result| (result, "local".to_string()))
                .map_err(|local_error| format!("Remote transcription failed ({remote_error}). Local fallback failed ({local_error}).")),
        },
        _ => Ok((transcribe_local(audio, settings, duration_ms, model_cache, raw_output).await?, "local".to_string())),
    }
}

#[tauri::command]
pub async fn video_import_local_status() -> LocalParakeetStatus {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return LocalParakeetStatus {
            available: false,
            executable: None,
            detail: "Managed Local Parakeet currently requires Apple Silicon. Configure a remote endpoint on this platform.".to_string(),
        };
    }
    let command = "parakeet-mlx";
    let available = command_available(command).await;
    LocalParakeetStatus {
        available,
        executable: available.then(|| command.to_string()),
        detail: if available {
            "Local Parakeet is ready".to_string()
        } else {
            "Local Parakeet is not installed".to_string()
        },
    }
}

#[tauri::command]
pub async fn video_import_install_local() -> Result<LocalParakeetStatus, String> {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Err(
            "Managed Local Parakeet currently requires Apple Silicon. Configure Remote transcription on this platform."
                .to_string(),
        );
    }
    if command_available("parakeet-mlx").await {
        return Ok(video_import_local_status().await);
    }
    if !command_available("uv").await {
        return Err(
            "Local Parakeet needs the 'uv' runtime. Install uv or configure a Remote transcription endpoint."
                .to_string(),
        );
    }
    let mut command = Command::new("uv");
    command.args(["tool", "install", "parakeet-mlx"]);
    for (key, value) in cached_login_shell_env().await {
        command.env(key, value);
    }
    let output = command
        .output()
        .await
        .map_err(|e| format!("Could not install Local Parakeet: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Local Parakeet installation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(video_import_local_status().await)
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
    app: tauri::AppHandle,
) -> Result<VideoMediaAnalysis, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err("Choose an existing video file".to_string());
    }
    let settings = load_settings(&project_path, &db_state)?;
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
