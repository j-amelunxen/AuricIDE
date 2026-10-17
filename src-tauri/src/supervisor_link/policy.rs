//! What the supervisor link may show and start per project
//! (`docs/design-supervisor-link.md`, "Who sees what").
//!
//! `<app_data_dir>/supervisor-link.json` is Rust-owned and written at 0600.
//! It fails closed: a missing, unreadable or unknown-version file means no
//! project is visible, never all of them, and a project entry that does not
//! validate is dropped rather than half-read. Paths are compared canonically
//! so a symlink and its target find the same entry.
//!
//! The link knows no document format and no job kind of its own. Both are
//! configuration: a project lists its document types (where the files are,
//! how to name them) and the job kinds a client may ask for (which
//! instructions an agent follows, which files it may write).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

use super::glob;
use crate::supervisor::canonical_project_path;

/// Fixture `policyFileName`.
pub const POLICY_FILE_NAME: &str = "supervisor-link.json";

/// The on-disk version this build writes. Version 1 is migrated on read.
const POLICY_VERSION: u32 = 2;

/// Fixture `jobs.defaultDailyLimit` / `jobs.maxDailyLimit`.
pub const DEFAULT_DAILY_LIMIT: u32 = 20;
pub const MAX_DAILY_LIMIT: u32 = 1000;

/// Where the documents of one type live and how a listing names them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentType {
    /// `^[a-z0-9][a-z0-9._-]*$`, unique within the project.
    pub name: String,
    /// Project-relative globs (`*`, `?`, `**`). A document is a file one of
    /// them matches.
    pub globs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<IndexFile>,
    /// Dotted path of a string in the document that names it in a listing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description_field: Option<String>,
    /// Project-relative path of a JSON schema. Handed to clients and agents;
    /// the IDE does not validate against it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
}

/// An optional file that names and tags documents:
/// `{ "<entriesKey>": [{ "id", "name", "description", "tags" }] }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndexFile {
    pub path: String,
    #[serde(default = "default_entries_key")]
    pub entries_key: String,
}

fn default_entries_key() -> String {
    "documents".to_string()
}

/// A job a client may ask for in this project. The IDE does not know what a
/// kind means: the agent reads `instructions` from the repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobKind {
    /// `^[a-z0-9][a-z0-9._-]*$`, unique within the project.
    pub kind: String,
    /// Project-relative path of the file that tells the agent how to do it.
    pub instructions: String,
    /// Globs the agent may write. Empty: the globs of every document type.
    #[serde(default)]
    pub writes: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectConfig {
    #[serde(default)]
    pub document_types: Vec<DocumentType>,
    #[serde(default)]
    pub job_kinds: Vec<JobKind>,
}

impl ProjectConfig {
    pub fn document_type(&self, name: &str) -> Option<&DocumentType> {
        self.document_types.iter().find(|t| t.name == name)
    }

    pub fn job_kind(&self, kind: &str) -> Option<&JobKind> {
        self.job_kinds.iter().find(|k| k.kind == kind)
    }

    /// What an agent of `kind` may write: its own globs, else every document
    /// type's.
    pub fn writes_of(&self, kind: &JobKind) -> Vec<String> {
        if !kind.writes.is_empty() {
            return kind.writes.clone();
        }
        self.document_types
            .iter()
            .flat_map(|t| t.globs.iter().cloned())
            .collect()
    }
}

/// The runaway counter on `jobs.create`: jobs started in any 24 hours, all
/// projects together and, when set, per project. `0` switches jobs off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobLimits {
    pub daily_limit: u32,
    #[serde(default)]
    pub per_project_daily_limit: Option<u32>,
}

impl Default for JobLimits {
    fn default() -> Self {
        Self {
            daily_limit: DEFAULT_DAILY_LIMIT,
            per_project_daily_limit: None,
        }
    }
}

/// The policy as the rest of the link sees it: canonical project paths, each
/// with its configuration, and the job counter.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPolicy {
    pub projects: BTreeMap<String, ProjectConfig>,
    #[serde(default)]
    pub jobs: JobLimits,
}

impl LinkPolicy {
    /// The configuration of `project`, both sides compared canonically.
    pub fn project(&self, project: &str) -> Option<(&String, &ProjectConfig)> {
        let wanted = canonical_project_path(project);
        self.projects
            .iter()
            .find(|(listed, _)| canonical_project_path(listed) == wanted)
    }
}

/// Version 2: `{ "version": 2, "projects": { path: ProjectConfig }, "jobs": … }`.
#[derive(Debug, Serialize, Deserialize)]
struct PolicyFileV2 {
    version: u32,
    #[serde(default)]
    projects: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    jobs: Option<JobLimits>,
}

