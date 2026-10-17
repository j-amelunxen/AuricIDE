//! Scenes for the supervisor link (`docs/design-supervisor-link.md`,
//! "Scenes"): find, read and propose `docs/**/*.scene.json` in the projects
//! the link policy makes visible.
//!
//! Pure logic against the filesystem and git; the transport maps a
//! `SceneError` onto its wire code. Two rules carry the weight:
//!
//! - **Nothing outside a visible project is ever read.** Ids are validated
//!   before they become paths, and every file is canonicalised and checked to
//!   still lie inside the project, so a symlink in `docs/` cannot lead out.
//! - **A proposal never touches what the human has checked out.** It is a
//!   blob, a tree and a commit written into the object store plus one new
//!   branch ref; `HEAD`, the index and the working tree stay as they were.

use git2::{ErrorCode, FileMode, ObjectType, Oid, Repository};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

use super::policy::{allows, LinkPolicy};
use crate::supervisor::canonical_project_path;

/// Fixture `maxSceneBytes`.
pub const MAX_SCENE_BYTES: usize = 262_144;
/// Fixture `search.maxLimit`.
pub const SEARCH_MAX_LIMIT: usize = 200;
/// Fixture `search.maxDepth`: folder levels below `docs/` that are walked.
pub const SEARCH_MAX_DEPTH: usize = 8;
/// Fixture `search.maxFilesPerProject`: scene files read per project.
pub const SEARCH_MAX_FILES_PER_PROJECT: usize = 2000;
/// Fixture `proposalBranchPrefix`.
pub const PROPOSAL_BRANCH_PREFIX: &str = "auric/scene-proposal/";

const SCENE_SUFFIX: &str = ".scene.json";
const DOCS: &str = "docs";
const INDEX_FILE: &str = "scenes.index.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SceneErrorCode {
    InvalidParams,
    SceneNotVisible,
    SceneNotFound,
    SceneInvalid,
    SceneConflict,
    NotAGitRepo,
    Internal,
}

