//! Documents for the supervisor link (`docs/design-supervisor-link.md`,
//! "Documents"): find, read and propose JSON documents in the projects the
//! link policy makes visible. What a document is — where its files live, how
//! a listing names it — is the project's document type, not something this
//! module knows. The content is opaque JSON; only "an object, not too large"
//! is checked.
//!
//! Pure logic against the filesystem and git; the transport maps a
//! `DocumentError` onto its wire code. Two rules carry the weight:
//!
//! - **Nothing outside a visible project is ever read.** Ids are validated
//!   before they become paths, and every file is canonicalised and checked to
//!   still lie inside the project, so a symlink cannot lead out.
//! - **A proposal never touches what the human has checked out.** It is a
//!   blob, a tree and a commit written into the object store plus one new
//!   branch ref; `HEAD`, the index and the working tree stay as they were.

use git2::{ErrorCode, FileMode, ObjectType, Oid, Repository};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use super::glob;
use super::policy::{is_relative_file, DocumentType, LinkPolicy, Origin, ProjectConfig};
use crate::supervisor::canonical_project_path;

/// Fixture `maxDocumentBytes`.
pub const MAX_DOCUMENT_BYTES: usize = 262_144;
/// Fixture `search.maxLimit`.
pub const SEARCH_MAX_LIMIT: usize = 200;
/// Fixture `search.maxDepth`: folder levels below a glob's base that are walked.
pub const SEARCH_MAX_DEPTH: usize = 8;
/// Fixture `search.maxFilesPerProject`: documents read per project.
pub const SEARCH_MAX_FILES_PER_PROJECT: usize = 2000;
/// Fixture `revs.maxLength`.
pub const MAX_REV_LENGTH: usize = 255;
/// Fixture `maxIndexBytes`: an index names every document of a type, so it
/// may be larger than one document. A larger one is ignored like a broken one.
pub const MAX_INDEX_BYTES: usize = 4 * 1_048_576;
/// Fixture `proposalBranchPrefix`.
pub const PROPOSAL_BRANCH_PREFIX: &str = "auric/proposal/";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentErrorCode {
    InvalidParams,
    DocumentNotVisible,
    DocumentNotFound,
    DocumentInvalid,
    DocumentConflict,
    NotAGitRepo,
    Internal,
}

