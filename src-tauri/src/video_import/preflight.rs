//! What the local transcription runtime needs, checked before anything runs.
//!
//! Local Parakeet is a Python tool driven by `uv`, and both come from the
//! machine rather than from us. That is a deliberate choice — pinning a
//! runtime means owning it — but it means the machine can be wrong in ways we
//! must name *before* we start, not discover halfway through an install.
//!
//! So every dependency is probed up front and reported as its own line: what
//! we needed, what we found, and the one command that fixes it. A machine that
//! cannot run local transcription says so in a sentence. It never gets there
//! by way of a traceback.

use crate::machine::{
    dependency, format_version, meets_minimum, parse_version, run_probe, Check,
    DEFAULT_PROBE_TIMEOUT,
};
use serde::Serialize;
use std::path::{Path, PathBuf};

pub(crate) use crate::machine::resolve_executable;

/// The oldest `uv` whose behaviour this integration is written against:
/// `UV_TOOL_DIR` / `UV_TOOL_BIN_DIR` honoured on `tool install`, and
/// `uv python find <specifier>`. Older releases may well work; we simply do
/// not claim they do, and saying so is cheaper than a surprise later.
pub const MIN_UV_VERSION: (u64, u64, u64) = (0, 5, 0);

/// `parakeet-mlx` and every wheel underneath it (mlx, numba, librosa) declare
/// `Requires-Python: >=3.10`.
pub const MIN_PYTHON: &str = ">=3.10";

/// The check whose failure is not a problem — it is what the Install button is
/// for.
pub const RUNTIME_CHECK_ID: &str = "runtime";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preflight {
    /// Everything is in place and a transcription can run right now.
    pub ready: bool,
    /// Every dependency holds; only the runtime itself is still missing, so
    /// installing it is worth offering.
    pub can_install: bool,
    pub checks: Vec<Check>,
    /// Where an install would put the tool environment and its executable.
    pub runtime_dir: String,
    /// Absolute path to the runtime executable, once there is one. Resolved
    /// here so nothing downstream has to gamble on PATH.
    pub executable: Option<String>,
}

/// `ready` needs every check; `can_install` needs every check *except* the
/// runtime itself — that is precisely the state the Install button serves.
pub fn summarise(checks: &[Check]) -> (bool, bool) {
    let ready = checks.iter().all(|check| check.ok);
    let can_install = checks
        .iter()
        .all(|check| check.ok || check.id == RUNTIME_CHECK_ID);
    (ready, can_install)
}

/// `uv --version` prints `uv 0.6.6 (c1a0bb85e 2025-03-12)`; a pre-release such
/// as `0.9.0-alpha.1` still carries a usable patch.
const UV_VERSION_PATTERN: &str = r"^uv (\d+)\.(\d+)(?:\.(\d+))?";

pub fn parse_uv_version(raw: &str) -> Option<(u64, u64, u64)> {
    parse_version(raw, UV_VERSION_PATTERN)
}

async fn run(program: &Path, args: &[&str]) -> Option<(bool, String)> {
    let output = run_probe(program, args, DEFAULT_PROBE_TIMEOUT).await?;
    Some((output.success(), output.combined()))
}

async fn check_platform() -> Check {
    let requirement = "macOS on Apple Silicon";
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Check::ok(
            "platform",
            "Platform",
            requirement,
            "macOS (Apple Silicon)",
            "Supported.",
        )
    } else {
        Check::failed(
            "platform",
            "Platform",
            requirement,
            Some(format!("{} ({})", std::env::consts::OS, std::env::consts::ARCH)),
            "The local runtime is built on MLX, which runs on Apple Silicon only. Use a remote endpoint on this machine.",
            None,
        )
    }
}

async fn check_uv() -> (Check, Option<PathBuf>) {
    let requirement = format!("uv {} or newer", format_version(MIN_UV_VERSION));
    let Some(path) = resolve_executable("uv").await else {
        return (
            Check::failed(
                "uv",
                "uv",
                &requirement,
                None,
                "uv was not found. It installs and isolates the Python tool this runtime is built on.",
                Some("curl -LsSf https://astral.sh/uv/install.sh | sh"),
            ),
            None,
        );
    };
    let Some((success, output)) = run(&path, &["--version"]).await else {
        return (
            Check::failed(
                "uv",
                "uv",
                &requirement,
                Some(path.to_string_lossy().to_string()),
                "uv was found but did not respond to 'uv --version'.",
                None,
            ),
            None,
        );
    };
    let version = success.then(|| parse_uv_version(&output)).flatten();
    match version {
        Some(found) if meets_minimum(found, MIN_UV_VERSION) => (
            Check::ok("uv", "uv", &requirement, format_version(found), "Supported."),
            Some(path),
        ),
        Some(found) => (
            Check::failed(
                "uv",
                "uv",
                &requirement,
                Some(format_version(found)),
                "This uv is older than the version this integration is written against.",
                Some("uv self update"),
            ),
            None,
        ),
        None => (
            Check::failed(
                "uv",
                "uv",
                &requirement,
                Some(path.to_string_lossy().to_string()),
                "uv's version could not be read, so it cannot be checked against what this runtime needs.",
                None,
            ),
            None,
        ),
    }
}

