//! The tools features need from the machine, declared as rows.
//!
//! Adding the next tool is a row plus a captured `--version` sample. The
//! checks that are not simple (platform, `uv` + Python, the parakeet runtime
//! folder) stay in `video_import` and use the same mechanism.

use super::cache::{modified_at, versions, VersionProbe};
use super::probe::{run_probe, DEFAULT_PROBE_TIMEOUT};
use super::resolve::{expand_home, resolve_executable_in, Resolved};
use super::version::{format_version, meets_minimum, parse_version, Version};
use super::Check;
use serde::Serialize;
use std::path::PathBuf;

pub struct Dependency {
    pub name: &'static str,
    pub version_args: &'static [&'static str],
    /// Capture groups: major, minor, optional patch.
    pub version_pattern: &'static str,
    pub minimum: Option<Version>,
    /// Looked at after PATH, `~/` expanded.
    pub extra_dirs: &'static [&'static str],
    pub fix: &'static str,
    /// Names of the features that need this tool, for the Machine page.
    pub features: &'static [&'static str],
    /// A tool this one cannot be installed without; while that is missing,
    /// its fix is shown instead.
    pub requires: Option<&'static str>,
}

const FFMPEG_VERSION_PATTERN: &str = r"^ffmpeg version n?(\d+)\.(\d+)(?:\.(\d+))?";
const FFPROBE_VERSION_PATTERN: &str = r"^ffprobe version n?(\d+)\.(\d+)(?:\.(\d+))?";

/// Rows follow `machine` in `supervisorManagers.fixtures.json` (okf, go) and
/// the video-import tools. Change the fixture first.
pub const DEPENDENCIES: &[Dependency] = &[
    Dependency {
        name: "ffmpeg",
        version_args: &["-version"],
        version_pattern: FFMPEG_VERSION_PATTERN,
        minimum: None,
        extra_dirs: &[],
        fix: "brew install ffmpeg",
        features: &["Video import"],
        requires: None,
    },
    Dependency {
        name: "ffprobe",
        version_args: &["-version"],
        version_pattern: FFPROBE_VERSION_PATTERN,
        minimum: None,
        extra_dirs: &[],
        fix: "brew install ffmpeg",
        features: &["Video import"],
        requires: None,
    },
    Dependency {
        name: "go",
        version_args: &["version"],
        version_pattern: r"^go version go(\d+)\.(\d+)(?:\.(\d+))?",
        minimum: Some((1, 21, 0)),
        extra_dirs: &[],
        fix: "brew install go",
        features: &["okf"],
        requires: None,
    },
    Dependency {
        name: "okf",
        version_args: &["--version"],
        version_pattern: r"^okf version v(\d+)\.(\d+)\.(\d+)",
        minimum: Some((0, 7, 0)),
        extra_dirs: &["~/go/bin"],
        fix: "go install github.com/okf-memory/okf-agent-memory/cmd/okf@latest",
        features: &["Project Manager memory check"],
        requires: Some("go"),
    },
];

pub fn dependency(name: &str) -> Option<&'static Dependency> {
    DEPENDENCIES.iter().find(|row| row.name == name)
}

/// What the Settings page shows per row: the check plus who needs the tool.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyReport {
    #[serde(flatten)]
    pub check: Check,
    pub features: Vec<String>,
}

/// What the machine said about one row, gathered before judging it.
pub struct Observation {
    pub resolved: Option<Resolved>,
    /// `None` when the tool did not answer its version probe.
    pub probe: Option<VersionProbe>,
}

impl Dependency {
    fn requirement(&self) -> String {
        match self.minimum {
            Some(minimum) => format!("{} {} or newer", self.name, format_version(minimum)),
            None => "on PATH".to_string(),
        }
    }

    fn extra_folders(&self) -> Vec<PathBuf> {
        let home = dirs::home_dir();
        self.extra_dirs
            .iter()
            .map(|folder| expand_home(folder, home.as_deref()))
            .collect()
    }