impl DocumentErrorCode {
    /// The wire code (fixture `errorCodes`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidParams => "invalid_params",
            Self::DocumentNotVisible => "document_not_visible",
            Self::DocumentNotFound => "document_not_found",
            Self::DocumentInvalid => "document_invalid",
            Self::DocumentConflict => "document_conflict",
            Self::NotAGitRepo => "not_a_git_repo",
            Self::Internal => "internal",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DocumentError {
    pub code: DocumentErrorCode,
    pub message: String,
}

impl DocumentError {
    pub(super) fn new(code: DocumentErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self::new(DocumentErrorCode::InvalidParams, message)
    }
}

impl std::fmt::Display for DocumentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for DocumentError {}

pub(super) fn internal(error: impl std::fmt::Display) -> DocumentError {
    DocumentError::new(DocumentErrorCode::Internal, error.to_string())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTypeInfo {
    pub name: String,
    pub globs: Vec<String>,
    pub schema: Option<String>,
    /// Globs `documents.asset` reads; empty when the type has no assets.
    pub assets: Vec<String>,
    pub max_asset_bytes: u64,
    /// `global` (inherited), `project` (its own) or `override` (its own in
    /// place of a global one).
    pub origin: Origin,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentProject {
    pub path: String,
    pub name: String,
    pub is_git_repo: bool,
    pub document_types: Vec<DocumentTypeInfo>,
    pub job_kinds: Vec<String>,
    /// Where each job kind came from, as `DocumentTypeInfo::origin`.
    pub job_kind_origins: BTreeMap<String, Origin>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentEntry {
    pub project: String,
    #[serde(rename = "type")]
    pub document_type: String,
    pub id: String,
    /// Absolute file path.
    pub path: String,
    pub name: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub hash: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub project: String,
    #[serde(rename = "type")]
    pub document_type: String,
    pub id: String,
    pub path: String,
    pub hash: String,
    /// The full commit id it was read at; `None` is the working tree.
    pub rev: Option<String>,
    /// Whether that commit is in the project's `HEAD` (it is `HEAD` or an
    /// ancestor of it). `false` is a preview of something not merged, such as
    /// a job's branch. `None` for the working tree.
    pub merged: Option<bool>,
    pub document: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub project: String,
    #[serde(rename = "type")]
    pub document_type: String,
    pub id: String,
    pub branch: String,
    pub commit: String,
    /// The `HEAD` commit the branch was built on.
    pub base: String,
    /// True when the document did not exist at `HEAD`.
    pub created: bool,
    pub hash: String,
}

// ---------------------------------------------------------------- ids ----

fn is_valid_segment(segment: &str) -> bool {
    let mut chars = segment.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphanumeric() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// A document id is its project-relative file path: segments that start
/// alphanumeric and hold only `[A-Za-z0-9._-]`, so `.`, `..` and hidden names
/// are out by construction.
pub fn is_valid_id(id: &str) -> bool {
    is_relative_file(id) && id.split('/').all(is_valid_segment)
}

/// A valid id that one of the type's globs matches.
pub fn validate_id(document_type: &DocumentType, id: &str) -> Result<(), DocumentError> {
    if !is_valid_id(id) {
        return Err(DocumentError::invalid(format!(
            "\"{id}\" is not a document id (a project-relative file path)"
        )));
    }
    if !belongs_to(document_type, id) {
        return Err(DocumentError::invalid(format!(
            "\"{id}\" is not a {} document ({})",
            document_type.name,
            document_type.globs.join(", ")
        )));
    }
    Ok(())
}

fn belongs_to(document_type: &DocumentType, id: &str) -> bool {
    document_type
        .globs
        .iter()
        .any(|pattern| glob::matches(pattern, id))
}

/// `segments` of a folder with `reference` applied; `None` when a `..`
/// climbs above the project root.
fn join_reference(mut segments: Vec<String>, reference: &str) -> Option<String> {
    for segment in reference.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            other => segments.push(other.to_string()),
        }
    }
    Some(segments.join("/"))
}

/// The ids a pointer inside document `from` may mean, most likely first:
/// relative to the folder of `from`, then (unless it starts with `./` or
/// `../`) relative to the project root; each as written and with the type's
/// file suffix added. Only valid ids of the type are kept.
// code-gate: complexity-cyclomatic - the fixture's candidate order (folder, root; as written, with suffix) in one place, so the order cannot drift
pub fn reference_candidates(
    document_type: &DocumentType,
    from: &str,
    reference: &str,
) -> Result<Vec<String>, DocumentError> {
    validate_id(document_type, from)?;
    let refused =
        |why: &str| DocumentError::invalid(format!("ref \"{reference}\" from \"{from}\" {why}"));
    if reference.trim().is_empty() {
        return Err(refused("is empty"));
    }
    if reference.starts_with('/') || reference.contains('\\') {
        return Err(refused("is not a relative path"));
    }
    let mut folder: Vec<String> = from.split('/').map(str::to_string).collect();
    folder.pop();
    let explicit = reference.starts_with("./") || reference.starts_with("../");
    let mut bases =
        vec![join_reference(folder, reference).ok_or_else(|| refused("leaves the project"))?];
    if !explicit {
        if let Some(rooted) = join_reference(Vec::new(), reference) {
            bases.push(rooted);
        }
    }
    let suffixes: Vec<&str> = document_type
        .globs
        .iter()
        .filter_map(|pattern| glob::suffix(pattern))
        .collect();
    let mut candidates = Vec::new();
    for base in bases {
        let spelled = std::iter::once(base.clone()).chain(
            suffixes
                .iter()
                .filter(|suffix| !base.ends_with(*suffix))
                .map(|suffix| format!("{base}{suffix}")),
        );
        for candidate in spelled {
            let fits = is_valid_id(&candidate) && belongs_to(document_type, &candidate);
            if fits && !candidates.contains(&candidate) {
                candidates.push(candidate);
            }
        }
    }
    if candidates.is_empty() {
        return Err(refused(&format!("is no {} document", document_type.name)));
    }
    Ok(candidates)
}

// ----------------------------------------------------------- projects ----

/// The canonical project folder and its configuration when `project` is
/// listed, else `document_not_visible`. A relative path is refused before it
/// can resolve against the app's cwd.
pub(super) fn visible_project<'p>(
    policy: &'p LinkPolicy,
    project: &str,
) -> Result<(PathBuf, &'p ProjectConfig), DocumentError> {
    if !Path::new(project).is_absolute() {
        return Err(DocumentError::invalid(format!(
            "project \"{project}\" is not an absolute path"
        )));
    }
    let Some((_, config)) = policy.project(project) else {
        return Err(DocumentError::new(
            DocumentErrorCode::DocumentNotVisible,
            format!("project \"{project}\" is not shared with the supervisor link"),
        ));
    };
    Ok((PathBuf::from(canonical_project_path(project)), config))
}

/// The project's document type `name`, or `invalid_params` naming the ones
/// it has.
pub(super) fn document_type<'c>(
    config: &'c ProjectConfig,
    name: &str,
) -> Result<&'c DocumentType, DocumentError> {
    config.document_type(name).ok_or_else(|| {
        let known: Vec<&str> = config
            .document_types
            .iter()
            .map(|t| t.name.as_str())
            .collect();
        DocumentError::invalid(format!(
            "no document type \"{name}\" in this project (has: {})",
            if known.is_empty() {
                "none".to_string()
            } else {
                known.join(", ")
            }
        ))
    })
}

