use super::failure::Stage;
use super::preflight::{self, resolve_executable};
use super::{
    tool_error, write_log, TranscriptSegment, TranscriptionSettings, VideoFrame,
    DEFAULT_LOCAL_COMMAND,
};
use crate::agents::cached_login_shell_env;
use reqwest::multipart::{Form, Part};
use std::path::{Path, PathBuf};
use tokio::process::Command;

pub fn safe_source_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("video")
        .to_string()
}

pub fn import_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("video-{millis}")
}

pub async fn media_tool(name: &'static str) -> Result<PathBuf, String> {
    resolve_executable(name).await.ok_or_else(|| {
        format!("{name} was not found. Video import needs it to read the video and extract its audio. Install it, for example with 'brew install ffmpeg'.")
    })
}

pub fn parse_duration_ms(raw: &[u8]) -> Result<u64, String> {
    let text = String::from_utf8_lossy(raw);
    let seconds: f64 = text
        .trim()
        .parse()
        .map_err(|_| format!("ffprobe returned an invalid duration: {}", text.trim()))?;
    Ok((seconds.max(0.0) * 1000.0).round() as u64)
}

pub async fn video_duration_ms(source: &Path) -> Result<u64, String> {
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

pub async fn extract_audio(source: &Path, output: &Path) -> Result<(), String> {
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

pub async fn extract_frames(
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

pub fn json_segments(value: &serde_json::Value, duration_ms: u64) -> Vec<TranscriptSegment> {
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

pub fn parse_transcription(raw: &[u8], duration_ms: u64) -> Result<Vec<TranscriptSegment>, String> {
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

pub async fn transcribe_remote(
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

pub fn expand_local_args(template: &str, audio: &Path, output_dir: &Path) -> Vec<String> {
    template
        .split_whitespace()
        .map(|arg| {
            arg.replace("{audio}", &audio.to_string_lossy())
                .replace("{outputDir}", &output_dir.to_string_lossy())
        })
        .collect()
}

pub async fn local_executable(
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

pub async fn transcribe_local(
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
        std::fs::write(raw_output, &output.stdout).map_err(|e| e.to_string())?;
        parse_transcription(&output.stdout, duration_ms)
    }
}

pub async fn transcribe(
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
                Err(remote_error) => local()
                    .await
                    .map(|result| (result, "local".to_string()))
                    .map_err(|local_error| combine_lane_failures(&remote_error, local_error)),
            }
        }
        _ => Ok((local().await?, "local".to_string())),
    }
}

pub fn combine_lane_failures(remote_error: &str, local_error: String) -> String {
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