/// Version 1 knew one document format with fixed places and names. Its
/// projects become projects with exactly that format as their one document
/// type, so nothing a client read before disappears.
#[derive(Debug, Deserialize)]
struct PolicyFileV1 {
    scenes: ScenesSectionV1,
}

#[derive(Debug, Deserialize)]
struct ScenesSectionV1 {
    #[serde(default)]
    projects: Vec<String>,
}

/// The document type a version-1 project had without naming it. Only the
/// migration knows these values.
fn v1_document_type() -> DocumentType {
    DocumentType {
        name: "scene".to_string(),
        globs: vec!["docs/**/*.scene.json".to_string()],
        index: Some(IndexFile {
            path: "docs/scenes.index.json".to_string(),
            entries_key: "scenes".to_string(),
        }),
        name_field: Some("hud.title".to_string()),
        description_field: Some("hud.subtitle".to_string()),
        schema: None,
    }
}

pub fn policy_path_in(app_data: &Path) -> PathBuf {
    app_data.join(POLICY_FILE_NAME)
}

fn is_valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && chars
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
        && name.len() <= 64
}

/// A project-relative file path: no leading `/`, no `.`/`..`/empty segment.
pub fn is_relative_file(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains('\\')
        && path
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn check_glob(owner: &str, pattern: &str) -> Result<(), String> {
    if !is_relative_file(pattern) || !glob::is_valid(pattern) {
        return Err(format!(
            "{owner}: \"{pattern}\" is not a project-relative glob"
        ));
    }
    Ok(())
}

/// Every rule a stored project entry must meet. The same check runs on read,
/// so a hand-edited entry that would not be written is not read either.
// code-gate: complexity-cyclomatic - one branch per field rule, each named in its own error
fn check_project(path: &str, config: &ProjectConfig) -> Result<(), String> {
    let mut seen = std::collections::BTreeSet::new();
    for document_type in &config.document_types {
        let owner = format!("{path}: document type \"{}\"", document_type.name);
        if !is_valid_name(&document_type.name) || !seen.insert(&document_type.name) {
            return Err(format!("{owner} needs a unique lowercase name"));
        }
        if document_type.globs.is_empty() {
            return Err(format!("{owner} has no globs"));
        }
        for pattern in &document_type.globs {
            check_glob(&owner, pattern)?;
        }
        let files = document_type
            .index
            .iter()
            .map(|index| &index.path)
            .chain(document_type.schema.iter());
        for file in files {
            if !is_relative_file(file) {
                return Err(format!(
                    "{owner}: \"{file}\" is not a project-relative path"
                ));
            }
        }
    }
    let mut kinds = std::collections::BTreeSet::new();
    for kind in &config.job_kinds {
        let owner = format!("{path}: job kind \"{}\"", kind.kind);
        if !is_valid_name(&kind.kind) || !kinds.insert(&kind.kind) {
            return Err(format!("{owner} needs a unique lowercase name"));
        }
        if !is_relative_file(&kind.instructions) {
            return Err(format!(
                "{owner}: instructions must be a project-relative file"
            ));
        }
        for pattern in &kind.writes {
            check_glob(&owner, pattern)?;
        }
        if config.writes_of(kind).is_empty() {
            return Err(format!(
                "{owner} may write nothing: name its writes or add a document type"
            ));
        }
    }
    Ok(())
}

fn check_limits(limits: &JobLimits) -> Result<(), String> {
    let too_high = |value: u32| value > MAX_DAILY_LIMIT;
    if too_high(limits.daily_limit) || limits.per_project_daily_limit.is_some_and(too_high) {
        return Err(format!("Job limits are at most {MAX_DAILY_LIMIT} a day"));
    }
    Ok(())
}

/// Canonical keys; two spellings of one folder keep the first entry.
fn canonical_projects(
    projects: impl IntoIterator<Item = (String, ProjectConfig)>,
) -> BTreeMap<String, ProjectConfig> {
    let mut canonical = BTreeMap::new();
    for (path, config) in projects {
        canonical
            .entry(canonical_project_path(&path))
            .or_insert(config);
    }
    canonical
}

fn read_v2(file: PolicyFileV2) -> LinkPolicy {
    let projects = file.projects.into_iter().filter_map(|(path, raw)| {
        if !Path::new(&path).is_absolute() {
            return None;
        }
        let config: ProjectConfig = serde_json::from_value(raw).ok()?;
        check_project(&path, &config).ok()?;
        Some((path, config))
    });
    // A hand-edited counter above the maximum is clamped, never read as "no cap".
    let jobs = file
        .jobs
        .map_or_else(JobLimits::default, |limits| JobLimits {
            daily_limit: limits.daily_limit.min(MAX_DAILY_LIMIT),
            per_project_daily_limit: limits
                .per_project_daily_limit
                .map(|n| n.min(MAX_DAILY_LIMIT)),
        });
    LinkPolicy {
        projects: canonical_projects(projects),
        jobs,
    }
}

fn read_v1(file: PolicyFileV1) -> LinkPolicy {
    let projects = file
        .scenes
        .projects
        .into_iter()
        .filter(|path| Path::new(path).is_absolute())
        .map(|path| {
            let config = ProjectConfig {
                document_types: vec![v1_document_type()],
                job_kinds: Vec::new(),
            };
            (path, config)
        });
    LinkPolicy {
        projects: canonical_projects(projects),
        jobs: JobLimits::default(),
    }
}

/// The stored policy, or an empty one when the file is missing, broken or of
/// an unknown version. Version 1 is migrated in memory; the next save writes
/// version 2.
pub fn read_policy(app_data: &Path) -> LinkPolicy {
    let Ok(text) = std::fs::read_to_string(policy_path_in(app_data)) else {
        return LinkPolicy::default();
    };
    parse_policy(&text)
}

pub fn parse_policy(text: &str) -> LinkPolicy {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return LinkPolicy::default();
    };
    match value.get("version").and_then(serde_json::Value::as_u64) {
        Some(1) => serde_json::from_value::<PolicyFileV1>(value)
            .map(read_v1)
            .unwrap_or_default(),
        Some(2) => serde_json::from_value::<PolicyFileV2>(value)
            .map(read_v2)
            .unwrap_or_default(),
        _ => LinkPolicy::default(),
    }
}