pub(super) fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn canonical_dir(path: &Path) -> Option<PathBuf> {
    path.canonicalize().ok()
}

/// The repository whose work tree *is* `project`. A folder nested in some
/// other repository is not one: a branch there would be built on the outer
/// repository's `HEAD`.
pub(super) fn open_root_repo(project: &Path) -> Result<Repository, DocumentError> {
    let not_a_repo = || {
        DocumentError::new(
            DocumentErrorCode::NotAGitRepo,
            format!("{} is not the root of a git repository", project.display()),
        )
    };
    let repo = Repository::open(project).map_err(|_| not_a_repo())?;
    let workdir = repo
        .workdir()
        .and_then(canonical_dir)
        .ok_or_else(not_a_repo)?;
    if canonical_dir(project).as_deref() != Some(workdir.as_path()) {
        return Err(not_a_repo());
    }
    Ok(repo)
}

/// A policy built without origins (tests, an older caller) reads as the
/// project's own configuration.
fn origin_of(origins: &BTreeMap<String, Origin>, name: &str) -> Origin {
    origins.get(name).copied().unwrap_or(Origin::Project)
}

/// Listed projects whose folder exists, named after the folder.
pub fn visible_projects(policy: &LinkPolicy) -> Vec<DocumentProject> {
    policy
        .projects
        .iter()
        .map(|(listed, config)| {
            let origins = policy.origins.get(listed).cloned().unwrap_or_default();
            (
                PathBuf::from(canonical_project_path(listed)),
                config,
                origins,
            )
        })
        .filter(|(path, _, _)| path.is_dir())
        .map(|(path, config, origins)| DocumentProject {
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path_string(&path)),
            is_git_repo: open_root_repo(&path).is_ok(),
            path: path_string(&path),
            document_types: config
                .document_types
                .iter()
                .map(|t| DocumentTypeInfo {
                    name: t.name.clone(),
                    globs: t.globs.clone(),
                    schema: t.schema.clone(),
                    assets: t.assets.clone(),
                    max_asset_bytes: t.asset_cap(),
                    origin: origin_of(&origins.document_types, &t.name),
                })
                .collect(),
            job_kinds: config.job_kinds.iter().map(|k| k.kind.clone()).collect(),
            job_kind_origins: config
                .job_kinds
                .iter()
                .map(|k| (k.kind.clone(), origin_of(&origins.job_kinds, &k.kind)))
                .collect(),
        })
        .collect()
}

// ------------------------------------------------------------- reading ----

/// The bytes of `relative` under `project`, or `None` when it does not exist,
/// is no regular file, or resolves (through a symlink) outside the project.
/// Too large is `document_invalid`, checked before the read.
pub(super) fn read_contained(
    project: &Path,
    relative: &str,
) -> Result<Option<Vec<u8>>, DocumentError> {
    read_contained_up_to(project, relative, MAX_DOCUMENT_BYTES)
}

