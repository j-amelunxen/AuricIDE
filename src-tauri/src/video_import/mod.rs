mod failure;
mod installer;
mod media;
mod preflight;

#[cfg(test)]
mod tests;

pub use media::*;
pub use preflight::Preflight;

use crate::database::{kv_get, DatabaseState};
use failure::{describe_failure, FailureReport, Stage};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

const SETTINGS_NS: &str = "video_import_settings";

/// The runtime AuricIDE installs and manages itself. A `local_command` equal
/// to this means "whatever Setup produced"; anything else is the user's own
/// choice and is honoured verbatim.
pub const DEFAULT_LOCAL_COMMAND: &str = "parakeet-mlx";

/// Full tool output is written next to the work it belongs to. The UI shows a
/// sentence; this is where the rest goes when the sentence is not enough.
pub fn write_log(path: PathBuf, contents: &str) -> Option<String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }
    std::fs::write(&path, contents).ok()?;
    Some(path.to_string_lossy().to_string())
}

/// `<app_data_dir>/runtime` — the tool environment, its executable and the
/// model cache all live here, so uninstalling is deleting a directory and
/// nothing on the machine outside it is touched.
pub fn runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime"))
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub confidence: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFrame {
    pub timestamp_ms: u64,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMediaAnalysis {
    pub import_id: String,
    pub source_path: String,
    pub source_name: String,
    pub duration_ms: u64,
    pub workspace_path: String,
    pub transcript: Vec<TranscriptSegment>,
    pub frames: Vec<VideoFrame>,
    pub transcription_provider: String,
}

/// A failure the UI can render without ever showing a traceback: one sentence,
/// the trimmed output behind a fold, and the full log on disk.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolFailure {
    pub summary: String,
    pub details: String,
    pub log_path: Option<String>,
}

impl ToolFailure {
    pub fn new(report: FailureReport, log_path: Option<String>) -> Self {
        Self {
            summary: report.summary,
            details: report.details,
            log_path,
        }
    }

    /// Errors cross the IPC boundary as strings, so the structured form is
    /// carried as JSON and unpacked by the caller. A serialisation failure
    /// must still not produce a traceback, hence the plain-sentence fallback.
    pub fn into_ipc_error(self) -> String {
        let summary = self.summary.clone();
        serde_json::to_string(&self).unwrap_or(summary)
    }
}

pub fn tool_error(stage: Stage, raw: &str, log_path: Option<String>) -> String {
    ToolFailure::new(describe_failure(stage, raw), log_path).into_ipc_error()
}

#[derive(Default)]
pub struct TranscriptionSettings {
    pub mode: String,
    pub remote_endpoint: String,
    pub remote_api_key: String,
    pub remote_model: String,
    pub local_command: String,
    pub local_args: String,
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
pub fn load_settings(
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

/// Everything the local runtime needs, checked and reported per dependency.
/// Cheap enough to call whenever the settings panel opens.
#[tauri::command]
pub async fn video_import_preflight(app: tauri::AppHandle) -> Result<Preflight, String> {
    let runtime = runtime_dir(&app)?;
    Ok(preflight::inspect(&runtime).await)
}

#[tauri::command]
pub async fn video_import_install_local(app: tauri::AppHandle) -> Result<Preflight, String> {
    installer::install_local(&app).await
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