    /// Pure judgement of what was observed. `requirement_missing` says that
    /// the tool named in `requires` is not there either.
    pub fn judge(&self, observation: &Observation, requirement_missing: bool) -> Check {
        let requirement = self.requirement();
        let Some(resolved) = &observation.resolved else {
            let fix = match (self.requires, requirement_missing) {
                (Some(required), true) => dependency(required).map_or(self.fix, |row| row.fix),
                _ => self.fix,
            };
            return Check::failed(
                self.name,
                self.name,
                &requirement,
                None,
                &format!("{} was not found.", self.name),
                Some(fix),
            );
        };
        let location = resolved.path.to_string_lossy().to_string();
        let found_text = |version: Option<Version>| {
            let base = version.map_or_else(|| location.clone(), format_version);
            if resolved.outside_path {
                format!("{base} (found outside PATH, at {location})")
            } else {
                base
            }
        };
        match observation.probe {
            None => Check::failed(
                self.name,
                self.name,
                &requirement,
                Some(found_text(None)),
                &format!(
                    "{} was found but did not respond to '{} {}'.",
                    self.name,
                    self.name,
                    self.version_args.join(" ")
                ),
                None,
            ),
            Some(VersionProbe::Unreadable) if self.minimum.is_some() => Check::failed(
                self.name,
                self.name,
                &requirement,
                Some(found_text(None)),
                &format!(
                    "{}'s version could not be read, so it cannot be checked against what is needed.",
                    self.name
                ),
                None,
            ),
            Some(VersionProbe::Unreadable) => {
                Check::ok(self.name, self.name, &requirement, found_text(None), "Found.")
            }
            Some(VersionProbe::Version(found)) => match self.minimum {
                Some(minimum) if !meets_minimum(found, minimum) => Check::failed(
                    self.name,
                    self.name,
                    &requirement,
                    Some(found_text(Some(found))),
                    &format!(
                        "This {} is older than the version it is checked against.",
                        self.name
                    ),
                    Some(self.fix),
                ),
                _ => Check::ok(
                    self.name,
                    self.name,
                    &requirement,
                    found_text(Some(found)),
                    "Found.",
                ),
            },
        }
    }

    /// Resolve and probe this tool now. Resolving is never cached; the version
    /// answer is, per binary.
    pub async fn observe(&self) -> Observation {
        let resolved = resolve_executable_in(self.name, &self.extra_folders()).await;
        let probe = match &resolved {
            Some(found) => self.probe_version(&found.path).await,
            None => None,
        };
        Observation { resolved, probe }
    }

    async fn probe_version(&self, path: &std::path::Path) -> Option<VersionProbe> {
        let mtime = modified_at(path);
        if let Some(cached) = mtime.and_then(|time| versions().get(path, time)) {
            return Some(cached);
        }
        let output = run_probe(path, self.version_args, DEFAULT_PROBE_TIMEOUT).await?;
        let probe = output
            .success()
            .then(|| parse_version(&output.combined(), self.version_pattern))
            .flatten()
            .map_or(VersionProbe::Unreadable, VersionProbe::Version);
        if let Some(time) = mtime {
            versions().put(path, time, probe);
        }
        Some(probe)
    }

    pub async fn inspect(&self) -> DependencyReport {
        let observation = self.observe().await;
        let requirement_missing = match self.requires.and_then(dependency) {
            Some(required) => required.observe().await.resolved.is_none(),
            None => false,
        };
        DependencyReport {
            check: self.judge(&observation, requirement_missing),
            features: self
                .features
                .iter()
                .map(|name| (*name).to_string())
                .collect(),
        }
    }
}

pub async fn inspect_all() -> Vec<DependencyReport> {
    let mut reports = Vec::with_capacity(DEPENDENCIES.len());
    for row in DEPENDENCIES {
        reports.push(row.inspect().await);
    }
    reports
}

#[cfg(test)]
#[path = "table_tests.rs"]
mod tests;