fn read_contained_up_to(
    project: &Path,
    relative: &str,
    max_bytes: usize,
) -> Result<Option<Vec<u8>>, DocumentError> {
    read_contained_where(project, relative, max_bytes, |_| true)
}

/// Like `read_contained`, and `None` too when `allowed` refuses the
/// project-relative path the file really resolves to.
pub(super) fn read_contained_where(
    project: &Path,
    relative: &str,
    max_bytes: usize,
    allowed: impl Fn(&str) -> bool,
) -> Result<Option<Vec<u8>>, DocumentError> {
    let Ok(real) = project.join(relative).canonicalize() else {
        return Ok(None);
    };
    let Some(real_relative) = real.strip_prefix(project).ok().and_then(Path::to_str) else {
        return Ok(None);
    };
    if !allowed(real_relative) {
        return Ok(None);
    }
    let Ok(metadata) = std::fs::metadata(&real) else {
        return Ok(None);
    };
    if !metadata.is_file() {
        return Ok(None);
    }
    if metadata.len() > max_bytes as u64 {
        return Err(too_large(relative, metadata.len(), max_bytes));
    }
    std::fs::read(&real).map(Some).map_err(internal)
}

fn too_large(what: &str, bytes: u64, max_bytes: usize) -> DocumentError {
    DocumentError::new(
        DocumentErrorCode::DocumentInvalid,
        format!("{what} is {bytes} bytes, more than {max_bytes}"),
    )
}

/// Size, JSON and object-ness, in that order.
pub(super) fn parse_document(what: &str, bytes: &[u8]) -> Result<Value, DocumentError> {
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(too_large(what, bytes.len() as u64, MAX_DOCUMENT_BYTES));
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|error| {
        DocumentError::new(
            DocumentErrorCode::DocumentInvalid,
            format!("{what} is not JSON: {error}"),
        )
    })?;
    if !value.is_object() {
        return Err(DocumentError::new(
            DocumentErrorCode::DocumentInvalid,
            format!("{what} is not a JSON object"),
        ));
    }
    Ok(value)
}

/// `git hash-object` of the bytes, so a client can compare with git itself.
pub(super) fn blob_hash(bytes: &[u8]) -> Result<String, DocumentError> {
    Oid::hash_object(ObjectType::Blob, bytes)
        .map(|oid| oid.to_string())
        .map_err(internal)
}

pub(super) fn not_found(id: &str, at: Option<&str>) -> DocumentError {
    let message = match at {
        Some(rev) => format!("no document {id} at {rev}"),
        None => format!("no document {id}"),
    };
    DocumentError::new(DocumentErrorCode::DocumentNotFound, message)
}

/// A document from the working tree (`rev` absent) or from a commit.
pub fn get(
    policy: &LinkPolicy,
    project: &str,
    type_name: &str,
    id: &str,
    rev: Option<&str>,
) -> Result<Document, DocumentError> {
    let (root, config) = visible_project(policy, project)?;
    let document_type = document_type(config, type_name)?;
    validate_id(document_type, id)?;
    let (bytes, commit, merged) = match rev {
        None => {
            let bytes = read_contained(&root, id)?.ok_or_else(|| not_found(id, None))?;
            (bytes, None, None)
        }
        Some(rev) => {
            let (bytes, commit, merged) = read_at_rev(&root, id, rev, MAX_DOCUMENT_BYTES)?;
            (bytes, Some(commit), Some(merged))
        }
    };
    let document = parse_document(id, &bytes)?;
    Ok(Document {
        project: path_string(&root),
        document_type: document_type.name.clone(),
        id: id.to_string(),
        path: path_string(&root.join(id)),
        hash: blob_hash(&bytes)?,
        rev: commit,
        merged,
        document,
    })
}

/// Whether `commit` is `HEAD` or one of its ancestors. A `HEAD` that cannot
/// be read counts as not merged.
fn in_head(repo: &Repository, commit: Oid) -> bool {
    let Ok(head) = repo.head().and_then(|head| head.peel_to_commit()) else {
        return false;
    };
    head.id() == commit || repo.graph_descendant_of(head.id(), commit).unwrap_or(false)
}