/// Stores the policy and returns what was stored. Every path must be
/// absolute and every entry valid; the first that is not is named in the
/// error and nothing is written.
pub fn write_policy(app_data: &Path, policy: &LinkPolicy) -> Result<LinkPolicy, String> {
    for (path, config) in &policy.projects {
        if !Path::new(path.as_str()).is_absolute() {
            return Err(format!("Project paths must be absolute, got \"{path}\""));
        }
        check_project(path, config)?;
    }
    check_limits(&policy.jobs)?;
    let stored = LinkPolicy {
        projects: canonical_projects(policy.projects.clone()),
        jobs: policy.jobs,
    };
    let file = PolicyFileV2 {
        version: POLICY_VERSION,
        projects: stored
            .projects
            .iter()
            .map(|(path, config)| {
                let value = serde_json::to_value(config).map_err(|error| error.to_string())?;
                Ok((path.clone(), value))
            })
            .collect::<Result<_, String>>()?,
        jobs: Some(stored.jobs),
    };
    let payload = serde_json::to_vec_pretty(&file).map_err(|error| error.to_string())?;
    write_private_atomic(&policy_path_in(app_data), &payload)?;
    Ok(stored)
}

/// Temp file at 0600, then a rename, as `supervisor::write_policy_atomic`
/// does for its typed policy: a read mid-write sees the old file or the new
/// one. Writes are serialised and each has its own temp file, so two saves
/// cannot truncate each other.
pub(super) fn write_private_atomic(path: &Path, payload: &[u8]) -> Result<(), String> {
    static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    static WRITE_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let _writing = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let sequence = WRITE_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temporary = path.with_extension(format!("json.{}-{sequence}.tmp", std::process::id()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let written = file.write_all(payload).and_then(|_| file.sync_all());
    drop(file);
    if let Err(error) = written {
        let _ = std::fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    std::fs::rename(&temporary, path).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        error.to_string()
    })
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("No app data directory: {error}"))
}

#[tauri::command]
pub fn supervisor_link_policy_get(app: tauri::AppHandle) -> Result<LinkPolicy, String> {
    Ok(read_policy(&app_data_dir(&app)?))
}

#[tauri::command]
pub fn supervisor_link_policy_set(
    app: tauri::AppHandle,
    policy: LinkPolicy,
) -> Result<LinkPolicy, String> {
    write_policy(&app_data_dir(&app)?, &policy)
}

/// How many jobs the counter holds now, for the settings.
#[tauri::command]
pub fn supervisor_link_jobs_usage(app: tauri::AppHandle) -> Result<super::jobs::JobsUsage, String> {
    let dir = app_data_dir(&app)?;
    let limits = read_policy(&dir).jobs;
    Ok(super::jobs::usage_from_file(
        &dir,
        limits,
        super::jobs::now_ms(),
    ))
}

#[cfg(test)]
#[path = "policy_tests.rs"]
mod tests;
