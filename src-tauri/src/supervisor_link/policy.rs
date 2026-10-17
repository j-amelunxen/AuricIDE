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
//! configuration: document types (where the files are, how to name them) and
//! job kinds (which instructions an agent follows, which files it may write).
//! Since version 3 they are defined once as global `defaults` that every
//! listed project inherits; a project entry only says how it differs — a type
//! or kind of the same name replaces the global one, a new name extends them,
//! `disabled…` drops single ones and `inherit: false` drops all of them.
//!
//! Two shapes live here: [`StoredPolicy`] is the file (what the settings
//! edit), [`LinkPolicy`] is what the link acts on — every project with its
//! merged, effective configuration and where each piece came from.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

use super::glob;
use crate::supervisor::canonical_project_path;

/// Fixture `policyFileName`.
pub const POLICY_FILE_NAME: &str = "supervisor-link.json";

/// The on-disk version this build writes. Versions 1 and 2 are migrated on
/// read; the next save writes this one.
pub(super) const POLICY_VERSION: u32 = 3;

/// Fixture `jobs.defaultDailyLimit` / `jobs.maxDailyLimit`.
pub const DEFAULT_DAILY_LIMIT: u32 = 20;
pub const MAX_DAILY_LIMIT: u32 = 1000;

/// Fixture `assets.defaultMaxAssetBytes` / `assets.maxAssetBytes`.
pub const DEFAULT_MAX_ASSET_BYTES: u64 = 2 * 1_048_576;
pub const MAX_ASSET_BYTES: u64 = 16 * 1_048_576;

/// Fixture `globalInstructions.dirName`: where a `globalInstructions` that is
/// a bare file name lives, under the app data directory.
pub const JOB_KINDS_DIR: &str = "job-kinds";

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
    /// Project-relative globs of files the documents refer to (models,
    /// images, textures). `documents.asset` reads them; nothing writes them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assets: Vec<String>,
    /// The largest asset handed out, in bytes. Absent: `DEFAULT_MAX_ASSET_BYTES`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_asset_bytes: Option<u64>,
}

impl DocumentType {
    /// The size cap of this type's assets.
    pub fn asset_cap(&self) -> u64 {
        self.max_asset_bytes.unwrap_or(DEFAULT_MAX_ASSET_BYTES)
    }
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

/// A job a client may ask for. The IDE does not know what a kind means: the
/// agent follows the kind's instructions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobKind {
    /// `^[a-z0-9][a-z0-9._-]*$`, unique within the project.
    pub kind: String,
    /// Project-relative path of the file that tells the agent how to do it.
    /// When the project has this file it wins over `global_instructions`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    /// Instructions kept outside every project: an absolute path, or a
    /// relative one under `<app_data_dir>/job-kinds/`. The IDE reads the file
    /// and puts its text into the job's prompt; no `documents.*` method ever
    /// serves it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub global_instructions: Option<String>,
    /// Globs the agent may write. Empty: the globs of every document type.
    #[serde(default)]
    pub writes: Vec<String>,
}

/// One project's effective configuration: global defaults and its own entry
/// merged.
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

/// Where an effective document type or job kind came from (fixture
/// `resolution.origins`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    /// Inherited unchanged from the global defaults.
    Global,
    /// Defined by the project only.
    Project,
    /// The project's own definition replaces a global one of the same name.
    Override,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOrigins {
    pub document_types: BTreeMap<String, Origin>,
    pub job_kinds: BTreeMap<String, Origin>,
}

/// The policy as the rest of the link sees it: canonical project paths, each
/// with its effective configuration, and the job counter.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPolicy {
    pub projects: BTreeMap<String, ProjectConfig>,
    #[serde(default)]
    pub jobs: JobLimits,
    /// Projects whose own daily limit replaces `jobs.perProjectDailyLimit`.
    #[serde(default)]
    pub project_daily_limits: BTreeMap<String, u32>,
    /// Per project, where each document type and job kind came from.
    #[serde(default)]
    pub origins: BTreeMap<String, ProjectOrigins>,
    /// `<app_data_dir>/job-kinds`, where bare `globalInstructions` names
    /// resolve. `None` when the policy was not read from an app directory.
    #[serde(skip)]
    pub job_kinds_dir: Option<PathBuf>,
}