/// A `rev` is a commit id (full or abbreviated) or a branch or tag name, such
/// as a proposal's or a job's branch. Nothing else reaches git: no leading
/// `-` (read as an option by a git command line), no revision expressions
/// (`HEAD~2`, `@{1}`, `:/text`, `a..b`), nothing git would not take as a ref
/// name. Fixture `revs`.
pub fn validate_rev(rev: &str) -> Result<(), DocumentError> {
    let refused = |why: &str| DocumentError::invalid(format!("rev \"{rev}\" {why}"));
    if rev.is_empty() || rev.len() > MAX_REV_LENGTH {
        return Err(refused(&format!(
            "must be 1 to {MAX_REV_LENGTH} characters"
        )));
    }
    if rev.starts_with('-') {
        return Err(refused("must not start with \"-\""));
    }
    let plain = rev
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/'));
    if !plain || !git2::Reference::is_valid_name(&format!("refs/heads/{rev}")) {
        return Err(refused(
            "is not a commit id, branch or tag name (revision expressions are not read)",
        ));
    }
    Ok(())
}

/// The file's bytes at `rev`, the full commit id and whether `HEAD` holds
/// that commit. A project nested inside a repository is read at its path
/// within it. Only a regular blob counts: a symlink entry would hand back its
/// target path as the "document".
pub(super) fn read_at_rev(
    root: &Path,
    id: &str,
    rev: &str,
    max_bytes: usize,
) -> Result<(Vec<u8>, String, bool), DocumentError> {
    validate_rev(rev)?;
    let not_a_repo = || {
        DocumentError::new(
            DocumentErrorCode::NotAGitRepo,
            format!(
                "{} has no git repository to read {rev} from",
                root.display()
            ),
        )
    };
    let repo = Repository::discover(root).map_err(|_| not_a_repo())?;
    let workdir = repo
        .workdir()
        .and_then(canonical_dir)
        .ok_or_else(not_a_repo)?;
    let inside = root.strip_prefix(&workdir).map_err(|_| not_a_repo())?;
    let commit = repo
        .revparse_single(rev)
        .and_then(|object| object.peel_to_commit())
        .map_err(|_| not_found(id, Some(rev)))?;
    let tree = commit.tree().map_err(internal)?;
    let entry = tree
        .get_path(&inside.join(id))
        .map_err(|_| not_found(id, Some(rev)))?;
    let regular = [
        i32::from(FileMode::Blob),
        i32::from(FileMode::BlobExecutable),
    ];
    if !regular.contains(&entry.filemode()) {
        return Err(not_found(id, Some(rev)));
    }
    let blob = repo.find_blob(entry.id()).map_err(internal)?;
    if blob.size() > max_bytes {
        return Err(too_large(id, blob.size() as u64, max_bytes));
    }
    let merged = in_head(&repo, commit.id());
    Ok((blob.content().to_vec(), commit.id().to_string(), merged))
}

/// `documents.resolve`: the first candidate of a pointer that exists, read
/// like `get`. None exists: `document_not_found` for the most likely one.
pub fn resolve(
    policy: &LinkPolicy,
    project: &str,
    type_name: &str,
    from: &str,
    reference: &str,
    rev: Option<&str>,
) -> Result<Document, DocumentError> {
    let (_, config) = visible_project(policy, project)?;
    let candidates = reference_candidates(document_type(config, type_name)?, from, reference)?;
    let mut first_miss = None;
    for candidate in &candidates {
        match get(policy, project, type_name, candidate, rev) {
            Err(error) if error.code == DocumentErrorCode::DocumentNotFound => {
                first_miss.get_or_insert(error);
            }
            other => return other,
        }
    }
    Err(first_miss.unwrap_or_else(|| not_found(reference, rev)))
}

// -------------------------------------------------------------- search ----

#[derive(Default)]
struct IndexEntry {
    name: Option<String>,
    description: Option<String>,
    tags: Option<Vec<String>>,
}