impl SceneErrorCode {
    /// The wire code (fixture `errorCodes`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidParams => "invalid_params",
            Self::SceneNotVisible => "scene_not_visible",
            Self::SceneNotFound => "scene_not_found",
            Self::SceneInvalid => "scene_invalid",
            Self::SceneConflict => "scene_conflict",
            Self::NotAGitRepo => "not_a_git_repo",
            Self::Internal => "internal",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SceneError {
    pub code: SceneErrorCode,
    pub message: String,
}

impl SceneError {
    fn new(code: SceneErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for SceneError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for SceneError {}

fn internal(error: impl std::fmt::Display) -> SceneError {
    SceneError::new(SceneErrorCode::Internal, error.to_string())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneProject {
    pub path: String,
    pub name: String,
    pub is_git_repo: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneEntry {
    pub project: String,
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
pub struct Scene {
    pub project: String,
    pub id: String,
    pub path: String,
    pub hash: String,
    /// The full commit id it was read at; `None` is the working tree.
    pub rev: Option<String>,
    pub scene: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub project: String,
    pub id: String,
    pub branch: String,
    pub commit: String,
    /// The `HEAD` commit the branch was built on.
    pub base: String,
    /// True when the scene did not exist at `HEAD`.
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

/// `^docs(/[A-Za-z0-9][A-Za-z0-9._-]*)+$`, and not ending in `.scene.json`
/// (the id is the path *without* it). A segment must start alphanumeric, so
/// `.`, `..` and hidden names are out by construction.
pub fn validate_scene_id(id: &str) -> Result<(), SceneError> {
    let mut segments = id.split('/');
    let rooted = segments.next() == Some(DOCS);
    let rest: Vec<&str> = segments.collect();
    let valid = rooted
        && !rest.is_empty()
        && rest.iter().all(|segment| is_valid_segment(segment))
        && !id.ends_with(SCENE_SUFFIX);
    if valid {
        Ok(())
    } else {
        Err(SceneError::new(
            SceneErrorCode::InvalidParams,
            format!("\"{id}\" is not a scene id (docs/<segment>/…, without .scene.json)"),
        ))
    }
}

/// A pointer inside scene `from` turned into an id (`scenes.resolve`): a
/// `docs/…` ref is an id, anything else is relative to the folder of `from`.
/// A ref that climbs out of `docs/` is refused, never clamped.
pub fn resolve_ref(from: &str, reference: &str) -> Result<String, SceneError> {
    validate_scene_id(from)?;
    let refused = |why: &str| {
        SceneError::new(
            SceneErrorCode::InvalidParams,
            format!("ref \"{reference}\" from \"{from}\" {why}"),
        )
    };
    let reference_id = reference.strip_suffix(SCENE_SUFFIX).unwrap_or(reference);
    if reference_id.is_empty() {
        return Err(refused("is empty"));
    }
    if reference_id.starts_with('/') {
        return Err(refused("is an absolute path"));
    }
    let resolved = if reference_id.starts_with("docs/") {
        reference_id.to_string()
    } else {
        let mut stack: Vec<&str> = from.split('/').collect();
        stack.pop();
        for segment in reference_id.split('/') {
            match segment {
                "." => {}
                ".." => {
                    stack.pop();
                    if stack.is_empty() {
                        return Err(refused("leaves docs/"));
                    }
                }
                other => stack.push(other),
            }
        }
        stack.join("/")
    };
    validate_scene_id(&resolved).map_err(|_| refused("is not a scene id"))?;
    Ok(resolved)
}

// ----------------------------------------------------------- projects ----

/// The canonical project folder when `project` is listed, else
/// `scene_not_visible`. A relative path is refused before it can resolve
/// against the app's cwd.
fn visible_project(policy: &LinkPolicy, project: &str) -> Result<PathBuf, SceneError> {
    if !Path::new(project).is_absolute() {
        return Err(SceneError::new(
            SceneErrorCode::InvalidParams,
            format!("project \"{project}\" is not an absolute path"),
        ));
    }
    if !allows(policy, project) {
        return Err(SceneError::new(
            SceneErrorCode::SceneNotVisible,
            format!("project \"{project}\" is not shared with the link"),
        ));
    }
    Ok(PathBuf::from(canonical_project_path(project)))
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn canonical_dir(path: &Path) -> Option<PathBuf> {
    path.canonicalize().ok()
}

/// The repository whose work tree *is* `project`. A folder nested in some
/// other repository is not one: a proposal there would be built on the outer
/// repository's `HEAD`.
fn open_root_repo(project: &Path) -> Result<Repository, SceneError> {
    let not_a_repo = || {
        SceneError::new(
            SceneErrorCode::NotAGitRepo,
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

/// Listed projects whose folder exists, named after the folder.
pub fn visible_projects(policy: &LinkPolicy) -> Vec<SceneProject> {
    policy
        .scene_projects
        .iter()
        .map(|listed| PathBuf::from(canonical_project_path(listed)))
        .filter(|path| path.is_dir())
        .map(|path| SceneProject {
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path_string(&path)),
            is_git_repo: open_root_repo(&path).is_ok(),
            path: path_string(&path),
        })
        .collect()
}

// ------------------------------------------------------------- reading ----

/// The bytes of `relative` under `project`, or `None` when it does not exist,
/// is no regular file, or resolves (through a symlink) outside the project.
/// Too large is `scene_invalid`, checked before the read.
fn read_contained(project: &Path, relative: &str) -> Result<Option<Vec<u8>>, SceneError> {
    let Ok(real) = project.join(relative).canonicalize() else {
        return Ok(None);
    };
    if !real.starts_with(project) {
        return Ok(None);
    }
    let Ok(metadata) = std::fs::metadata(&real) else {
        return Ok(None);
    };
    if !metadata.is_file() {
        return Ok(None);
    }
    if metadata.len() > MAX_SCENE_BYTES as u64 {
        return Err(too_large(relative, metadata.len()));
    }
    std::fs::read(&real).map(Some).map_err(internal)
}

fn too_large(what: &str, bytes: u64) -> SceneError {
    SceneError::new(
        SceneErrorCode::SceneInvalid,
        format!("{what} is {bytes} bytes, more than {MAX_SCENE_BYTES}"),
    )
}

/// Size, JSON and object-ness, in that order.
fn parse_scene(what: &str, bytes: &[u8]) -> Result<Value, SceneError> {
    if bytes.len() > MAX_SCENE_BYTES {
        return Err(too_large(what, bytes.len() as u64));
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|error| {
        SceneError::new(
            SceneErrorCode::SceneInvalid,
            format!("{what} is not JSON: {error}"),
        )
    })?;
    if !value.is_object() {
        return Err(SceneError::new(
            SceneErrorCode::SceneInvalid,
            format!("{what} is not a JSON object"),
        ));
    }
    Ok(value)
}

/// `git hash-object` of the bytes, so a client can compare with git itself.
fn blob_hash(bytes: &[u8]) -> Result<String, SceneError> {
    Oid::hash_object(ObjectType::Blob, bytes)
        .map(|oid| oid.to_string())
        .map_err(internal)
}

fn file_relative(id: &str) -> String {
    format!("{id}{SCENE_SUFFIX}")
}

fn not_found(id: &str, at: Option<&str>) -> SceneError {
    let message = match at {
        Some(rev) => format!("no scene {id} at {rev}"),
        None => format!("no scene {id}"),
    };
    SceneError::new(SceneErrorCode::SceneNotFound, message)
}

/// A scene from the working tree (`rev` absent) or from a commit.
pub fn get(
    policy: &LinkPolicy,
    project: &str,
    id: &str,
    rev: Option<&str>,
) -> Result<Scene, SceneError> {
    validate_scene_id(id)?;
    let root = visible_project(policy, project)?;
    let relative = file_relative(id);
    let (bytes, commit) = match rev {
        None => {
            let bytes = read_contained(&root, &relative)?.ok_or_else(|| not_found(id, None))?;
            (bytes, None)
        }
        Some(rev) => {
            let (bytes, commit) = read_at_rev(&root, &relative, id, rev)?;
            (bytes, Some(commit))
        }
    };
    let scene = parse_scene(&relative, &bytes)?;
    Ok(Scene {
        project: path_string(&root),
        id: id.to_string(),
        path: path_string(&root.join(&relative)),
        hash: blob_hash(&bytes)?,
        rev: commit,
        scene,
    })
}

/// The file's bytes at `rev` and the full commit id. A project nested inside
/// a repository is read at its path within it. Only a regular blob counts: a
/// symlink entry would hand back its target path as the "scene".
fn read_at_rev(
    root: &Path,
    relative: &str,
    id: &str,
    rev: &str,
) -> Result<(Vec<u8>, String), SceneError> {
    let not_a_repo = || {
        SceneError::new(
            SceneErrorCode::NotAGitRepo,
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
        .get_path(&inside.join(relative))
        .map_err(|_| not_found(id, Some(rev)))?;
    let regular = [
        i32::from(FileMode::Blob),
        i32::from(FileMode::BlobExecutable),
    ];
    if !regular.contains(&entry.filemode()) {
        return Err(not_found(id, Some(rev)));
    }
    let blob = repo.find_blob(entry.id()).map_err(internal)?;
    if blob.size() > MAX_SCENE_BYTES {
        return Err(too_large(relative, blob.size() as u64));
    }
    Ok((blob.content().to_vec(), commit.id().to_string()))
}

/// `scenes.resolve`: a pointer from scene `from`, read like `get`.
pub fn resolve(
    policy: &LinkPolicy,
    project: &str,
    from: &str,
    reference: &str,
    rev: Option<&str>,
) -> Result<Scene, SceneError> {
    let id = resolve_ref(from, reference)?;
    get(policy, project, &id, rev)
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

/// `docs/scenes.index.json`, read leniently: a broken index means no index,
/// not a broken search, and a malformed entry is skipped field by field.
fn read_index(root: &Path) -> std::collections::HashMap<String, IndexEntry> {
    let mut index = std::collections::HashMap::new();
    let Ok(Some(bytes)) = read_contained(root, &format!("{DOCS}/{INDEX_FILE}")) else {
        return index;
    };
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return index;
    };
    for entry in value
        .get("scenes")
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

/// Collects `*.scene.json` below `dir` as ids, sorted per folder so a capped
/// walk caps the same files every time. Hidden entries are skipped, and so is
/// any symlink that resolves outside the project.
fn walk(root: &Path, dir: &Path, depth: usize, found: &mut Vec<String>) {
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
                walk(root, &path, depth + 1, found);
            }
            continue;
        }
        let Some(stem) = name.strip_suffix(SCENE_SUFFIX) else {
            continue;
        };
        let Ok(relative) = dir.join(stem).strip_prefix(root).map(path_string) else {
            continue;
        };
        if validate_scene_id(&relative).is_ok() {
            found.push(relative);
        }
    }
}

/// One search hit, or `None` for a file that is no scene (unreadable, too
/// large, not an object): search lists what can be opened, it does not audit.
fn entry_for(
    root: &Path,
    id: &str,
    index: &std::collections::HashMap<String, IndexEntry>,
) -> Option<SceneEntry> {
    let relative = file_relative(id);
    let bytes = read_contained(root, &relative).ok()??;
    let scene = parse_scene(&relative, &bytes).ok()?;
    let hud = scene.get("hud");
    let indexed = index.get(id);
    let stem = id.rsplit('/').next().unwrap_or(id).to_string();
    Some(SceneEntry {
        project: path_string(root),
        id: id.to_string(),
        path: path_string(&root.join(&relative)),
        name: indexed
            .and_then(|entry| entry.name.clone())
            .or_else(|| hud.and_then(|hud| string_at(hud, "title")))
            .unwrap_or(stem),
        description: indexed
            .and_then(|entry| entry.description.clone())
            .or_else(|| hud.and_then(|hud| string_at(hud, "subtitle"))),
        tags: indexed
            .and_then(|entry| entry.tags.clone())
            .unwrap_or_default(),
        hash: blob_hash(&bytes).ok()?,
    })
}

fn matches(entry: &SceneEntry, words: &[String]) -> bool {
    let mut fields = vec![entry.id.to_lowercase(), entry.name.to_lowercase()];
    if let Some(description) = &entry.description {
        fields.push(description.to_lowercase());
    }
    fields.extend(entry.tags.iter().map(|tag| tag.to_lowercase()));
    words
        .iter()
        .all(|word| fields.iter().any(|field| field.contains(word.as_str())))
}

fn project_scenes(root: &Path) -> Vec<SceneEntry> {
    let docs = root.join(DOCS);
    match docs.canonicalize() {
        Ok(real) if real.starts_with(root) && real.is_dir() => {}
        _ => return Vec::new(),
    }
    let mut ids = Vec::new();
    walk(root, &docs, 0, &mut ids);
    let index = read_index(root);
    ids.iter()
        .filter_map(|id| entry_for(root, id, &index))
        .collect()
}

/// Every word of `query` (case-insensitive) in id, name, description or
/// tags; ordered by project, then id; at most `limit` (capped at the
/// fixture's maximum). A named project must be visible.
pub fn search(
    policy: &LinkPolicy,
    query: Option<&str>,
    project: Option<&str>,
    limit: usize,
) -> Result<Vec<SceneEntry>, SceneError> {
    let roots: Vec<PathBuf> = match project {
        Some(project) => vec![visible_project(policy, project)?],
        None => policy
            .scene_projects
            .iter()
            .map(|listed| PathBuf::from(canonical_project_path(listed)))
            .collect(),
    };
    let words: Vec<String> = query
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_lowercase)
        .collect();
    let mut hits: Vec<SceneEntry> = roots
        .iter()
        .filter(|root| root.is_dir())
        .flat_map(|root| project_scenes(root))
        .filter(|entry| matches(entry, &words))
        .collect();
    hits.sort_by(|a, b| a.project.cmp(&b.project).then_with(|| a.id.cmp(&b.id)));
    hits.dedup_by(|a, b| a.project == b.project && a.id == b.id);
    hits.truncate(limit.min(SEARCH_MAX_LIMIT));
    Ok(hits)
}

// ------------------------------------------------------------- propose ----

fn conflict(id: &str, expected: Option<&str>, found: Option<&str>) -> SceneError {
    let describe = |hash: Option<&str>| match hash {
        Some(hash) => hash.to_string(),
        None => "no file".to_string(),
    };
    SceneError::new(
        SceneErrorCode::SceneConflict,
        format!(
            "{id} at HEAD: expected {}, found {}",
            describe(expected),
            describe(found)
        ),
    )
}

/// `auric/scene-proposal/<last id segment>-<8 hex>`. A segment git would not
/// take as a ref name part (`a..b`, `x.lock`) has its dots replaced; the
/// suffix keeps it unique either way.
fn proposal_branch(id: &str) -> String {
    let segment = id.rsplit('/').next().unwrap_or(id);
    let suffix: String = uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect();
    let branch = format!("{PROPOSAL_BRANCH_PREFIX}{segment}-{suffix}");
    if git2::Reference::is_valid_name(&format!("refs/heads/{branch}")) {
        branch
    } else {
        format!(
            "{PROPOSAL_BRANCH_PREFIX}{}-{suffix}",
            segment.replace('.', "-")
        )
    }
}

/// Fails with `scene_conflict` when a folder on the way to the scene is a
/// file (or a symlink) at `HEAD`; the tree builder would replace it.
fn check_parents_are_trees(tree: &git2::Tree, relative: &str) -> Result<(), SceneError> {
    let mut prefix = PathBuf::new();
    let parents: Vec<&str> = relative.split('/').collect();
    for segment in &parents[..parents.len().saturating_sub(1)] {
        prefix.push(segment);
        if let Ok(entry) = tree.get_path(&prefix) {
            if entry.kind() != Some(ObjectType::Tree) {
                return Err(SceneError::new(
                    SceneErrorCode::SceneConflict,
                    format!("{} is not a folder at HEAD", prefix.display()),
                ));
            }
        }
    }
    Ok(())
}

fn commit_message(id: &str, message: Option<&str>) -> String {
    match message.map(str::trim).filter(|body| !body.is_empty()) {
        Some(body) => format!("scene: propose {id}\n\n{body}\n"),
        None => format!("scene: propose {id}\n"),
    }
}

/// The file as it will be committed: pretty JSON plus a trailing newline,
/// refused when it is no object or too large.
fn proposed_bytes(scene: &Value) -> Result<Vec<u8>, SceneError> {
    if !scene.is_object() {
        return Err(SceneError::new(
            SceneErrorCode::SceneInvalid,
            "the proposed scene is not a JSON object",
        ));
    }
    let mut text = serde_json::to_string_pretty(scene).map_err(internal)?;
    text.push('\n');
    if text.len() > MAX_SCENE_BYTES {
        return Err(too_large("the proposed scene", text.len() as u64));
    }
    Ok(text.into_bytes())
}

/// The commit a proposal is built on. A repository without one has nothing
/// to branch from, which the contract reports as `not_a_git_repo`.
fn head_commit<'r>(repo: &'r Repository, root: &Path) -> Result<git2::Commit<'r>, SceneError> {
    match repo.head() {
        Ok(head) => head.peel_to_commit().map_err(internal),
        Err(error) if error.code() == ErrorCode::UnbornBranch => Err(SceneError::new(
            SceneErrorCode::NotAGitRepo,
            format!("{} has no commit yet", root.display()),
        )),
        Err(error) => Err(internal(error)),
    }
}

/// The repository's configured git user; a fixed one only where none is
/// configured, so a proposal never fails over a missing `user.name`.
fn proposal_signature(repo: &Repository) -> Result<git2::Signature<'static>, SceneError> {
    repo.signature()
        .or_else(|_| git2::Signature::now("AuricIDE", "auricide@localhost"))
        .map_err(internal)
}

/// `scenes.propose`: the new content as a commit on a new branch built from
/// `HEAD`, if `HEAD` still holds the version the change is based on
/// (`base_hash`, `None` = must not exist yet).
pub fn propose(
    policy: &LinkPolicy,
    project: &str,
    id: &str,
    scene: &Value,
    base_hash: Option<&str>,
    message: Option<&str>,
) -> Result<Proposal, SceneError> {
    validate_scene_id(id)?;
    let root = visible_project(policy, project)?;
    let relative = file_relative(id);
    let bytes = proposed_bytes(scene)?;

    let repo = open_root_repo(&root)?;
    let base = head_commit(&repo, &root)?;
    let base_tree = base.tree().map_err(internal)?;

    let existing = base_tree
        .get_path(Path::new(&relative))
        .ok()
        .map(|entry| entry.id().to_string());
    let expected = base_hash.map(str::to_ascii_lowercase);
    if existing != expected {
        return Err(conflict(id, base_hash, existing.as_deref()));
    }
    check_parents_are_trees(&base_tree, &relative)?;

    let blob = repo.blob(&bytes).map_err(internal)?;
    let tree_id = git2::build::TreeUpdateBuilder::new()
        .upsert(&relative, blob, FileMode::Blob)
        .create_updated(&repo, &base_tree)
        .map_err(internal)?;
    let tree = repo.find_tree(tree_id).map_err(internal)?;
    let branch = proposal_branch(id);
    let signature = proposal_signature(&repo)?;
    let commit = repo
        .commit(
            Some(&format!("refs/heads/{branch}")),
            &signature,
            &signature,
            &commit_message(id, message),
            &tree,
            &[&base],
        )
        .map_err(internal)?;

    Ok(Proposal {
        project: path_string(&root),
        id: id.to_string(),
        branch,
        commit: commit.to_string(),
        base: base.id().to_string(),
        created: existing.is_none(),
        hash: blob.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const FIXTURES: &str = include_str!("../../../src/lib/agents/supervisorLink.fixtures.json");

    fn fixtures() -> Value {
        serde_json::from_str(FIXTURES).unwrap()
    }

    struct Project {
        _dir: tempfile::TempDir,
        root: PathBuf,
    }

    impl Project {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path().canonicalize().unwrap();
            Self { _dir: dir, root }
        }

        fn path(&self) -> &str {
            self.root.to_str().unwrap()
        }

        fn write(&self, relative: &str, content: &str) {
            let path = self.root.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, content).unwrap();
        }

        fn policy(&self) -> LinkPolicy {
            LinkPolicy {
                scene_projects: vec![self.path().to_string()],
            }
        }

        fn init_repo(&self) -> Repository {
            let repo = Repository::init(&self.root).unwrap();
            let mut config = repo.config().unwrap();
            config.set_str("user.name", "Test Person").unwrap();
            config.set_str("user.email", "test@example.com").unwrap();
            repo
        }

        fn commit_all(&self, repo: &Repository, message: &str) -> Oid {
            let mut index = repo.index().unwrap();
            index
                .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
                .unwrap();
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            let signature = repo.signature().unwrap();
            let parents: Vec<git2::Commit> = repo
                .head()
                .ok()
                .and_then(|head| head.peel_to_commit().ok())
                .into_iter()
                .collect();
            let parents: Vec<&git2::Commit> = parents.iter().collect();
            repo.commit(
                Some("HEAD"),
                &signature,
                &signature,
                message,
                &tree,
                &parents,
            )
            .unwrap()
        }
    }

    fn code(result: Result<impl std::fmt::Debug, SceneError>) -> &'static str {
        result.unwrap_err().code.as_str()
    }

    #[test]
    fn constants_match_the_fixtures() {
        let f = fixtures();
        assert_eq!(f["maxSceneBytes"], MAX_SCENE_BYTES);
        assert_eq!(f["search"]["maxLimit"], SEARCH_MAX_LIMIT);
        assert_eq!(f["search"]["maxDepth"], SEARCH_MAX_DEPTH);
        assert_eq!(
            f["search"]["maxFilesPerProject"],
            SEARCH_MAX_FILES_PER_PROJECT
        );
        assert_eq!(f["proposalBranchPrefix"], PROPOSAL_BRANCH_PREFIX);
        let wire: Vec<&str> = f["errorCodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c.as_str().unwrap())
            .collect();
        for c in [
            SceneErrorCode::InvalidParams,
            SceneErrorCode::SceneNotVisible,
            SceneErrorCode::SceneNotFound,
            SceneErrorCode::SceneInvalid,
            SceneErrorCode::SceneConflict,
            SceneErrorCode::NotAGitRepo,
            SceneErrorCode::Internal,
        ] {
            assert!(wire.contains(&c.as_str()), "{}", c.as_str());
        }
    }

    #[test]
    fn scene_ids_follow_the_fixtures() {
        let f = fixtures();
        for id in f["sceneIds"]["valid"].as_array().unwrap() {
            let id = id.as_str().unwrap();
            assert!(validate_scene_id(id).is_ok(), "{id} should be valid");
        }
        for id in f["sceneIds"]["invalid"].as_array().unwrap() {
            let id = id.as_str().unwrap();
            assert_eq!(
                code(validate_scene_id(id).map(|_| ())),
                "invalid_params",
                "{id}"
            );
        }
    }

    #[test]
    fn refs_resolve_as_the_fixtures_say() {
        for case in fixtures()["resolve"].as_array().unwrap() {
            let from = case["from"].as_str().unwrap();
            let reference = case["ref"].as_str().unwrap();
            let result = resolve_ref(from, reference);
            match case.get("id").and_then(Value::as_str) {
                Some(id) => assert_eq!(result.unwrap(), id, "{from} + {reference}"),
                None => assert_eq!(
                    code(result),
                    case["error"].as_str().unwrap(),
                    "{from} + {reference}"
                ),
            }
        }
    }

    #[test]
    fn projects_lists_existing_folders_with_their_repo_state() {
        let repo_project = Project::new();
        repo_project.init_repo();
        let plain = Project::new();
        let policy = LinkPolicy {
            scene_projects: vec![
                repo_project.path().to_string(),
                plain.path().to_string(),
                "/does/not/exist/anywhere".to_string(),
            ],
        };
        let projects = visible_projects(&policy);
        assert_eq!(projects.len(), 2);
        let by_path = |p: &Project| {
            projects
                .iter()
                .find(|s| s.path == p.path())
                .unwrap()
                .clone()
        };
        assert!(by_path(&repo_project).is_git_repo);
        assert!(!by_path(&plain).is_git_repo);
        assert_eq!(
            by_path(&plain).name,
            plain.root.file_name().unwrap().to_str().unwrap()
        );
    }

    fn search_fixture() -> Project {
        let p = Project::new();
        p.write(
            "docs/architecture/system.scene.json",
            r#"{ "hud": { "title": "System map", "subtitle": "All services" } }"#,
        );
        p.write("docs/overview.scene.json", r#"{ "nodes": [] }"#);
        p.write("docs/broken.scene.json", "[1, 2]");
        p.write("docs/notjson.scene.json", "nope");
        p.write("docs/.hidden/secret.scene.json", "{}");
        p.write("docs/readme.md", "# not a scene");
        p.write("src/elsewhere.scene.json", "{}");
        p
    }

    #[test]
    fn search_without_index_names_from_hud_or_file() {
        let p = search_fixture();
        let hits = search(&p.policy(), None, None, 50).unwrap();
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, vec!["docs/architecture/system", "docs/overview"]);
        assert_eq!(hits[0].name, "System map");
        assert_eq!(hits[0].description.as_deref(), Some("All services"));
        assert_eq!(hits[1].name, "overview");
        assert_eq!(hits[1].description, None);
        assert_eq!(hits[0].project, p.path());
        assert_eq!(
            hits[0].path,
            p.root
                .join("docs/architecture/system.scene.json")
                .to_str()
                .unwrap()
        );
        let bytes = std::fs::read(p.root.join("docs/overview.scene.json")).unwrap();
        assert_eq!(
            hits[1].hash,
            Oid::hash_object(ObjectType::Blob, &bytes)
                .unwrap()
                .to_string()
        );
    }

    #[test]
    fn search_uses_the_index_and_matches_every_word() {
        let p = search_fixture();
        p.write(
            "docs/scenes.index.json",
            r#"{ "scenes": [ { "id": "docs/overview", "name": "Big Picture",
                 "description": "Where things live", "tags": ["Billing", "core"] } ] }"#,
        );
        let hits = search(&p.policy(), None, None, 50).unwrap();
        let overview = hits.iter().find(|h| h.id == "docs/overview").unwrap();
        assert_eq!(overview.name, "Big Picture");
        assert_eq!(overview.description.as_deref(), Some("Where things live"));
        assert_eq!(overview.tags, vec!["Billing", "core"]);

        let ids = |q: &str| -> Vec<String> {
            search(&p.policy(), Some(q), Some(p.path()), 50)
                .unwrap()
                .into_iter()
                .map(|h| h.id)
                .collect()
        };
        assert_eq!(ids("billing CORE"), vec!["docs/overview"]);
        assert_eq!(ids("system services"), vec!["docs/architecture/system"]);
        assert_eq!(ids("big services"), Vec::<String>::new());
        assert_eq!(ids("docs").len(), 2);
        assert_eq!(search(&p.policy(), None, None, 1).unwrap().len(), 1);
    }

    #[test]
    fn a_project_outside_the_policy_is_not_visible() {
        let shown = search_fixture();
        let hidden = search_fixture();
        let policy = shown.policy();
        assert_eq!(
            code(search(&policy, None, Some(hidden.path()), 50)),
            "scene_not_visible"
        );
        assert_eq!(
            code(get(&policy, hidden.path(), "docs/overview", None)),
            "scene_not_visible"
        );
        assert_eq!(
            code(propose(
                &policy,
                hidden.path(),
                "docs/x",
                &json!({}),
                None,
                None
            )),
            "scene_not_visible"
        );
        assert!(search(&policy, None, None, 50)
            .unwrap()
            .iter()
            .all(|h| h.project == shown.path()));
        assert!(search(&LinkPolicy::default(), None, None, 50)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn get_reads_the_working_tree_or_a_revision() {
        let p = Project::new();
        let repo = p.init_repo();
        p.write("docs/system.scene.json", r#"{"v":1}"#);
        let first = p.commit_all(&repo, "first");
        p.write("docs/system.scene.json", r#"{"v":2}"#);

        let worktree = get(&p.policy(), p.path(), "docs/system", None).unwrap();
        assert_eq!(worktree.scene, json!({"v": 2}));
        assert_eq!(worktree.rev, None);
        assert_eq!(
            worktree.hash,
            Oid::hash_object(ObjectType::Blob, br#"{"v":2}"#)
                .unwrap()
                .to_string()
        );

        let at_head = get(&p.policy(), p.path(), "docs/system", Some("HEAD")).unwrap();
        assert_eq!(at_head.scene, json!({"v": 1}));
        assert_eq!(at_head.rev, Some(first.to_string()));
        let short = &first.to_string()[..7];
        assert_eq!(
            get(&p.policy(), p.path(), "docs/system", Some(short))
                .unwrap()
                .rev,
            Some(first.to_string())
        );

        assert_eq!(
            code(get(&p.policy(), p.path(), "docs/missing", None)),
            "scene_not_found"
        );
        assert_eq!(
            code(get(
                &p.policy(),
                p.path(),
                "docs/system",
                Some("no-such-branch")
            )),
            "scene_not_found"
        );
        assert_eq!(
            code(get(&p.policy(), p.path(), "docs/../x", None)),
            "invalid_params"
        );
        assert_eq!(
            code(get(&p.policy(), "relative/path", "docs/system", None)),
            "invalid_params"
        );

        let via = resolve(
            &p.policy(),
            p.path(),
            "docs/other",
            "system.scene.json",
            None,
        )
        .unwrap();
        assert_eq!(via.id, "docs/system");
    }

    #[test]
    fn get_refuses_what_is_not_a_scene() {
        let p = Project::new();
        p.write("docs/list.scene.json", "[]");
        p.write("docs/text.scene.json", "hello");
        p.write(
            "docs/huge.scene.json",
            &format!(r#"{{"pad":"{}"}}"#, "x".repeat(MAX_SCENE_BYTES)),
        );
        for id in ["docs/list", "docs/text", "docs/huge"] {
            assert_eq!(
                code(get(&p.policy(), p.path(), id, None)),
                "scene_invalid",
                "{id}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_project_is_not_followed() {
        let p = Project::new();
        let outside = Project::new();
        outside.write("secret.scene.json", r#"{"secret":true}"#);
        outside.write("folder/leak.scene.json", r#"{"secret":true}"#);
        std::fs::create_dir_all(p.root.join("docs")).unwrap();
        std::os::unix::fs::symlink(
            outside.root.join("secret.scene.json"),
            p.root.join("docs/secret.scene.json"),
        )
        .unwrap();
        std::os::unix::fs::symlink(outside.root.join("folder"), p.root.join("docs/folder"))
            .unwrap();
        // A link that stays inside the project is fine.
        p.write("docs/real.scene.json", "{}");
        std::os::unix::fs::symlink(
            p.root.join("docs/real.scene.json"),
            p.root.join("docs/alias.scene.json"),
        )
        .unwrap();

        assert_eq!(
            code(get(&p.policy(), p.path(), "docs/secret", None)),
            "scene_not_found"
        );
        assert_eq!(
            code(get(&p.policy(), p.path(), "docs/folder/leak", None)),
            "scene_not_found"
        );
        assert!(get(&p.policy(), p.path(), "docs/alias", None).is_ok());
        let ids: Vec<String> = search(&p.policy(), None, None, 50)
            .unwrap()
            .into_iter()
            .map(|h| h.id)
            .collect();
        assert_eq!(ids, vec!["docs/alias", "docs/real"]);
    }

    struct Snapshot {
        head: String,
        head_ref: Option<String>,
        index: Vec<(String, Oid)>,
        status: Vec<(String, git2::Status)>,
        file: String,
    }

    fn snapshot(p: &Project, repo: &Repository) -> Snapshot {
        let index = repo.index().unwrap();
        let mut statuses = git2::StatusOptions::new();
        statuses.include_untracked(true);
        Snapshot {
            head: repo.head().unwrap().target().unwrap().to_string(),
            head_ref: repo.head().unwrap().name().map(str::to_string),
            index: index
                .iter()
                .map(|e| (String::from_utf8(e.path.clone()).unwrap(), e.id))
                .collect(),
            status: repo
                .statuses(Some(&mut statuses))
                .unwrap()
                .iter()
                .map(|s| (s.path().unwrap().to_string(), s.status()))
                .collect(),
            file: std::fs::read_to_string(p.root.join("docs/system.scene.json")).unwrap(),
        }
    }

    fn assert_untouched(before: &Snapshot, after: &Snapshot) {
        assert_eq!(before.head, after.head);
        assert_eq!(before.head_ref, after.head_ref);
        assert_eq!(before.index, after.index);
        assert_eq!(before.status, after.status);
        assert_eq!(before.file, after.file);
    }

    fn blob_at(repo: &Repository, commit: &str, path: &str) -> String {
        let commit = repo.find_commit(Oid::from_str(commit).unwrap()).unwrap();
        let entry = commit.tree().unwrap().get_path(Path::new(path)).unwrap();
        let blob = repo.find_blob(entry.id()).unwrap();
        String::from_utf8(blob.content().to_vec()).unwrap()
    }

    #[test]
    fn propose_creates_a_branch_for_a_new_scene_and_touches_nothing_else() {
        let p = Project::new();
        let repo = p.init_repo();
        p.write("docs/system.scene.json", r#"{"v":1}"#);
        let base = p.commit_all(&repo, "first");
        // An uncommitted edit the human is in the middle of.
        p.write("docs/system.scene.json", r#"{"v":"draft"}"#);
        let before = snapshot(&p, &repo);

        let proposal = propose(
            &p.policy(),
            p.path(),
            "docs/modules/auth",
            &json!({"hud": {"title": "Auth"}}),
            None,
            Some("Add the auth module"),
        )
        .unwrap();

        assert_untouched(&before, &snapshot(&p, &repo));
        assert!(!p.root.join("docs/modules").exists());
        assert!(proposal.created);
        assert_eq!(proposal.base, base.to_string());
        assert_eq!(proposal.project, p.path());
        assert!(proposal.branch.starts_with("auric/scene-proposal/auth-"));
        let suffix = proposal.branch.rsplit('-').next().unwrap();
        assert_eq!(suffix.len(), 8);
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));

        let branch = repo
            .find_branch(&proposal.branch, git2::BranchType::Local)
            .unwrap();
        assert_eq!(branch.get().target().unwrap().to_string(), proposal.commit);
        let commit = repo
            .find_commit(Oid::from_str(&proposal.commit).unwrap())
            .unwrap();
        assert_eq!(commit.parent_id(0).unwrap(), base);
        assert_eq!(
            commit.message().unwrap(),
            "scene: propose docs/modules/auth\n\nAdd the auth module\n"
        );
        assert_eq!(commit.author().name(), Some("Test Person"));
        let content = blob_at(&repo, &proposal.commit, "docs/modules/auth.scene.json");
        assert_eq!(
            content,
            format!(
                "{}\n",
                serde_json::to_string_pretty(&json!({"hud": {"title": "Auth"}})).unwrap()
            )
        );
        assert_eq!(
            proposal.hash,
            Oid::hash_object(ObjectType::Blob, content.as_bytes())
                .unwrap()
                .to_string()
        );
        // The committed scene is unchanged on the branch.
        assert_eq!(
            blob_at(&repo, &proposal.commit, "docs/system.scene.json"),
            r#"{"v":1}"#
        );
    }

    #[test]
    fn propose_updates_with_the_right_base_and_conflicts_otherwise() {
        let p = Project::new();
        let repo = p.init_repo();
        p.write("docs/system.scene.json", r#"{"v":1}"#);
        p.commit_all(&repo, "first");
        let current = get(&p.policy(), p.path(), "docs/system", Some("HEAD")).unwrap();
        let before = snapshot(&p, &repo);

        let update = propose(
            &p.policy(),
            p.path(),
            "docs/system",
            &json!({"v": 2}),
            Some(&current.hash),
            None,
        )
        .unwrap();
        assert!(!update.created);
        let commit = repo
            .find_commit(Oid::from_str(&update.commit).unwrap())
            .unwrap();
        assert_eq!(commit.message().unwrap(), "scene: propose docs/system\n");
        assert_eq!(
            blob_at(&repo, &update.commit, "docs/system.scene.json"),
            "{\n  \"v\": 2\n}\n"
        );

        let wrong = propose(
            &p.policy(),
            p.path(),
            "docs/system",
            &json!({"v": 3}),
            Some(&update.hash),
            None,
        )
        .unwrap_err();
        assert_eq!(wrong.code, SceneErrorCode::SceneConflict);
        assert!(wrong.message.contains(&update.hash), "{}", wrong.message);
        assert!(wrong.message.contains(&current.hash), "{}", wrong.message);

        let exists =
            propose(&p.policy(), p.path(), "docs/system", &json!({}), None, None).unwrap_err();
        assert_eq!(exists.code, SceneErrorCode::SceneConflict);
        assert!(exists.message.contains("no file"), "{}", exists.message);

        let missing = propose(
            &p.policy(),
            p.path(),
            "docs/new",
            &json!({}),
            Some(&current.hash),
            None,
        )
        .unwrap_err();
        assert_eq!(missing.code, SceneErrorCode::SceneConflict);

        assert_untouched(&before, &snapshot(&p, &repo));
        let proposals = repo
            .branches(Some(git2::BranchType::Local))
            .unwrap()
            .filter(|b| {
                b.as_ref()
                    .unwrap()
                    .0
                    .name()
                    .unwrap()
                    .unwrap()
                    .starts_with(PROPOSAL_BRANCH_PREFIX)
            })
            .count();
        assert_eq!(proposals, 1, "a refused proposal leaves no branch");
    }

    #[test]
    fn propose_needs_a_repository_with_a_commit() {
        let plain = Project::new();
        assert_eq!(
            code(propose(
                &plain.policy(),
                plain.path(),
                "docs/a",
                &json!({}),
                None,
                None
            )),
            "not_a_git_repo"
        );
        let unborn = Project::new();
        unborn.init_repo();
        assert_eq!(
            code(propose(
                &unborn.policy(),
                unborn.path(),
                "docs/a",
                &json!({}),
                None,
                None
            )),
            "not_a_git_repo"
        );
        // A folder inside a repository is not the repository.
        let outer = Project::new();
        let repo = outer.init_repo();
        outer.write("nested/docs/a.scene.json", "{}");
        outer.commit_all(&repo, "first");
        let nested = outer.root.join("nested");
        let policy = LinkPolicy {
            scene_projects: vec![nested.to_str().unwrap().to_string()],
        };
        assert_eq!(
            code(propose(
                &policy,
                nested.to_str().unwrap(),
                "docs/b",
                &json!({}),
                None,
                None
            )),
            "not_a_git_repo"
        );
        // Reading at a revision still works there.
        assert!(get(&policy, nested.to_str().unwrap(), "docs/a", Some("HEAD")).is_ok());
    }

    #[test]
    fn propose_refuses_what_is_not_a_scene() {
        let p = Project::new();
        let repo = p.init_repo();
        p.write("README.md", "x");
        p.commit_all(&repo, "first");
        assert_eq!(
            code(propose(
                &p.policy(),
                p.path(),
                "docs/a",
                &json!([1]),
                None,
                None
            )),
            "scene_invalid"
        );
        let huge = json!({ "pad": "x".repeat(MAX_SCENE_BYTES) });
        assert_eq!(
            code(propose(&p.policy(), p.path(), "docs/a", &huge, None, None)),
            "scene_invalid"
        );
        assert_eq!(
            code(propose(
                &p.policy(),
                p.path(),
                "docs/a.scene.json",
                &json!({}),
                None,
                None
            )),
            "invalid_params"
        );
    }

    #[test]
    fn a_branch_segment_git_would_refuse_is_made_safe() {
        let branch = proposal_branch("docs/x/a..b");
        assert!(
            git2::Reference::is_valid_name(&format!("refs/heads/{branch}")),
            "{branch}"
        );
        assert!(proposal_branch("docs/x/auth-v2").starts_with("auric/scene-proposal/auth-v2-"));
    }
}