async fn check_python(uv: Option<&PathBuf>) -> Check {
    let requirement = format!("Python {MIN_PYTHON}");
    let Some(uv) = uv else {
        return Check::failed(
            "python",
            "Python",
            &requirement,
            None,
            "Cannot be checked until uv is available — uv is what locates and, if needed, downloads a suitable Python.",
            None,
        );
    };
    match run(uv, &["python", "find", MIN_PYTHON]).await {
        // uv prints the interpreter path on success and an `error:` line
        // otherwise, so the path has to exist for this to count.
        Some((true, output)) => {
            let found = output.lines().next().unwrap_or_default().trim().to_string();
            if !found.is_empty() && Path::new(&found).is_file() {
                Check::ok("python", "Python", &requirement, found, "Supported.")
            } else {
                Check::failed(
                    "python",
                    "Python",
                    &requirement,
                    None,
                    "No Python 3.10 or newer was found. uv can install one for you.",
                    Some("uv python install 3.12"),
                )
            }
        }
        _ => Check::failed(
            "python",
            "Python",
            &requirement,
            None,
            "No Python 3.10 or newer was found. uv can install one for you.",
            Some("uv python install 3.12"),
        ),
    }
}

async fn check_media_tool(name: &'static str) -> Check {
    media_tool_check(name, resolve_executable(name).await)
}

fn media_tool_check(name: &'static str, found: Option<PathBuf>) -> Check {
    match found {
        Some(path) => Check::ok(
            name,
            name,
            "on PATH",
            path.to_string_lossy().to_string(),
            "Found.",
        ),
        None => Check::failed(
            name,
            name,
            "on PATH",
            None,
            "Not found. Video import needs it to read the video and extract its audio.",
            dependency(name).map(|row| row.fix),
        ),
    }
}

/// The runtime executable, looked for where *we* put it rather than wherever
/// PATH happens to point. `uv tool install` exits 0 with only a warning when
/// its bin directory is not on PATH, so a PATH-based check reports a runtime
/// that installed perfectly well as missing.
pub fn runtime_executable(runtime_dir: &Path) -> Option<PathBuf> {
    let candidate = runtime_dir.join("bin").join("parakeet-mlx");
    candidate.is_file().then_some(candidate)
}

async fn check_runtime(runtime_dir: &Path) -> (Check, Option<PathBuf>) {
    match runtime_executable(runtime_dir) {
        Some(path) => (
            Check::ok(
                RUNTIME_CHECK_ID,
                "Local Parakeet",
                "installed",
                path.to_string_lossy().to_string(),
                "Installed and ready.",
            ),
            Some(path),
        ),
        None => (
            Check::failed(
                RUNTIME_CHECK_ID,
                "Local Parakeet",
                "installed",
                None,
                "Not installed yet.",
                None,
            ),
            None,
        ),
    }
}

/// Probe everything the local runtime depends on, in the order a reader would
/// want to fix them.
pub async fn inspect(runtime_dir: &Path) -> Preflight {
    let platform = check_platform().await;
    let (uv, uv_path) = check_uv().await;
    let python = check_python(uv_path.as_ref()).await;
    let ffmpeg = check_media_tool("ffmpeg").await;
    let ffprobe = check_media_tool("ffprobe").await;
    let (runtime, executable) = check_runtime(runtime_dir).await;

    let checks = vec![platform, uv, python, ffmpeg, ffprobe, runtime];
    let (ready, can_install) = summarise(&checks);
    Preflight {
        ready,
        can_install,
        checks,
        runtime_dir: runtime_dir.to_string_lossy().to_string(),
        executable: executable.map(|path| path.to_string_lossy().to_string()),
    }
}

#[cfg(test)]
#[path = "preflight_tests.rs"]
mod tests;