fn string_at(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

/// The string at a dotted path (`meta.title`).
fn string_at_path(value: &Value, dotted: &str) -> Option<String> {
    dotted
        .split('.')
        .try_fold(value, |at, key| at.get(key))
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// The type's index file, read leniently: a broken index means no index, not
/// a broken search, and a malformed entry is skipped field by field.
fn read_index(root: &Path, document_type: &DocumentType) -> HashMap<String, IndexEntry> {
    let mut index = HashMap::new();
    let Some(spec) = &document_type.index else {
        return index;
    };
    let Ok(Some(bytes)) = read_contained_up_to(root, &spec.path, MAX_INDEX_BYTES) else {
        return index;
    };
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return index;
    };
    for entry in value
        .get(&spec.entries_key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(id) = string_at(entry, "id") else {
            continue;
        };
        let tags = entry.get("tags").and_then(Value::as_array).map(|tags| {
            tags.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        });
        index.insert(
            id,
            IndexEntry {
                name: string_at(entry, "name"),
                description: string_at(entry, "description"),
                tags,
            },
        );
    }
    index
}

/// The id without the type's file suffix: the short form an index may use
/// and the fallback name of a document.
fn short_id<'i>(document_type: &DocumentType, id: &'i str) -> &'i str {
    document_type
        .globs
        .iter()
        .filter(|pattern| glob::matches(pattern, id))
        .filter_map(|pattern| glob::suffix(pattern))
        .find_map(|suffix| id.strip_suffix(suffix))
        .unwrap_or(id)
}

/// Collects files below `dir` as project-relative paths, sorted per folder
/// so a capped walk caps the same files every time. Hidden entries are
/// skipped, and so is any symlink that resolves outside the project.
pub(super) fn walk(
    root: &Path,
    dir: &Path,
    depth: usize,
    keep: &dyn Fn(&str) -> bool,
    found: &mut Vec<String>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if found.len() >= SEARCH_MAX_FILES_PER_PROJECT {
            return;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let Ok(real) = path.canonicalize() else {
            continue;
        };
        if !real.starts_with(root) {
            continue;
        }
        if real.is_dir() {
            if depth < SEARCH_MAX_DEPTH {
                walk(root, &path, depth + 1, keep, found);
            }
            continue;
        }
        let Ok(relative) = path.strip_prefix(root).map(path_string) else {
            continue;
        };
        if is_valid_id(&relative) && keep(&relative) && !found.contains(&relative) {
            found.push(relative);
        }
    }
}

/// The ids of one type in a project: a walk from each glob's base folder.
pub(super) fn type_ids(root: &Path, document_type: &DocumentType) -> Vec<String> {
    let mut ids = Vec::new();
    let bases: BTreeSet<String> = document_type.globs.iter().map(|g| glob::base(g)).collect();
    for base in bases {
        let dir = if base.is_empty() {
            root.to_path_buf()
        } else {
            root.join(&base)
        };
        match dir.canonicalize() {
            Ok(real) if real.starts_with(root) && real.is_dir() => {}
            _ => continue,
        }
        walk(root, &dir, 0, &|id| belongs_to(document_type, id), &mut ids);
    }
    ids.sort();
    ids
}

/// One search hit, or `None` for a file that is no document (unreadable,
/// too large, not an object): search lists what can be opened, it does not
/// audit.
fn entry_for(
    root: &Path,
    document_type: &DocumentType,
    id: &str,
    index: &HashMap<String, IndexEntry>,
) -> Option<DocumentEntry> {
    let bytes = read_contained(root, id).ok()??;
    let document = parse_document(id, &bytes).ok()?;
    let short = short_id(document_type, id);
    let indexed = index.get(id).or_else(|| index.get(short));
    let field = |path: &Option<String>| path.as_deref().and_then(|p| string_at_path(&document, p));
    let stem = short.rsplit('/').next().unwrap_or(short).to_string();
    Some(DocumentEntry {
        project: path_string(root),
        document_type: document_type.name.clone(),
        id: id.to_string(),
        path: path_string(&root.join(id)),
        name: indexed
            .and_then(|entry| entry.name.clone())
            .or_else(|| field(&document_type.name_field))
            .unwrap_or(stem),
        description: indexed
            .and_then(|entry| entry.description.clone())
            .or_else(|| field(&document_type.description_field)),
        tags: indexed
            .and_then(|entry| entry.tags.clone())
            .unwrap_or_default(),
        hash: blob_hash(&bytes).ok()?,
    })
}