impl LinkPolicy {
    /// The configuration of `project`, both sides compared canonically.
    pub fn project(&self, project: &str) -> Option<(&String, &ProjectConfig)> {
        let wanted = canonical_project_path(project);
        self.projects
            .iter()
            .find(|(listed, _)| canonical_project_path(listed) == wanted)
    }

    /// The counter limits that hold for `project`: the global ones, with the
    /// project's own daily limit in place of the shared per-project one.
    pub fn limits_for(&self, project: &str) -> JobLimits {
        let wanted = canonical_project_path(project);
        let own = self
            .project_daily_limits
            .iter()
            .find(|(listed, _)| canonical_project_path(listed) == wanted)
            .map(|(_, limit)| *limit);
        JobLimits {
            daily_limit: self.jobs.daily_limit,
            per_project_daily_limit: own.or(self.jobs.per_project_daily_limit),
        }
    }

    #[cfg(test)]
    /// Where `project`'s document types and job kinds came from.
    pub fn origins_of(&self, project: &str) -> Option<&ProjectOrigins> {
        let (listed, _) = self.project(project)?;
        self.origins.get(listed)
    }
}

// ------------------------------------------------------------ the file ----

/// Document types and job kinds every listed project inherits.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LinkDefaults {
    #[serde(default)]
    pub document_types: Vec<DocumentType>,
    #[serde(default)]
    pub job_kinds: Vec<JobKind>,
}

fn yes() -> bool {
    true
}

fn is_true(value: &bool) -> bool {
    *value
}

/// A listed project as the file stores it: how it differs from the defaults.
/// Listed means visible; an empty entry inherits everything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectEntry {
    /// `false`: none of the global defaults apply here.
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub inherit: bool,
    /// Global document types this project does not take over.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_document_types: Vec<String>,
    /// Global job kinds this project does not take over.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_job_kinds: Vec<String>,
    /// Own types; a name the defaults have replaces that one.
    #[serde(default)]
    pub document_types: Vec<DocumentType>,
    /// Own kinds; a name the defaults have replaces that one.
    #[serde(default)]
    pub job_kinds: Vec<JobKind>,
    /// Replaces `jobs.perProjectDailyLimit` for this project.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daily_limit: Option<u32>,
}

impl Default for ProjectEntry {
    fn default() -> Self {
        Self {
            inherit: true,
            disabled_document_types: Vec::new(),
            disabled_job_kinds: Vec::new(),
            document_types: Vec::new(),
            job_kinds: Vec::new(),
            daily_limit: None,
        }
    }
}

/// The file's content: global defaults, listed projects, the job counter.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredPolicy {
    #[serde(default)]
    pub defaults: LinkDefaults,
    #[serde(default)]
    pub projects: BTreeMap<String, ProjectEntry>,
    #[serde(default)]
    pub jobs: JobLimits,
}

impl StoredPolicy {
    #[cfg(test)]
    /// The entry of `project`, both sides compared canonically.
    pub fn entry(&self, project: &str) -> Option<(&String, &ProjectEntry)> {
        let wanted = canonical_project_path(project);
        self.projects
            .iter()
            .find(|(listed, _)| canonical_project_path(listed) == wanted)
    }
}

/// Versions 2 and 3: `{ "version", "defaults"?, "projects": { path: entry }, "jobs" }`.
/// Version 2 had no defaults; its project entries read as entries that
/// inherit nothing because there is nothing to inherit.
#[derive(Debug, Serialize, Deserialize)]
struct PolicyFile {
    version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    defaults: Option<serde_json::Value>,
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

/// The document type a version-1 project had without naming it. Version 1
/// was written by an early build that knew exactly one document format; these
/// values are that format, kept only so such a file keeps working. Nothing
/// else in the link knows a document format, and later versions never use them.
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
        assets: Vec::new(),
        max_asset_bytes: None,
    }
}

pub fn policy_path_in(app_data: &Path) -> PathBuf {
    app_data.join(POLICY_FILE_NAME)
}

pub fn job_kinds_dir_in(app_data: &Path) -> PathBuf {
    app_data.join(JOB_KINDS_DIR)
}

// ---------------------------------------------------------- validation ----

