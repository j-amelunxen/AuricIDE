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

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightCheck {
    pub id: String,
    pub label: String,
    pub ok: bool,
    /// What is actually on this machine, when we could determine it.
    pub found: Option<String>,
    pub requirement: String,
    /// One sentence. Never tool output.
    pub detail: String,
    /// A single command the reader can copy, when one exists.
    pub fix: Option<String>,
}

impl PreflightCheck {
    fn ok(
        id: &str,
        label: &str,
        requirement: &str,
        found: impl Into<String>,
        detail: &str,
    ) -> Self {
        Self {
            id: id.to_string(),
            label: label.to_string(),
            ok: true,
            found: Some(found.into()),
            requirement: requirement.to_string(),
            detail: detail.to_string(),
            fix: None,
        }
    }

    fn failed(
        id: &str,
        label: &str,
        requirement: &str,
        found: Option<String>,
        detail: &str,
        fix: Option<&str>,
    ) -> Self {
        Self {
            id: id.to_string(),
            label: label.to_string(),
            ok: false,
            found,
            requirement: requirement.to_string(),
            detail: detail.to_string(),
            fix: fix.map(str::to_string),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preflight {
    /// Everything is in place and a transcription can run right now.
    pub ready: bool,
    /// Every dependency holds; only the runtime itself is still missing, so
    /// installing it is worth offering.
    pub can_install: bool,
    pub checks: Vec<PreflightCheck>,
    /// Where an install would put the tool environment and its executable.
    pub runtime_dir: String,
    /// Absolute path to the runtime executable, once there is one. Resolved
    /// here so nothing downstream has to gamble on PATH.
    pub executable: Option<String>,
}

/// `ready` needs every check; `can_install` needs every check *except* the
/// runtime itself — that is precisely the state the Install button serves.
pub fn summarise(checks: &[PreflightCheck]) -> (bool, bool) {
    let ready = checks.iter().all(|check| check.ok);
    let can_install = checks
        .iter()
        .all(|check| check.ok || check.id == RUNTIME_CHECK_ID);
    (ready, can_install)
}

/// `uv --version` prints `uv 0.6.6 (c1a0bb85e 2025-03-12)`.
pub fn parse_uv_version(raw: &str) -> Option<(u64, u64, u64)> {
    let token = raw.split_whitespace().nth(1)?;
    let mut parts = token.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    // Pre-release suffixes such as `0.9.0-alpha.1` still carry a usable patch.
    let patch = parts
        .next()
        .map(|part| {
            part.chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
        })
        .and_then(|digits| digits.parse().ok())
        .unwrap_or(0);
    Some((major, minor, patch))
}

pub fn meets_minimum(found: (u64, u64, u64), minimum: (u64, u64, u64)) -> bool {
    found >= minimum
}

pub fn format_version(version: (u64, u64, u64)) -> String {
    format!("{}.{}.{}", version.0, version.1, version.2)
}

/// Find an executable by walking a PATH value, without asking a shell. The
/// existence test is injected so the decision can be tested without a disk.
pub fn resolve_in_path(
    name: &str,
    path_var: &str,
    is_executable: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    // An explicit path is already an answer, right or wrong.
    if name.contains(std::path::MAIN_SEPARATOR) {
        let candidate = PathBuf::from(name);
        return is_executable(&candidate).then_some(candidate);
    }
    path_var
        .split(':')
        .filter(|entry| !entry.is_empty())
        .map(|entry| Path::new(entry).join(name))
        .find(|candidate| is_executable(candidate))
}

fn on_disk(path: &Path) -> bool {
    path.is_file()
}

/// The PATH the user's shell would give us, which is rarely the PATH a bundled
/// app inherits from launchd.
async fn shell_path() -> String {
    crate::agents::cached_login_shell_env()
        .await
        .iter()
        .find(|(key, _)| key == "PATH")
        .map(|(_, value)| value.clone())
        .or_else(|| std::env::var("PATH").ok())
        .unwrap_or_default()
}

/// Absolute path to an executable, resolved through the login shell's PATH.
/// Every command this feature spawns goes through here — a bare
/// `Command::new("ffmpeg")` finds nothing when the app is launched from
/// `/Applications`.
pub async fn resolve_executable(name: &str) -> Option<PathBuf> {
    resolve_in_path(name, &shell_path().await, &on_disk)
}

async fn run(program: &Path, args: &[&str]) -> Option<(bool, String)> {
    let mut command = Command::new(program);
    command.args(args);
    for (key, value) in crate::agents::cached_login_shell_env().await {
        command.env(key, value);
    }
    command.stdin(Stdio::null());
    let output = tokio::time::timeout(std::time::Duration::from_secs(30), command.output())
        .await
        .ok()?
        .ok()?;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Some((output.status.success(), text))
}

async fn check_platform() -> PreflightCheck {
    let requirement = "macOS on Apple Silicon";
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        PreflightCheck::ok(
            "platform",
            "Platform",
            requirement,
            "macOS (Apple Silicon)",
            "Supported.",
        )
    } else {
        PreflightCheck::failed(
            "platform",
            "Platform",
            requirement,
            Some(format!("{} ({})", std::env::consts::OS, std::env::consts::ARCH)),
            "The local runtime is built on MLX, which runs on Apple Silicon only. Use a remote endpoint on this machine.",
            None,
        )
    }
}

async fn check_uv() -> (PreflightCheck, Option<PathBuf>) {
    let requirement = format!("uv {} or newer", format_version(MIN_UV_VERSION));
    let Some(path) = resolve_executable("uv").await else {
        return (
            PreflightCheck::failed(
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
            PreflightCheck::failed(
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
            PreflightCheck::ok("uv", "uv", &requirement, format_version(found), "Supported."),
            Some(path),
        ),
        Some(found) => (
            PreflightCheck::failed(
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
            PreflightCheck::failed(
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

async fn check_python(uv: Option<&PathBuf>) -> PreflightCheck {
    let requirement = format!("Python {MIN_PYTHON}");
    let Some(uv) = uv else {
        return PreflightCheck::failed(
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
                PreflightCheck::ok("python", "Python", &requirement, found, "Supported.")
            } else {
                PreflightCheck::failed(
                    "python",
                    "Python",
                    &requirement,
                    None,
                    "No Python 3.10 or newer was found. uv can install one for you.",
                    Some("uv python install 3.12"),
                )
            }
        }
        _ => PreflightCheck::failed(
            "python",
            "Python",
            &requirement,
            None,
            "No Python 3.10 or newer was found. uv can install one for you.",
            Some("uv python install 3.12"),
        ),
    }
}

async fn check_media_tool(name: &'static str) -> PreflightCheck {
    match resolve_executable(name).await {
        Some(path) => PreflightCheck::ok(
            name,
            name,
            "on PATH",
            path.to_string_lossy().to_string(),
            "Found.",
        ),
        None => PreflightCheck::failed(
            name,
            name,
            "on PATH",
            None,
            "Not found. Video import needs it to read the video and extract its audio.",
            Some("brew install ffmpeg"),
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

async fn check_runtime(runtime_dir: &Path) -> (PreflightCheck, Option<PathBuf>) {
    match runtime_executable(runtime_dir) {
        Some(path) => (
            PreflightCheck::ok(
                RUNTIME_CHECK_ID,
                "Local Parakeet",
                "installed",
                path.to_string_lossy().to_string(),
                "Installed and ready.",
            ),
            Some(path),
        ),
        None => (
            PreflightCheck::failed(
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
mod tests {
    use super::*;

    fn check(id: &str, ok: bool) -> PreflightCheck {
        PreflightCheck {
            id: id.to_string(),
            label: id.to_string(),
            ok,
            found: None,
            requirement: String::new(),
            detail: String::new(),
            fix: None,
        }
    }

    #[test]
    fn reads_the_version_uv_actually_prints() {
        assert_eq!(
            parse_uv_version("uv 0.6.6 (c1a0bb85e 2025-03-12)"),
            Some((0, 6, 6))
        );
    }

    #[test]
    fn reads_a_prerelease_version() {
        assert_eq!(parse_uv_version("uv 0.9.0-alpha.1"), Some((0, 9, 0)));
    }

    #[test]
    fn unreadable_version_output_is_none_rather_than_a_guess() {
        assert_eq!(parse_uv_version(""), None);
        assert_eq!(parse_uv_version("uv"), None);
        assert_eq!(parse_uv_version("command not found: uv"), None);
    }

    #[test]
    fn version_comparison_orders_by_component_not_by_string() {
        // The string comparison this replaces reads "0.10.0" as older than
        // "0.9.0", which would reject a perfectly current uv.
        assert!(meets_minimum((0, 10, 0), (0, 9, 0)));
        assert!(meets_minimum((0, 5, 0), MIN_UV_VERSION));
        assert!(!meets_minimum((0, 4, 30), MIN_UV_VERSION));
    }

    /// A missing runtime is the normal state before setup — it must not make
    /// the Install button unavailable.
    #[test]
    fn only_the_runtime_check_may_fail_and_still_allow_installing() {
        let checks = vec![
            check("platform", true),
            check("uv", true),
            check(RUNTIME_CHECK_ID, false),
        ];
        assert_eq!(summarise(&checks), (false, true));
    }

    #[test]
    fn a_failing_dependency_blocks_installing() {
        let checks = vec![
            check("platform", true),
            check("uv", false),
            check(RUNTIME_CHECK_ID, false),
        ];
        assert_eq!(summarise(&checks), (false, false));
    }

    #[test]
    fn everything_green_is_ready() {
        let checks = vec![check("uv", true), check(RUNTIME_CHECK_ID, true)];
        assert_eq!(summarise(&checks), (true, true));
    }

    /// Runs the real probes against the real machine. Ignored by default
    /// because the answer depends on what is installed here, but this is the
    /// only place the probes are checked where they actually act — against
    /// uv, Python and ffmpeg rather than against a mock of them.
    ///
    /// `cargo test -p auric-ide -- --ignored --nocapture inspects_this_machine`
    #[tokio::test]
    #[ignore = "depends on what is installed on the machine running it"]
    async fn inspects_this_machine() {
        let dir = std::env::temp_dir().join("auric-preflight-probe");
        let report = inspect(&dir).await;
        for check in &report.checks {
            println!(
                "{:<16} ok={:<5} found={:?} detail={}",
                check.label, check.ok, check.found, check.detail
            );
        }
        println!("ready={} can_install={}", report.ready, report.can_install);
        // Whatever this machine has, every check must have reached a verdict
        // with a sentence attached — an empty detail is a check that would
        // leave the user guessing.
        assert!(!report.checks.is_empty());
        for check in &report.checks {
            assert!(!check.detail.is_empty(), "{} has no detail", check.label);
            assert!(
                !check.requirement.is_empty(),
                "{} states no requirement",
                check.label
            );
        }
    }

    #[test]
    fn path_lookup_walks_entries_in_order() {
        let exists = |path: &Path| path == Path::new("/opt/homebrew/bin/ffmpeg");
        assert_eq!(
            resolve_in_path("ffmpeg", "/usr/bin:/opt/homebrew/bin", &exists),
            Some(PathBuf::from("/opt/homebrew/bin/ffmpeg"))
        );
    }

    #[test]
    fn path_lookup_reports_absence_rather_than_a_bare_name() {
        let exists = |_: &Path| false;
        assert_eq!(resolve_in_path("ffmpeg", "/usr/bin:/bin", &exists), None);
        assert_eq!(resolve_in_path("ffmpeg", "", &exists), None);
    }

    #[test]
    fn an_explicit_path_is_checked_not_searched() {
        let exists = |path: &Path| path == Path::new("/custom/parakeet");
        assert_eq!(
            resolve_in_path("/custom/parakeet", "/usr/bin", &exists),
            Some(PathBuf::from("/custom/parakeet"))
        );
        assert_eq!(
            resolve_in_path("/missing/parakeet", "/usr/bin", &exists),
            None
        );
    }
}