fn matches(entry: &DocumentEntry, words: &[String]) -> bool {
    let mut fields = vec![entry.id.to_lowercase(), entry.name.to_lowercase()];
    if let Some(description) = &entry.description {
        fields.push(description.to_lowercase());
    }
    fields.extend(entry.tags.iter().map(|tag| tag.to_lowercase()));
    words
        .iter()
        .all(|word| fields.iter().any(|field| field.contains(word.as_str())))
}

fn project_documents(
    root: &Path,
    config: &ProjectConfig,
    type_name: Option<&str>,
) -> Vec<DocumentEntry> {
    config
        .document_types
        .iter()
        .filter(|t| type_name.map_or(true, |name| t.name == name))
        .flat_map(|document_type| {
            let index = read_index(root, document_type);
            type_ids(root, document_type)
                .into_iter()
                .filter_map(move |id| entry_for(root, document_type, &id, &index))
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Every word of `query` (case-insensitive) in id, name, description or
/// tags; ordered by project, type, then id; at most `limit` (capped at the
/// fixture's maximum). A named project must be visible.
pub fn search(
    policy: &LinkPolicy,
    query: Option<&str>,
    project: Option<&str>,
    type_name: Option<&str>,
    limit: usize,
) -> Result<Vec<DocumentEntry>, DocumentError> {
    let roots: Vec<(PathBuf, &ProjectConfig)> = match project {
        Some(project) => vec![visible_project(policy, project)?],
        None => policy
            .projects
            .iter()
            .map(|(listed, config)| (PathBuf::from(canonical_project_path(listed)), config))
            .collect(),
    };
    let words: Vec<String> = query
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_lowercase)
        .collect();
    let mut hits: Vec<DocumentEntry> = roots
        .iter()
        .filter(|(root, _)| root.is_dir())
        .flat_map(|(root, config)| project_documents(root, config, type_name))
        .filter(|entry| matches(entry, &words))
        .collect();
    hits.sort_by(|a, b| {
        (a.project.as_str(), a.document_type.as_str(), a.id.as_str()).cmp(&(
            b.project.as_str(),
            b.document_type.as_str(),
            b.id.as_str(),
        ))
    });
    hits.dedup_by(|a, b| {
        a.project == b.project && a.id == b.id && a.document_type == b.document_type
    });
    hits.truncate(limit.min(SEARCH_MAX_LIMIT));
    Ok(hits)
}

// ------------------------------------------------------------- propose ----

fn conflict(id: &str, expected: Option<&str>, found: Option<&str>) -> DocumentError {
    let describe = |hash: Option<&str>| hash.map_or_else(|| "no file".to_string(), str::to_string);
    DocumentError::new(
        DocumentErrorCode::DocumentConflict,
        format!(
            "{id} at HEAD: expected {}, found {}",
            describe(expected),
            describe(found)
        ),
    )
}

/// `auric/proposal/<file stem>-<8 hex>`. A stem git would not take as a ref
/// name part (`a..b`, `x.lock`) has its dots replaced; the suffix keeps it
/// unique either way.
fn proposal_branch(document_type: &DocumentType, id: &str) -> String {
    let short = short_id(document_type, id);
    let stem = short.rsplit('/').next().unwrap_or(short);
    let suffix: String = uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect();
    let branch = format!("{PROPOSAL_BRANCH_PREFIX}{stem}-{suffix}");
    if git2::Reference::is_valid_name(&format!("refs/heads/{branch}")) {
        branch
    } else {
        format!(
            "{PROPOSAL_BRANCH_PREFIX}{}-{suffix}",
            stem.replace('.', "-")
        )
    }
}

/// Fails with `document_conflict` when a folder on the way to the document
/// is a file (or a symlink) at `HEAD`; the tree builder would replace it.
fn check_parents_are_trees(tree: &git2::Tree, relative: &str) -> Result<(), DocumentError> {
    let mut prefix = PathBuf::new();
    let parents: Vec<&str> = relative.split('/').collect();
    for segment in &parents[..parents.len().saturating_sub(1)] {
        prefix.push(segment);
        if let Ok(entry) = tree.get_path(&prefix) {
            if entry.kind() != Some(ObjectType::Tree) {
                return Err(DocumentError::new(
                    DocumentErrorCode::DocumentConflict,
                    format!("{} is not a folder at HEAD", prefix.display()),
                ));
            }
        }
    }
    Ok(())
}

fn commit_message(type_name: &str, id: &str, message: Option<&str>) -> String {
    match message.map(str::trim).filter(|body| !body.is_empty()) {
        Some(body) => format!("{type_name}: propose {id}\n\n{body}\n"),
        None => format!("{type_name}: propose {id}\n"),
    }
}

/// The file as it will be committed: pretty JSON plus a trailing newline,
/// refused when it is no object or too large.
fn proposed_bytes(document: &Value) -> Result<Vec<u8>, DocumentError> {
    if !document.is_object() {
        return Err(DocumentError::new(
            DocumentErrorCode::DocumentInvalid,
            "the proposed document is not a JSON object",
        ));
    }
    let mut text = serde_json::to_string_pretty(document).map_err(internal)?;
    text.push('\n');
    if text.len() > MAX_DOCUMENT_BYTES {
        return Err(too_large(
            "the proposed document",
            text.len() as u64,
            MAX_DOCUMENT_BYTES,
        ));
    }
    Ok(text.into_bytes())
}

/// The commit a branch is built on. A repository without one has nothing to
/// branch from, which the contract reports as `not_a_git_repo`.
pub(super) fn head_commit<'r>(
    repo: &'r Repository,
    root: &Path,
) -> Result<git2::Commit<'r>, DocumentError> {
    match repo.head() {
        Ok(head) => head.peel_to_commit().map_err(internal),
        Err(error) if error.code() == ErrorCode::UnbornBranch => Err(DocumentError::new(
            DocumentErrorCode::NotAGitRepo,
            format!("{} has no commit yet", root.display()),
        )),
        Err(error) => Err(internal(error)),
    }
}