pub(super) fn is_valid_name(name: &str) -> bool {
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

/// An absolute path without `.`/`..` segments: what a person may name as a
/// global instructions file outside `job-kinds/`.
pub(super) fn is_clean_absolute(path: &str) -> bool {
    path.starts_with('/') && is_relative_file(&path[1..])
}

fn check_glob(owner: &str, pattern: &str) -> Result<(), String> {
    if !is_relative_file(pattern) || !glob::is_valid(pattern) {
        return Err(format!(
            "{owner}: \"{pattern}\" is not a project-relative glob"
        ));
    }
    Ok(())
}

// code-gate: complexity-cyclomatic - one branch per field rule, each named in its own error
fn check_document_type(owner: &str, document_type: &DocumentType) -> Result<(), String> {
    if document_type.globs.is_empty() {
        return Err(format!("{owner} has no globs"));
    }
    for pattern in document_type.globs.iter().chain(&document_type.assets) {
        check_glob(owner, pattern)?;
    }
    if document_type
        .max_asset_bytes
        .is_some_and(|cap| cap == 0 || cap > MAX_ASSET_BYTES)
    {
        return Err(format!(
            "{owner}: maxAssetBytes is 1 to {MAX_ASSET_BYTES} bytes"
        ));
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
    Ok(())
}

fn check_job_kind(owner: &str, kind: &JobKind) -> Result<(), String> {
    if kind.instructions.is_none() && kind.global_instructions.is_none() {
        return Err(format!(
            "{owner} needs instructions (project-relative) or globalInstructions"
        ));
    }
    if kind
        .instructions
        .as_deref()
        .is_some_and(|file| !is_relative_file(file))
    {
        return Err(format!(
            "{owner}: instructions must be a project-relative file"
        ));
    }
    if let Some(global) = kind.global_instructions.as_deref() {
        if !is_relative_file(global) && !is_clean_absolute(global) {
            return Err(format!(
                "{owner}: globalInstructions is an absolute path or a file under {JOB_KINDS_DIR}/"
            ));
        }
    }
    for pattern in &kind.writes {
        check_glob(owner, pattern)?;
    }
    Ok(())
}

/// The rules every list of types and kinds meets, global or a project's own:
/// valid unique names, valid fields.
fn check_entries(
    scope: &str,
    document_types: &[DocumentType],
    job_kinds: &[JobKind],
) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    for document_type in document_types {
        let owner = format!("{scope}: document type \"{}\"", document_type.name);
        if !is_valid_name(&document_type.name) || !seen.insert(&document_type.name) {
            return Err(format!("{owner} needs a unique lowercase name"));
        }
        check_document_type(&owner, document_type)?;
    }
    let mut kinds = BTreeSet::new();
    for kind in job_kinds {
        let owner = format!("{scope}: job kind \"{}\"", kind.kind);
        if !is_valid_name(&kind.kind) || !kinds.insert(&kind.kind) {
            return Err(format!("{owner} needs a unique lowercase name"));
        }
        check_job_kind(&owner, kind)?;
    }
    Ok(())
}

/// A project's effective configuration: every kind may write something.
fn check_effective(path: &str, config: &ProjectConfig) -> Result<(), String> {
    for kind in &config.job_kinds {
        if config.writes_of(kind).is_empty() {
            return Err(format!(
                "{path}: job kind \"{}\" may write nothing: name its writes or add a document type",
                kind.kind
            ));
        }
    }
    Ok(())
}

fn check_entry(path: &str, entry: &ProjectEntry) -> Result<(), String> {
    check_entries(path, &entry.document_types, &entry.job_kinds)?;
    for name in entry
        .disabled_document_types
        .iter()
        .chain(&entry.disabled_job_kinds)
    {
        if !is_valid_name(name) {
            return Err(format!("{path}: \"{name}\" is not a type or kind name"));
        }
    }
    if entry.daily_limit.is_some_and(|n| n > MAX_DAILY_LIMIT) {
        return Err(format!(
            "{path}: job limits are at most {MAX_DAILY_LIMIT} a day"
        ));
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

// ---------------------------------------------------------- resolution ----

/// Replaces items of `base` by name with `own`, appends the new ones, and
/// says where each one came from.
fn merge<T: Clone>(
    base: Vec<T>,
    own: &[T],
    name: impl Fn(&T) -> &str,
) -> (Vec<T>, BTreeMap<String, Origin>) {
    let mut origins: BTreeMap<String, Origin> = base
        .iter()
        .map(|item| (name(item).to_string(), Origin::Global))
        .collect();
    let mut merged = base;
    for item in own {
        let key = name(item).to_string();
        match merged.iter().position(|existing| name(existing) == key) {
            Some(at) => {
                merged[at] = item.clone();
                origins.insert(key, Origin::Override);
            }
            None => {
                merged.push(item.clone());
                origins.insert(key, Origin::Project);
            }
        }
    }
    (merged, origins)
}

/// One project's effective configuration (fixture `resolution`).
pub fn effective_project(
    defaults: &LinkDefaults,
    entry: &ProjectEntry,
) -> (ProjectConfig, ProjectOrigins) {
    let inherited_types: Vec<DocumentType> = if entry.inherit {
        defaults
            .document_types
            .iter()
            .filter(|t| !entry.disabled_document_types.contains(&t.name))
            .cloned()
            .collect()
    } else {
        Vec::new()
    };
    let inherited_kinds: Vec<JobKind> = if entry.inherit {
        defaults
            .job_kinds
            .iter()
            .filter(|k| !entry.disabled_job_kinds.contains(&k.kind))
            .cloned()
            .collect()
    } else {
        Vec::new()
    };
    let (document_types, type_origins) =
        merge(inherited_types, &entry.document_types, |t| t.name.as_str());
    let (job_kinds, kind_origins) = merge(inherited_kinds, &entry.job_kinds, |k| k.kind.as_str());
    (
        ProjectConfig {
            document_types,
            job_kinds,
        },
        ProjectOrigins {
            document_types: type_origins,
            job_kinds: kind_origins,
        },
    )
}

/// What the link acts on. A project whose merged configuration breaks a rule
/// (a kind left with nothing to write) is not visible.
pub fn resolve(stored: &StoredPolicy, job_kinds_dir: Option<&Path>) -> LinkPolicy {
    let mut policy = LinkPolicy {
        jobs: stored.jobs,
        job_kinds_dir: job_kinds_dir.map(Path::to_path_buf),
        ..LinkPolicy::default()
    };
    for (path, entry) in &stored.projects {
        let (config, origins) = effective_project(&stored.defaults, entry);
        if check_effective(path, &config).is_err() {
            continue;
        }
        if let Some(limit) = entry.daily_limit {
            policy.project_daily_limits.insert(path.clone(), limit);
        }
        policy.origins.insert(path.clone(), origins);
        policy.projects.insert(path.clone(), config);
    }
    policy
}

// --------------------------------------------------------- read & write ----

/// Canonical keys; two spellings of one folder keep the first entry.
fn canonical_projects<T>(projects: impl IntoIterator<Item = (String, T)>) -> BTreeMap<String, T> {
    let mut canonical = BTreeMap::new();
    for (path, config) in projects {
        canonical
            .entry(canonical_project_path(&path))
            .or_insert(config);
    }
    canonical
}

/// A hand-edited counter above the maximum is clamped, never read as "no cap".
fn clamp_limits(limits: JobLimits) -> JobLimits {
    JobLimits {
        daily_limit: limits.daily_limit.min(MAX_DAILY_LIMIT),
        per_project_daily_limit: limits
            .per_project_daily_limit
            .map(|n| n.min(MAX_DAILY_LIMIT)),
    }
}

/// Defaults that do not validate are dropped as a whole: a project then
/// inherits nothing, which shows less, never more.
fn read_defaults(raw: Option<serde_json::Value>) -> LinkDefaults {
    raw.and_then(|raw| serde_json::from_value::<LinkDefaults>(raw).ok())
        .filter(|defaults| {
            check_entries("defaults", &defaults.document_types, &defaults.job_kinds).is_ok()
        })
        .unwrap_or_default()
}

fn read_v2_or_v3(file: PolicyFile) -> StoredPolicy {
    let projects = file.projects.into_iter().filter_map(|(path, raw)| {
        if !Path::new(&path).is_absolute() {
            return None;
        }
        let mut entry: ProjectEntry = serde_json::from_value(raw).ok()?;
        check_entry(&path, &entry).ok()?;
        entry.daily_limit = entry.daily_limit.map(|n| n.min(MAX_DAILY_LIMIT));
        Some((path, entry))
    });
    StoredPolicy {
        defaults: read_defaults(file.defaults),
        projects: canonical_projects(projects),
        jobs: file.jobs.map_or_else(JobLimits::default, clamp_limits),
    }
}

fn read_v1(file: PolicyFileV1) -> StoredPolicy {
    let projects = file
        .scenes
        .projects
        .into_iter()
        .filter(|path| Path::new(path).is_absolute())
        .map(|path| {
            let entry = ProjectEntry {
                document_types: vec![v1_document_type()],
                ..ProjectEntry::default()
            };
            (path, entry)
        });
    StoredPolicy {
        defaults: LinkDefaults::default(),
        projects: canonical_projects(projects),
        jobs: JobLimits::default(),
    }
}

/// The file's content, or an empty policy when it is missing, broken or of
/// an unknown version. Older versions are migrated in memory; the next save
/// writes the current one.
pub fn read_stored(app_data: &Path) -> StoredPolicy {
    let Ok(text) = std::fs::read_to_string(policy_path_in(app_data)) else {
        return StoredPolicy::default();
    };
    parse_stored(&text)
}

pub fn parse_stored(text: &str) -> StoredPolicy {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return StoredPolicy::default();
    };
    match value.get("version").and_then(serde_json::Value::as_u64) {
        Some(1) => serde_json::from_value::<PolicyFileV1>(value)
            .map(read_v1)
            .unwrap_or_default(),
        // Version 2 has no `defaults`; one that names it is not version 2.
        Some(2) if value.get("defaults").is_some() => StoredPolicy::default(),
        Some(2 | 3) => serde_json::from_value::<PolicyFile>(value)
            .map(read_v2_or_v3)
            .unwrap_or_default(),
        _ => StoredPolicy::default(),
    }
}

/// The effective policy the link acts on, read from the app directory.
pub fn read_policy(app_data: &Path) -> LinkPolicy {
    resolve(&read_stored(app_data), Some(&job_kinds_dir_in(app_data)))
}

#[cfg(test)]
/// The effective policy of a file's text, without an app directory.
pub fn parse_policy(text: &str) -> LinkPolicy {
    resolve(&parse_stored(text), None)
}

/// Every rule a stored policy must meet, and the policy with canonical
/// paths. The first entry that breaks a rule is named in the error.
pub fn check_stored(policy: &StoredPolicy) -> Result<StoredPolicy, String> {
    check_entries(
        "defaults",
        &policy.defaults.document_types,
        &policy.defaults.job_kinds,
    )?;
    for (path, entry) in &policy.projects {
        if !Path::new(path.as_str()).is_absolute() {
            return Err(format!("Project paths must be absolute, got \"{path}\""));
        }
        check_entry(path, entry)?;
        let (config, _) = effective_project(&policy.defaults, entry);
        check_effective(path, &config)?;
    }
    check_limits(&policy.jobs)?;
    Ok(StoredPolicy {
        defaults: policy.defaults.clone(),
        projects: canonical_projects(policy.projects.clone()),
        jobs: policy.jobs,
    })
}

/// Stores the policy and returns what was stored. Nothing is written when
/// any rule is broken.
pub fn write_stored(app_data: &Path, policy: &StoredPolicy) -> Result<StoredPolicy, String> {
    let stored = check_stored(policy)?;
    write_private_atomic(&policy_path_in(app_data), &stored_payload(&stored)?)?;
    Ok(stored)
}

fn json_value(value: &impl Serialize) -> Result<serde_json::Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

/// The bytes `write_stored` puts on disk for a checked policy.
pub(super) fn stored_payload(stored: &StoredPolicy) -> Result<Vec<u8>, String> {
    let file = PolicyFile {
        version: POLICY_VERSION,
        defaults: Some(json_value(&stored.defaults)?),
        projects: stored
            .projects
            .iter()
            .map(|(path, entry)| Ok((path.clone(), json_value(entry)?)))
            .collect::<Result<_, String>>()?,
        jobs: Some(stored.jobs),
    };
    serde_json::to_vec_pretty(&file).map_err(|error| error.to_string())
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

pub(super) fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("No app data directory: {error}"))
}

/// The file as the settings edit it.
#[tauri::command]
pub fn supervisor_link_policy_get(app: tauri::AppHandle) -> Result<StoredPolicy, String> {
    Ok(read_stored(&app_data_dir(&app)?))
}

#[tauri::command]
pub fn supervisor_link_policy_set(
    app: tauri::AppHandle,
    policy: StoredPolicy,
) -> Result<StoredPolicy, String> {
    write_stored(&app_data_dir(&app)?, &policy)
}

/// What the link acts on: every visible project's merged configuration and
/// where each part came from.
#[tauri::command]
pub fn supervisor_link_policy_effective(app: tauri::AppHandle) -> Result<LinkPolicy, String> {
    Ok(read_policy(&app_data_dir(&app)?))
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