/// The repository's configured git user; a fixed one only where none is
/// configured, so a commit never fails over a missing `user.name`.
pub(super) fn signature(repo: &Repository) -> Result<git2::Signature<'static>, DocumentError> {
    repo.signature()
        .or_else(|_| git2::Signature::now("AuricIDE", "auricide@localhost"))
        .map_err(internal)
}

pub struct ProposeRequest<'a> {
    pub project: &'a str,
    pub type_name: &'a str,
    pub id: &'a str,
    pub document: &'a Value,
    /// `None`: the document must not exist yet.
    pub base_hash: Option<&'a str>,
    pub message: Option<&'a str>,
}

/// `documents.propose`: the new content as a commit on a new branch built
/// from `HEAD`, if `HEAD` still holds the version the change is based on.
pub fn propose(
    policy: &LinkPolicy,
    request: &ProposeRequest<'_>,
) -> Result<Proposal, DocumentError> {
    let (root, config) = visible_project(policy, request.project)?;
    let document_type = document_type(config, request.type_name)?;
    let id = request.id;
    validate_id(document_type, id)?;
    let bytes = proposed_bytes(request.document)?;

    let repo = open_root_repo(&root)?;
    let base = head_commit(&repo, &root)?;
    let base_tree = base.tree().map_err(internal)?;

    let existing = base_tree
        .get_path(Path::new(id))
        .ok()
        .map(|entry| entry.id().to_string());
    let expected = request.base_hash.map(str::to_ascii_lowercase);
    if existing != expected {
        return Err(conflict(id, request.base_hash, existing.as_deref()));
    }
    check_parents_are_trees(&base_tree, id)?;

    let blob = repo.blob(&bytes).map_err(internal)?;
    let tree_id = git2::build::TreeUpdateBuilder::new()
        .upsert(id, blob, FileMode::Blob)
        .create_updated(&repo, &base_tree)
        .map_err(internal)?;
    let tree = repo.find_tree(tree_id).map_err(internal)?;
    let branch = proposal_branch(document_type, id);
    let author = signature(&repo)?;
    let commit = repo
        .commit(
            Some(&format!("refs/heads/{branch}")),
            &author,
            &author,
            &commit_message(&document_type.name, id, request.message),
            &tree,
            &[&base],
        )
        .map_err(internal)?;

    Ok(Proposal {
        project: path_string(&root),
        document_type: document_type.name.clone(),
        id: id.to_string(),
        branch,
        commit: commit.to_string(),
        base: base.id().to_string(),
        created: existing.is_none(),
        hash: blob.to_string(),
    })
}

#[cfg(test)]
#[path = "documents_tests.rs"]
mod tests;
