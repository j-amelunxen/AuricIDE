//! Project Managers: supervisor runs the human chose to keep, with a name.
//!
//! Identity lives in `<app_data_dir>/supervisor-managers.json`, owned by Rust,
//! not in the run folder, because the manager's own file tools reach that whole
//! folder. A registry that cannot be read is never overwritten: writing an
//! empty one over a file we failed to parse would forget every manager.
//!
//! The contract is `src/lib/agents/supervisorManagers.fixtures.json`; the
//! tests below run it.

use super::runs::{resolve_run_dir, RunManager, SupervisorRun};
use super::several::{is_live_supervisor, is_valid_key, read_run_key, run_dir_holder};
use super::{app_data_dir, write_json_atomic};
use super::{new_supervisor_run_dir, supervisor_runs_root};
use crate::agents::{AgentInfo, AgentManagerState};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const REGISTRY_FILE_NAME: &str = "supervisor-managers.json";
/// Fixture `validationFileName`, kept in `<app_data_dir>/managers/<key>/`.
pub const VALIDATION_FILE_NAME: &str = "validation.json";
const REGISTRY_VERSION: u32 = 1;
const MAX_NAME_LENGTH: usize = 40;
const MAX_KEY_LENGTH: usize = 48;
const FALLBACK_KEY: &str = "manager";
pub const INSTRUCTIONS_FILE_NAME: &str = "INSTRUCTIONS.md";
const MAX_INSTRUCTIONS_BYTES: u64 = 16384;
const MEMORY_BUNDLE_DIR: &str = "knowledge";
const MEMORY_ROOT_INDEX: &str = "---\nokf_version: \"0.2\"\n---\n\n# Knowledge Base\n";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LastLaunch {
    pub at: String,
    pub instructions_sha256: String,
}

impl SessionBook {
    fn started(at: String) -> Self {
        Self {
            started_at: at,
            noted_at: None,
        }
    }
}

/// Which session of a manager has had its note. Separate from `LastLaunch`,
/// whose hash is that of the prompt a fresh launch injected, and which a
/// restore after an app restart does not touch.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionBook {
    /// Booked on every start, a restore included; a session's identity.
    pub started_at: String,
    /// Equal to `started_at` once that session's note was written.
    pub noted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagerRecord {
    pub key: String,
    pub name: String,
    /// A folder name under the runs root, never a path.
    pub run_dir: String,
    pub promoted_at: String,
    pub archived_at: Option<String>,
    pub last_launch: Option<LastLaunch>,
    /// Absent in entries written before it existed: they are not caught up.
    #[serde(default)]
    pub session: Option<SessionBook>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Registry {
    version: u32,
    managers: Vec<ManagerRecord>,
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            version: REGISTRY_VERSION,
            managers: Vec::new(),
        }
    }
}

/// What `manager_list` answers: the managers, or why the registry cannot be
/// used. Never both, so the UI cannot offer actions on a file we could not read.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagerList {
    pub managers: Vec<ManagerRecord>,
    pub error: Option<String>,
}

/// A manager as `manager_list` shows it: the registry entry plus whether its
/// run folder still resolves under the runs root (fixture `runMissing`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListedManager {
    #[serde(flatten)]
    pub record: ManagerRecord,
    pub run_missing: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagerListing {
    pub managers: Vec<ListedManager>,
    pub error: Option<String>,
}

// ---- refusals: the sentences the fixture's `refusals` patterns describe ----

fn name_invalid() -> String {
    format!("A Project Manager name needs 1 to {MAX_NAME_LENGTH} characters on one line.")
}

fn name_taken(name: &str) -> String {
    format!("A Project Manager named '{name}' already exists.")
}

pub(crate) fn run_missing(run: &str) -> String {
    format!("The supervisor run folder '{run}' no longer exists.")
}

fn run_taken(run: &str, manager: &str) -> String {
    format!("The run folder {run} already belongs to the Project Manager '{manager}'.")
}

fn create_failed(name: &str, reason: &str) -> String {
    format!("Could not create a run folder for '{name}': {reason}")
}

fn not_found(key: &str) -> String {
    format!("No Project Manager has the key '{key}'.")
}

fn instructions_too_large(name: &str, bytes: u64) -> String {
    format!(
        "{INSTRUCTIONS_FILE_NAME} of '{name}' is {bytes} bytes; the limit is {MAX_INSTRUCTIONS_BYTES}."
    )
}

fn registry_unreadable(reason: &str) -> String {
    format!("{REGISTRY_FILE_NAME} could not be read: {reason} It was left as it is.")
}

fn not_archived(name: &str) -> String {
    format!("The Project Manager '{name}' must be archived before it is removed.")
}

// ---- names and keys ----

/// Zero-width and bidirectional format characters: invisible or reordering, so
/// two different names could read the same on screen.
fn is_invisible_format(character: char) -> bool {
    matches!(
        character,
        '\u{00AD}'
            | '\u{061C}'
            | '\u{180E}'
            | '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{2064}'
            | '\u{2066}'..='\u{2069}'
            | '\u{FEFF}'
    )
}

/// The trimmed name, or why it is not one: 1 to 40 characters, no line break,
/// tab or other control character, no invisible format character.
pub fn validate_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    let length = name.chars().count();
    if length == 0
        || length > MAX_NAME_LENGTH
        || name
            .chars()
            .any(|c| c.is_control() || is_invisible_format(c))
    {
        return Err(name_invalid());
    }
    Ok(name.to_string())
}

/// Letters that fold to ASCII for a key. Not every script: a name that folds to
/// nothing still gets a key (`FALLBACK_KEY`).
const FOLDED_LETTERS: &[(&str, &str)] = &[
    ("ÀÁÂÃÄÅàáâãäåĀāĂăĄą", "a"),
    ("ÇçĆćĈĉĊċČč", "c"),
    ("ĎďĐđ", "d"),
    ("ÈÉÊËèéêëĒēĔĕĖėĘęĚě", "e"),
    ("ĜĝĞğĠġĢģ", "g"),
    ("ÌÍÎÏìíîïĨĩĪīĬĭĮįİı", "i"),
    ("ĹĺĻļĽľŁł", "l"),
    ("ÑñŃńŅņŇň", "n"),
    ("ÒÓÔÕÖØòóôõöøŌōŎŏŐő", "o"),
    ("ŔŕŖŗŘř", "r"),
    ("ŚśŜŝŞşŠš", "s"),
    ("ŢţŤť", "t"),
    ("ÙÚÛÜùúûüŨũŪūŬŭŮůŰűŲų", "u"),
    ("ÝýÿŶŷŸ", "y"),
    ("ŹźŻżŽž", "z"),
    ("ß", "ss"),
    ("Ææ", "ae"),
    ("Œœ", "oe"),
    ("ﬀ", "ff"),
    ("ﬁ", "fi"),
    ("ﬂ", "fl"),
];

fn push_folded(character: char, out: &mut String) {
    if character.is_ascii_alphanumeric() {
        out.push(character.to_ascii_lowercase());
    } else if let Some((_, ascii)) = FOLDED_LETTERS
        .iter()
        .find(|(letters, _)| letters.contains(character))
    {
        out.push_str(ascii);
    } else if !out.ends_with('-') {
        out.push('-');
    }
}

fn cut_key(key: &str, max: usize) -> String {
    key.chars()
        .take(max)
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// A supervisor key for `name` that is neither in `taken` nor shaped like an
/// agent id (fixture `keyFromName`).
pub fn key_from_name(name: &str, taken: &[String]) -> String {
    let mut folded = String::new();
    name.chars().for_each(|c| push_folded(c, &mut folded));
    let base = cut_key(folded.trim_matches('-'), MAX_KEY_LENGTH);
    let base = if base.is_empty() {
        FALLBACK_KEY.to_string()
    } else {
        base
    };
    let is_free = |key: &str| is_valid_key(key) && !taken.iter().any(|t| t == key);
    if is_free(&base) {
        return base;
    }
    (2..)
        .map(|n| {
            let suffix = format!("-{n}");
            format!("{}{suffix}", cut_key(&base, MAX_KEY_LENGTH - suffix.len()))
        })
        .find(|key| is_free(key))
        .unwrap_or_else(|| unreachable!("the counter is unbounded"))
}

// ---- the registry file ----

fn read_registry(path: &Path) -> Result<Registry, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Registry::default())
        }
        Err(error) => return Err(registry_unreadable(&format!("{error}."))),
    };
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| registry_unreadable(&format!("it is not valid JSON ({error}).")))?;
    let version = value.get("version").and_then(serde_json::Value::as_u64);
    if version != Some(u64::from(REGISTRY_VERSION)) {
        return Err(registry_unreadable(&format!(
            "this build reads version {REGISTRY_VERSION} only."
        )));
    }
    let registry: Registry = serde_json::from_value(value)
        .map_err(|error| registry_unreadable(&format!("an entry is malformed ({error}).")))?;
    // Keys become folder names under `managers/`; a hand-edited one must not
    // be able to leave it.
    match registry.managers.iter().find(|m| !is_valid_key(&m.key)) {
        Some(bad) => Err(registry_unreadable(&format!(
            "an entry has the invalid key {:?}.",
            bad.key
        ))),
        None => Ok(registry),
    }
}

/// Read, change, write, as one step. Two promotions at once would otherwise
/// each write back what they read and the later one would drop the earlier.
fn update_registry<T>(
    path: &Path,
    change: impl FnOnce(&mut Registry) -> Result<T, String>,
) -> Result<T, String> {
    static UPDATE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _updating = UPDATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut registry = read_registry(path)?;
    let outcome = change(&mut registry)?;
    write_json_atomic(path, &registry)?;
    Ok(outcome)
}

fn find_mut<'a>(registry: &'a mut Registry, key: &str) -> Result<&'a mut ManagerRecord, String> {
    registry
        .managers
        .iter_mut()
        .find(|record| record.key == key)
        .ok_or_else(|| not_found(key))
}

/// Unique among managers that are not archived, ignoring case. `except` is the
/// manager being renamed or restored.
fn ensure_name_free(registry: &Registry, name: &str, except: Option<&str>) -> Result<(), String> {
    let wanted = name.to_lowercase();
    let clash = registry.managers.iter().any(|record| {
        record.archived_at.is_none()
            && Some(record.key.as_str()) != except
            && record.name.to_lowercase() == wanted
    });
    if clash {
        Err(name_taken(name))
    } else {
        Ok(())
    }
}

pub(super) fn timestamp_now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

// ---- promotion ----

fn instructions_template(name: &str) -> String {
    format!(
        "# Instructions for {name}\n\n\
         <!-- Standing instructions for this Project Manager. They are added to its\n     \
         start prompt every time it opens. They steer; they grant nothing: what it\n     \
         may start, where and with which model stays in Settings → Supervisor. -->\n\n\
         Examples:\n\n\
         - Write every ticket in Spanish.\n\
         - Halve the estimated hours on anything billed to the customer.\n"
    )
}

/// Writes `content` to `path` unless something is already there.
fn write_if_absent(path: &Path, content: &str) -> Result<(), String> {
    use std::io::Write;
    let created = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path);
    match created {
        Ok(mut file) => file
            .write_all(content.as_bytes())
            .map_err(|error| format!("Could not write {}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(format!("Could not write {}: {error}", path.display())),
    }
}

fn symlink_refused(path: &Path) -> String {
    format!(
        "{} is a symbolic link; a Project Manager's own files must be real files.",
        path.display()
    )
}

/// Fails when `path` is a symbolic link. Missing is fine.
fn refuse_symlink(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(symlink_refused(path)),
        _ => Ok(()),
    }
}

fn scaffold_run_folder(run: &Path, name: &str) -> Result<(), String> {
    refuse_symlink(&run.join(INSTRUCTIONS_FILE_NAME))?;
    refuse_symlink(&run.join(MEMORY_BUNDLE_DIR))?;
    write_if_absent(
        &run.join(INSTRUCTIONS_FILE_NAME),
        &instructions_template(name),
    )?;
    let bundle = run.join(MEMORY_BUNDLE_DIR);
    std::fs::create_dir_all(&bundle)
        .map_err(|error| format!("Could not create {}: {error}", bundle.display()))?;
    write_if_absent(&bundle.join("index.md"), MEMORY_ROOT_INDEX)
}

/// The run's existing address wins (the live supervisor's key, then the one in
/// its `supervisor.json`) unless a registry entry or a live supervisor working
/// elsewhere already holds it; else one derived from the name.
fn promotion_key(registry: &Registry, live: &[AgentInfo], run: &Path, name: &str) -> String {
    let registry_keys: Vec<String> = registry.managers.iter().map(|m| m.key.clone()).collect();
    let live_keys: Vec<String> = live
        .iter()
        .filter_map(|agent| agent.supervisor_key.clone())
        .collect();
    let holder = run_dir_holder(live, run);
    let keys_elsewhere = live.iter().filter(|agent| {
        is_live_supervisor(agent) && holder.map_or(true, |holder| holder.id != agent.id)
    });
    let elsewhere: Vec<&String> = keys_elsewhere
        .filter_map(|agent| agent.supervisor_key.as_ref())
        .collect();
    let own_key = holder
        .and_then(|holder| holder.supervisor_key.clone())
        .or_else(|| read_run_key(run))
        .filter(|key| !registry_keys.contains(key) && !elsewhere.contains(&key));
    own_key.unwrap_or_else(|| {
        let taken: Vec<String> = registry_keys.into_iter().chain(live_keys).collect();
        key_from_name(name, &taken)
    })
}

/// The session of a supervisor already working in the folder being promoted:
/// it began when its process did, so a crash during it is caught up too.
fn running_session(agent: &AgentInfo) -> SessionBook {
    let started = i64::try_from(agent.started_at / 1000).unwrap_or_default();
    let at = chrono::DateTime::from_timestamp(started, 0)
        .unwrap_or_default()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();
    SessionBook::started(at)
}

/// Makes the run folder `run_dir` (a name under `runs_root`) a Project Manager.
pub fn promote(
    registry_path: &Path,
    runs_root: &Path,
    run_dir: &str,
    name: &str,
    live: &[AgentInfo],
) -> Result<ManagerRecord, String> {
    let name = validate_name(name)?;
    let requested = runs_root.join(run_dir);
    if !requested.exists() {
        return Err(run_missing(run_dir));
    }
    let run = resolve_run_dir(runs_root, &requested.to_string_lossy())?;
    let folder = run
        .file_name()
        .map(|part| part.to_string_lossy().into_owned())
        .ok_or_else(|| run_missing(run_dir))?;
    update_registry(registry_path, |registry| {
        if let Some(owner) = registry.managers.iter().find(|m| m.run_dir == folder) {
            return Err(run_taken(&folder, &owner.name));
        }
        ensure_name_free(registry, &name, None)?;
        let record = ManagerRecord {
            key: promotion_key(registry, live, &run, &name),
            name: name.clone(),
            run_dir: folder.clone(),
            promoted_at: timestamp_now(),
            archived_at: None,
            last_launch: None,
            session: run_dir_holder(live, &run).map(running_session),
        };
        scaffold_run_folder(&run, &name)?;
        registry.managers.push(record.clone());
        Ok(record)
    })
}

/// The manager's run folder, or `manager_run_missing`. Anything that is not a
/// real folder directly under the runs root counts as missing: gone, the runs
/// root gone, or a symbolic link, even one to a sibling run folder, because
/// the manager's identity is its own folder. The sentence names the folder,
/// never a path.
pub fn resolve_manager_run(runs_root: &Path, run_dir: &str) -> Result<PathBuf, String> {
    let folder = runs_root.join(run_dir);
    let is_link =
        std::fs::symlink_metadata(&folder).is_ok_and(|meta| meta.file_type().is_symlink());
    if is_link {
        return Err(run_missing(run_dir));
    }
    resolve_run_dir(runs_root, &folder.to_string_lossy()).map_err(|_| run_missing(run_dir))
}

/// The `manager_run_missing` sentence when `requested` (a path) names the
/// folder of a manager whose folder is gone, else `None`: the client asked
/// for a manager's folder by path and must hear the folder's name, not a path.
pub fn missing_manager_folder(
    managers: &[ManagerRecord],
    runs_root: &Path,
    requested: &str,
) -> Option<String> {
    let name = Path::new(requested).file_name()?.to_string_lossy();
    let record = managers.iter().find(|m| m.run_dir == name)?;
    resolve_manager_run(runs_root, &record.run_dir).err()
}

/// A Project Manager without an earlier run: a fresh run folder, named the
/// way a new supervisor's is, promoted in one step. A refused promotion takes
/// the folder away again, so a refused name leaves nothing behind.
pub fn create(
    registry_path: &Path,
    home: &Path,
    name: &str,
    live: &[AgentInfo],
) -> Result<ManagerRecord, String> {
    let name = validate_name(name)?;
    // Refused before anything is made: a new folder also gets an entry in the
    // CLI's trust file, which a refusal afterwards would leave behind.
    ensure_name_free(&read_registry(registry_path)?, &name, None)?;
    let started = chrono::Local::now().format("%Y-%m-%d_%H%M%S").to_string();
    let run =
        new_supervisor_run_dir(home, &started).map_err(|reason| create_failed(&name, &reason))?;
    let folder = run
        .file_name()
        .map(|part| part.to_string_lossy().into_owned())
        .ok_or_else(|| create_failed(&name, "the folder has no name."))?;
    let promoted = promote(
        registry_path,
        &supervisor_runs_root(home),
        &folder,
        &name,
        live,
    );
    if promoted.is_err() {
        // Ours, created a moment ago and still empty or half-scaffolded.
        let _ = std::fs::remove_dir_all(&run);
    }
    promoted
}

// ---- the other lifecycle steps ----

pub fn rename(registry_path: &Path, key: &str, name: &str) -> Result<ManagerRecord, String> {
    let name = validate_name(name)?;
    update_registry(registry_path, |registry| {
        ensure_name_free(registry, &name, Some(key))?;
        let record = find_mut(registry, key)?;
        record.name = name;
        Ok(record.clone())
    })
}

pub fn archive(registry_path: &Path, key: &str) -> Result<ManagerRecord, String> {
    update_registry(registry_path, |registry| {
        let record = find_mut(registry, key)?;
        if record.archived_at.is_none() {
            record.archived_at = Some(timestamp_now());
        }
        Ok(record.clone())
    })
}

pub fn restore(registry_path: &Path, key: &str) -> Result<ManagerRecord, String> {
    update_registry(registry_path, |registry| {
        let name = find_mut(registry, key)?.name.clone();
        ensure_name_free(registry, &name, Some(key))?;
        let record = find_mut(registry, key)?;
        record.archived_at = None;
        Ok(record.clone())
    })
}

/// Forgets an archived manager. Its folder stays and becomes an ordinary run.
pub fn remove(registry_path: &Path, key: &str) -> Result<(), String> {
    update_registry(registry_path, |registry| {
        let record = find_mut(registry, key)?;
        if record.archived_at.is_none() {
            return Err(not_archived(&record.name));
        }
        registry.managers.retain(|m| m.key != key);
        Ok(())
    })
}

pub fn list(registry_path: &Path) -> ManagerList {
    match read_registry(registry_path) {
        Ok(registry) => ManagerList {
            managers: registry.managers,
            error: None,
        },
        Err(error) => ManagerList {
            managers: Vec::new(),
            error: Some(error),
        },
    }
}

/// `list`, with each manager's folder checked: one that is gone stays listed,
/// marked `run_missing`, so the human can archive or remove it.
pub fn list_with_run_state(registry_path: &Path, runs_root: &Path) -> ManagerListing {
    let ManagerList { managers, error } = list(registry_path);
    let managers = managers
        .into_iter()
        .map(|record| {
            let run_missing = resolve_manager_run(runs_root, &record.run_dir).is_err();
            ListedManager {
                record,
                run_missing,
            }
        })
        .collect();
    ManagerListing { managers, error }
}

/// The text of the manager's `INSTRUCTIONS.md`; `None` when there is no file.
/// A file over the limit is refused rather than cut: starting a manager
/// without all of what the human wrote would be wrong in a way nobody notices.
pub fn read_instructions(
    registry_path: &Path,
    runs_root: &Path,
    key: &str,
) -> Result<Option<String>, String> {
    let registry = read_registry(registry_path)?;
    let record = registry
        .managers
        .iter()
        .find(|m| m.key == key)
        .ok_or_else(|| not_found(key))?;
    let run = resolve_manager_run(runs_root, &record.run_dir)?;
    let file = run.join(INSTRUCTIONS_FILE_NAME);
    refuse_symlink(&file)?;
    let size = match std::fs::metadata(&file) {
        Ok(meta) => meta.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read {}: {error}", file.display())),
    };
    if size > MAX_INSTRUCTIONS_BYTES {
        return Err(instructions_too_large(&record.name, size));
    }
    std::fs::read_to_string(&file)
        .map(Some)
        .map_err(|error| format!("Could not read {}: {error}", file.display()))
}

/// The managers a launch may be about, or why the registry cannot say. A
/// registry that cannot be read stops the launch: opening a manager folder
/// without its rules would be wrong in a way nobody notices.
pub fn launch_candidates(registry_path: &Path) -> Result<Vec<ManagerRecord>, String> {
    read_registry(registry_path).map(|registry| registry.managers)
}

/// Books that `key` was opened now with `instructions` (`None`: no file),
/// and that a new session began.
pub fn record_launch(
    registry_path: &Path,
    key: &str,
    instructions: Option<&str>,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(instructions.unwrap_or_default().as_bytes());
    update_registry(registry_path, |registry| {
        let record = find_mut(registry, key)?;
        let now = timestamp_now();
        record.last_launch = Some(LastLaunch {
            at: now.clone(),
            instructions_sha256: format!("{digest:x}"),
        });
        record.session = Some(SessionBook::started(now));
        Ok(())
    })
}

/// Books a new session without a launch: a manager restored after an app
/// restart replays the prompt it started with, so `lastLaunch` stays.
pub fn record_session_start(registry_path: &Path, key: &str) -> Result<(), String> {
    update_registry(registry_path, |registry| {
        find_mut(registry, key)?.session = Some(SessionBook::started(timestamp_now()));
        Ok(())
    })
}

/// Books that the session that began at `started_at` has had its note. A
/// newer session, started since, is left as it is.
pub fn record_session_noted(
    registry_path: &Path,
    key: &str,
    started_at: &str,
) -> Result<(), String> {
    update_registry(registry_path, |registry| {
        if let Some(book) = find_mut(registry, key)?.session.as_mut() {
            if book.started_at == started_at {
                book.noted_at = Some(started_at.to_string());
            }
        }
        Ok(())
    })
}

/// The record behind `key`, or why there is none. For features that act on a
/// manager's folder and must not touch anything else.
pub(super) fn find_record(registry_path: &Path, key: &str) -> Result<ManagerRecord, String> {
    read_registry(registry_path)?
        .managers
        .into_iter()
        .find(|record| record.key == key)
        .ok_or_else(|| not_found(key))
}

/// Marks the runs that belong to a manager. An unreadable registry marks
/// nothing; `manager_list` is where its error is shown.
pub fn attach_managers(runs: &mut [SupervisorRun], managers: &[ManagerRecord]) {
    for run in runs {
        run.manager = managers
            .iter()
            .find(|record| record.run_dir == run.name)
            .map(|record| RunManager {
                key: record.key.clone(),
                name: record.name.clone(),
                archived_at: record.archived_at.clone(),
            });
    }
}

pub(super) fn attach_managers_from_app(app: &tauri::AppHandle, runs: &mut [SupervisorRun]) {
    if let Ok(path) = registry_path(app) {
        attach_managers(runs, &list(&path).managers);
    }
}

// ---- Tauri commands ----

fn registry_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(REGISTRY_FILE_NAME))
}

#[tauri::command(async)]
pub fn manager_list(app: tauri::AppHandle) -> Result<ManagerListing, String> {
    Ok(list_with_run_state(
        &registry_path(&app)?,
        &super::runs::runs_root(&app)?,
    ))
}

#[tauri::command(async)]
pub async fn manager_create(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentManagerState>,
    name: String,
) -> Result<ManagerRecord, String> {
    use tauri::Manager;
    let home = app
        .path()
        .home_dir()
        .map_err(|error| format!("The home directory is unavailable: {error}"))?;
    let live = crate::agents::list_agents_impl(&state).await?;
    create(&registry_path(&app)?, &home, &name, &live)
}

#[tauri::command(async)]
pub async fn manager_promote(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentManagerState>,
    run_dir: String,
    name: String,
) -> Result<ManagerRecord, String> {
    let live = crate::agents::list_agents_impl(&state).await?;
    let runs_root = super::runs::runs_root(&app)?;
    let record = promote(&registry_path(&app)?, &runs_root, &run_dir, &name, &live)?;
    // A supervisor already working in the folder becomes addressable at once.
    let mut agents = state.lock().await;
    super::several::key_live_supervisor(
        agents.agents.values_mut().map(|process| &mut process.info),
        &runs_root.join(&record.run_dir),
        &record.key,
    );
    Ok(record)
}

#[tauri::command(async)]
pub fn manager_rename(
    app: tauri::AppHandle,
    key: String,
    name: String,
) -> Result<ManagerRecord, String> {
    rename(&registry_path(&app)?, &key, &name)
}

#[tauri::command(async)]
pub fn manager_archive(app: tauri::AppHandle, key: String) -> Result<ManagerRecord, String> {
    archive(&registry_path(&app)?, &key)
}

#[tauri::command(async)]
pub fn manager_restore(app: tauri::AppHandle, key: String) -> Result<ManagerRecord, String> {
    restore(&registry_path(&app)?, &key)
}

#[tauri::command(async)]
pub fn manager_remove(app: tauri::AppHandle, key: String) -> Result<(), String> {
    remove(&registry_path(&app)?, &key)
}

#[tauri::command(async)]
pub fn manager_instructions(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    read_instructions(&registry_path(&app)?, &super::runs::runs_root(&app)?, &key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::{AgentRole, AgentStatus};
    use serde_json::Value;

    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../src/lib/agents/supervisorManagers.fixtures.json"
        ))
        .unwrap()
    }

    struct Sandbox {
        _dir: tempfile::TempDir,
        registry: PathBuf,
        runs: PathBuf,
    }

    impl Sandbox {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let runs = dir.path().join("runs");
            std::fs::create_dir_all(&runs).unwrap();
            Self {
                registry: dir.path().join(REGISTRY_FILE_NAME),
                runs,
                _dir: dir,
            }
        }

        fn run(&self, name: &str) -> PathBuf {
            let path = self.runs.join(name);
            std::fs::create_dir_all(&path).unwrap();
            path
        }

        fn promote(&self, run: &str, name: &str) -> Result<ManagerRecord, String> {
            self.run(run);
            promote(&self.registry, &self.runs, run, name, &[])
        }

        fn registry_bytes(&self) -> Vec<u8> {
            std::fs::read(&self.registry).unwrap()
        }
    }

    fn live_supervisor(key: Option<&str>, repo: &Path) -> AgentInfo {
        AgentInfo {
            id: "agent-3".into(),
            name: "Supervisor".into(),
            model: String::new(),
            provider: String::new(),
            status: AgentStatus::Running,
            current_task: None,
            started_at: 0,
            last_activity_at: None,
            project_path: None,
            repo_path: Some(repo.to_string_lossy().into_owned()),
            spawned_by_ticket_id: None,
            spawned_by_goal_id: None,
            headless: false,
            role: AgentRole::Supervisor,
            spawned_by_agent_id: None,
            supervisor_key: key.map(str::to_string),
        }
    }

    fn strings(value: &Value) -> Vec<String> {
        value
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn a_registry_from_before_sessions_were_booked_reads_and_is_not_caught_up() {
        let sandbox = Sandbox::new();
        std::fs::write(
            &sandbox.registry,
            r#"{"version":1,"managers":[{"key":"release-desk","name":"Release Desk",
            "runDir":"2026-10-21_090000","promotedAt":"2026-10-21T09:00:00Z",
            "archivedAt":null,"lastLaunch":{"at":"2026-10-22T09:00:00Z","instructionsSha256":"x"}}]}"#,
        )
        .unwrap();
        let listed = list(&sandbox.registry);
        assert_eq!(listed.error, None);
        assert_eq!(listed.managers[0].session, None);
        record_session_start(&sandbox.registry, "release-desk").unwrap();
        assert!(list(&sandbox.registry).managers[0].session.is_some());
    }

    #[test]
    fn promoting_a_running_supervisor_books_the_session_it_is_in() {
        let sandbox = Sandbox::new();
        let run = sandbox.run("2026-10-21_090000");
        let mut agent = live_supervisor(None, &run);
        agent.started_at = 1_792_746_000_999;

        let record = promote(
            &sandbox.registry,
            &sandbox.runs,
            "2026-10-21_090000",
            "Release Desk",
            &[agent],
        )
        .unwrap();

        assert_eq!(
            record.session,
            Some(SessionBook {
                started_at: "2026-10-23T09:00:00Z".to_string(),
                noted_at: None
            })
        );
        let idle = sandbox.promote("2026-10-22_090000", "Other Desk").unwrap();
        assert_eq!(
            idle.session, None,
            "a stopped run has no session to catch up"
        );
    }

    #[test]
    fn every_start_books_a_session_but_only_a_launch_books_the_prompt_hash() {
        let sandbox = Sandbox::new();
        let record = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        assert_eq!(record.session, None);

        record_launch(&sandbox.registry, &record.key, Some("abc")).unwrap();
        let launched = list(&sandbox.registry).managers.remove(0);
        let session = launched.session.clone().unwrap();
        assert_eq!(session.started_at, launched.last_launch.clone().unwrap().at);
        assert_eq!(session.noted_at, None);

        record_session_start(&sandbox.registry, &record.key).unwrap();
        let restored = list(&sandbox.registry).managers.remove(0);
        assert_eq!(
            restored.last_launch, launched.last_launch,
            "a restore books no launch"
        );
        assert!(restored.session.is_some());
    }

    #[test]
    fn a_note_is_booked_for_its_own_session_only() {
        let sandbox = Sandbox::new();
        let record = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        record_launch(&sandbox.registry, &record.key, None).unwrap();
        let started = list(&sandbox.registry).managers[0]
            .session
            .clone()
            .unwrap()
            .started_at;

        record_session_noted(&sandbox.registry, &record.key, "2000-01-01T00:00:00Z").unwrap();
        assert_eq!(
            list(&sandbox.registry).managers[0]
                .session
                .as_ref()
                .unwrap()
                .noted_at,
            None
        );

        record_session_noted(&sandbox.registry, &record.key, &started).unwrap();
        let book = list(&sandbox.registry).managers[0].session.clone().unwrap();
        assert_eq!(book.noted_at, Some(started));
    }

    #[test]
    fn a_launch_books_the_hash_of_the_instructions_and_nothing_else() {
        let sandbox = Sandbox::new();
        let record = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        record_launch(&sandbox.registry, &record.key, Some("abc")).unwrap();
        let booked = list(&sandbox.registry).managers.remove(0);
        let launch = booked.last_launch.clone().unwrap();
        assert_eq!(
            launch.instructions_sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            ManagerRecord {
                last_launch: None,
                session: None,
                ..booked
            },
            record,
            "a launch books the hash and the session, nothing else"
        );
        record_launch(&sandbox.registry, &record.key, None).unwrap();
        let without_file = list(&sandbox.registry)
            .managers
            .remove(0)
            .last_launch
            .unwrap();
        assert_eq!(
            without_file.instructions_sha256,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert!(record_launch(&sandbox.registry, "nobody", None).is_err());
    }

    // ---- hostile registry and run folder ----

    #[test]
    fn a_key_that_could_leave_the_managers_folder_makes_the_registry_unreadable() {
        for key in ["../x", "a/b", "UPPER", "agent-7", ""] {
            let sandbox = Sandbox::new();
            let record = serde_json::json!({
                "key": key, "name": "Evil", "runDir": "2026-10-21_090000",
                "promotedAt": "2026-10-21T09:00:00Z", "archivedAt": null, "lastLaunch": null
            });
            let text = serde_json::json!({ "version": 1, "managers": [record] }).to_string();
            std::fs::write(&sandbox.registry, &text).unwrap();
            let listed = list(&sandbox.registry);
            assert!(listed.managers.is_empty(), "{key:?}");
            let error = listed
                .error
                .unwrap_or_else(|| panic!("{key:?} was accepted"));
            assert!(error.contains("could not be read"), "{key:?}: {error}");
            assert_eq!(sandbox.registry_bytes(), text.as_bytes(), "left as it is");
        }
    }

    #[test]
    fn a_registry_that_cannot_be_opened_is_unreadable_not_empty() {
        let sandbox = Sandbox::new();
        std::fs::create_dir(&sandbox.registry).unwrap();
        let listed = list(&sandbox.registry);
        assert!(listed.managers.is_empty());
        assert!(listed.error.unwrap().contains("could not be read"));
        assert!(promote(&sandbox.registry, &sandbox.runs, "x", "Desk", &[]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_knowledge_folder_is_refused_and_nothing_is_written_through_it() {
        let sandbox = Sandbox::new();
        let outside = tempfile::tempdir().unwrap();
        let run = sandbox.run("2026-10-21_090000");
        std::os::unix::fs::symlink(outside.path(), run.join(MEMORY_BUNDLE_DIR)).unwrap();
        let refused = promote(
            &sandbox.registry,
            &sandbox.runs,
            "2026-10-21_090000",
            "Desk",
            &[],
        )
        .unwrap_err();
        assert!(refused.contains("symbolic link"), "{refused}");
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 0);
        assert!(list(&sandbox.registry).managers.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn instructions_behind_a_symlink_are_never_read() {
        let sandbox = Sandbox::new();
        let record = sandbox.promote("2026-10-21_090000", "Desk").unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("secret.txt");
        std::fs::write(&secret, "TOPSECRET").unwrap();
        let file = sandbox
            .run("2026-10-21_090000")
            .join(INSTRUCTIONS_FILE_NAME);
        std::fs::remove_file(&file).unwrap();
        std::os::unix::fs::symlink(&secret, &file).unwrap();
        let refused = read_instructions(&sandbox.registry, &sandbox.runs, &record.key);
        let message = refused.expect_err("a symlink is not the human's file");
        assert!(message.contains("symbolic link"), "{message}");
        assert!(!message.contains("TOPSECRET"));
    }

    // ---- the fixture ----

    #[test]
    fn the_constants_are_the_fixtures() {
        let f = fixture();
        assert_eq!(f["registryFileName"], REGISTRY_FILE_NAME);
        assert_eq!(f["registryVersion"], REGISTRY_VERSION);
        assert_eq!(f["names"]["maxLength"], MAX_NAME_LENGTH);
        assert_eq!(f["keyFromName"]["maxLength"], MAX_KEY_LENGTH);
        assert_eq!(f["keyFromName"]["fallback"], FALLBACK_KEY);
        assert_eq!(f["instructions"]["fileName"], INSTRUCTIONS_FILE_NAME);
        assert_eq!(f["instructions"]["maxBytes"], MAX_INSTRUCTIONS_BYTES);
        assert_eq!(f["memory"]["bundleDir"], MEMORY_BUNDLE_DIR);
        assert_eq!(
            f["memory"]["rootIndex"]["frontMatter"]["okf_version"],
            "0.2"
        );
        assert!(MEMORY_ROOT_INDEX.contains("okf_version: \"0.2\""));
    }

    #[test]
    fn names_follow_the_fixture() {
        let names = &fixture()["names"];
        for valid in strings(&names["valid"]) {
            let accepted = validate_name(&valid).unwrap_or_else(|e| panic!("{valid:?}: {e}"));
            assert_eq!(accepted, valid.trim());
        }
        for invalid in strings(&names["invalid"]) {
            assert_eq!(validate_name(&invalid), Err(name_invalid()), "{invalid:?}");
        }
    }

    #[test]
    fn keys_from_names_follow_the_fixture() {
        for case in fixture()["keyFromName"]["cases"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let taken = strings(&case["taken"]);
            assert_eq!(
                key_from_name(name, &taken),
                case["key"].as_str().unwrap(),
                "{name:?} with {taken:?}"
            );
        }
    }

    #[test]
    fn a_long_name_stays_within_the_key_length_when_a_suffix_is_added() {
        let name = "a".repeat(40);
        let first = key_from_name(&name, &[]);
        let second = key_from_name(&name, std::slice::from_ref(&first));
        assert_eq!(second, format!("{first}-2"));
        let long = "b".repeat(48);
        let key = key_from_name(&long, std::slice::from_ref(&long));
        assert_eq!(key.len(), MAX_KEY_LENGTH);
        assert!(key.ends_with("-2") && is_valid_key(&key));
    }

    #[test]
    fn promotion_keys_follow_the_fixture() {
        for case in fixture()["promotionKey"]["cases"].as_array().unwrap() {
            let sandbox = Sandbox::new();
            let run = sandbox.run("2026-10-21_090000");
            if let Some(file_key) = case["fileKey"].as_str() {
                super::super::several::write_run_key(&run, Some(file_key)).unwrap();
            }
            let elsewhere = sandbox.run("2026-10-20_080000");
            let others = case.get("otherLiveKeys").map(strings).unwrap_or_default();
            let live: Vec<AgentInfo> = case["liveKey"]
                .as_str()
                .map(|key| live_supervisor(Some(key), &run))
                .into_iter()
                .chain(others.iter().enumerate().map(|(n, key)| AgentInfo {
                    id: format!("agent-{}", 10 + n),
                    ..live_supervisor(Some(key), &elsewhere)
                }))
                .collect();
            let record = promote(
                &sandbox.registry,
                &sandbox.runs,
                "2026-10-21_090000",
                case["name"].as_str().unwrap(),
                &live,
            )
            .unwrap();
            assert_eq!(record.key, case["key"].as_str().unwrap(), "{case}");
        }
    }

    // ---- creating ----

    struct Home {
        _dir: tempfile::TempDir,
        home: PathBuf,
        registry: PathBuf,
    }

    impl Home {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            Self {
                home: dir.path().join("home"),
                registry: dir.path().join(REGISTRY_FILE_NAME),
                _dir: dir,
            }
        }

        fn runs(&self) -> Vec<String> {
            std::fs::read_dir(supervisor_runs_root(&self.home))
                .map(|entries| {
                    entries
                        .flatten()
                        .map(|entry| entry.file_name().to_string_lossy().into_owned())
                        .collect()
                })
                .unwrap_or_default()
        }
    }

    #[test]
    fn creating_makes_a_fresh_run_folder_and_promotes_it() {
        let setup = Home::new();
        let record = create(&setup.registry, &setup.home, " Release Desk ", &[]).unwrap();

        assert_eq!(record.name, "Release Desk");
        assert_eq!(record.key, "release-desk");
        assert_eq!(setup.runs(), vec![record.run_dir.clone()]);
        let run = supervisor_runs_root(&setup.home).join(&record.run_dir);
        assert!(run.join(INSTRUCTIONS_FILE_NAME).is_file());
        assert!(run.join("knowledge/index.md").is_file());
        assert_eq!(list(&setup.registry).managers, vec![record]);
    }

    #[test]
    fn a_refused_name_leaves_no_folder_and_no_entry() {
        let setup = Home::new();
        create(&setup.registry, &setup.home, "Release Desk", &[]).unwrap();
        let before = setup.runs();

        let taken = create(&setup.registry, &setup.home, "release desk", &[]).unwrap_err();
        let invalid = create(&setup.registry, &setup.home, "  ", &[]).unwrap_err();

        assert_eq!(taken, name_taken("release desk"));
        assert_eq!(invalid, name_invalid());
        assert_eq!(setup.runs(), before);
        assert_eq!(list(&setup.registry).managers.len(), 1);
    }

    #[test]
    fn a_folder_that_cannot_be_created_says_so_in_the_fixture_sentence() {
        let setup = Home::new();
        std::fs::create_dir_all(&setup.home).unwrap();
        std::fs::write(setup.home.join(".auric"), "in the way").unwrap();

        let error = create(&setup.registry, &setup.home, "Release Desk", &[]).unwrap_err();

        let fixture = fixture();
        let pattern = fixture["refusals"]["manager_create_failed"]
            .as_str()
            .unwrap();
        assert!(
            regex::Regex::new(pattern).unwrap().is_match(&error),
            "{error}"
        );
        assert!(error.contains("Release Desk"));
        assert!(!setup.registry.exists());
    }

    #[test]
    fn a_refused_name_never_touches_the_cli_trust_file() {
        let setup = Home::new();
        create(&setup.registry, &setup.home, "Release Desk", &[]).unwrap();
        let trust = setup.home.join(".claude.json");
        let before = std::fs::read_to_string(&trust).unwrap();

        create(&setup.registry, &setup.home, "RELEASE DESK", &[]).unwrap_err();
        create(&setup.registry, &setup.home, "", &[]).unwrap_err();

        assert_eq!(std::fs::read_to_string(&trust).unwrap(), before);
    }

    // ---- a missing folder ----

    #[test]
    fn a_manager_folder_that_is_a_link_to_a_sibling_counts_as_missing_everywhere() {
        let sandbox = Sandbox::new();
        sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        sandbox.run("2026-10-22_090000");
        std::fs::remove_dir_all(sandbox.runs.join("2026-10-21_090000")).unwrap();
        std::os::unix::fs::symlink(
            sandbox.runs.join("2026-10-22_090000"),
            sandbox.runs.join("2026-10-21_090000"),
        )
        .unwrap();

        let listing = list_with_run_state(&sandbox.registry, &sandbox.runs);
        assert!(listing.managers[0].run_missing);
        let error =
            read_instructions(&sandbox.registry, &sandbox.runs, "release-desk").unwrap_err();
        assert_eq!(error, run_missing("2026-10-21_090000"));
    }

    #[test]
    fn a_manager_whose_folder_is_gone_stays_listed_as_missing() {
        let sandbox = Sandbox::new();
        sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        sandbox.promote("2026-10-22_090000", "Other Desk").unwrap();
        std::fs::remove_dir_all(sandbox.runs.join("2026-10-21_090000")).unwrap();

        let listing = list_with_run_state(&sandbox.registry, &sandbox.runs);

        let missing: Vec<(&str, bool)> = listing
            .managers
            .iter()
            .map(|m| (m.record.name.as_str(), m.run_missing))
            .collect();
        assert_eq!(missing, vec![("Release Desk", true), ("Other Desk", false)]);
        assert_eq!(listing.error, None);
    }

    #[test]
    fn the_listing_carries_run_missing_next_to_the_record_fields() {
        let sandbox = Sandbox::new();
        sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        let listing = list_with_run_state(&sandbox.registry, &sandbox.runs);
        let wire = serde_json::to_value(&listing).unwrap();
        assert_eq!(wire["managers"][0]["key"], "release-desk");
        assert_eq!(wire["managers"][0]["runDir"], "2026-10-21_090000");
        assert_eq!(wire["managers"][0]["runMissing"], false);
    }

    #[test]
    fn every_refusal_matches_its_fixture_pattern() {
        let patterns = &fixture()["refusals"];
        let sentences = [
            ("manager_name_invalid", name_invalid()),
            ("manager_name_taken", name_taken("Release Desk")),
            ("manager_run_missing", run_missing("2026-10-21_090000")),
            (
                "manager_run_taken",
                run_taken("2026-10-21_090000", "Release Desk"),
            ),
            ("manager_not_found", not_found("release-desk")),
            ("manager_not_archived", not_archived("Release Desk")),
            (
                "instructions_too_large",
                instructions_too_large("Release Desk", 20000),
            ),
            (
                "registry_unreadable",
                registry_unreadable("it is not valid JSON (eof)."),
            ),
            (
                "manager_create_failed",
                create_failed("Release Desk", "permission denied."),
            ),
        ];
        for (code, sentence) in sentences {
            let pattern = regex::Regex::new(patterns[code].as_str().unwrap()).unwrap();
            assert!(pattern.is_match(&sentence), "{code}: {sentence}");
        }
    }

    // ---- promotion ----

    #[test]
    fn promoting_records_the_manager_and_prepares_its_folder() {
        let sandbox = Sandbox::new();
        let record = sandbox
            .promote("2026-10-21_090000", "  Release Desk ")
            .unwrap();

        assert_eq!(record.key, "release-desk");
        assert_eq!(record.name, "Release Desk");
        assert_eq!(record.run_dir, "2026-10-21_090000");
        assert_eq!(record.archived_at, None);
        assert!(record.promoted_at.ends_with('Z'));
        assert_eq!(list(&sandbox.registry).managers, vec![record]);

        let run = sandbox.runs.join("2026-10-21_090000");
        let instructions = std::fs::read_to_string(run.join(INSTRUCTIONS_FILE_NAME)).unwrap();
        assert!(instructions.starts_with("# Instructions for Release Desk"));
        let index = std::fs::read_to_string(run.join("knowledge/index.md")).unwrap();
        assert!(index.contains("okf_version"));
    }

    #[test]
    fn promoting_never_overwrites_what_the_run_already_holds() {
        let sandbox = Sandbox::new();
        let run = sandbox.run("2026-10-21_090000");
        std::fs::write(run.join(INSTRUCTIONS_FILE_NAME), "mine").unwrap();
        std::fs::create_dir_all(run.join("knowledge")).unwrap();
        std::fs::write(run.join("knowledge/index.md"), "existing").unwrap();
        std::fs::write(run.join("notes.md"), "kept").unwrap();

        promote(
            &sandbox.registry,
            &sandbox.runs,
            "2026-10-21_090000",
            "Desk",
            &[],
        )
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(run.join(INSTRUCTIONS_FILE_NAME)).unwrap(),
            "mine"
        );
        assert_eq!(
            std::fs::read_to_string(run.join("knowledge/index.md")).unwrap(),
            "existing"
        );
        assert_eq!(
            std::fs::read_to_string(run.join("notes.md")).unwrap(),
            "kept"
        );
    }

    #[test]
    fn a_missing_run_folder_is_refused_and_nothing_is_written() {
        let sandbox = Sandbox::new();
        let error = promote(&sandbox.registry, &sandbox.runs, "gone", "Desk", &[]).unwrap_err();
        assert_eq!(error, run_missing("gone"));
        assert!(!sandbox.registry.exists());
    }

    #[test]
    fn only_a_direct_run_folder_can_be_promoted() {
        let sandbox = Sandbox::new();
        sandbox.run("2026-10-21_090000/frames");
        let elsewhere = tempfile::tempdir().unwrap();
        for bad in [
            "2026-10-21_090000/frames".to_string(),
            "..".to_string(),
            elsewhere.path().to_string_lossy().into_owned(),
        ] {
            let result = promote(&sandbox.registry, &sandbox.runs, &bad, "Desk", &[]);
            assert!(result.is_err(), "{bad} must be refused");
        }
        assert!(!sandbox.registry.exists());
    }

    #[test]
    fn a_run_belongs_to_one_manager_only() {
        let sandbox = Sandbox::new();
        sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        let error = sandbox.promote("2026-10-21_090000", "Other").unwrap_err();
        assert_eq!(error, run_taken("2026-10-21_090000", "Release Desk"));
    }

    #[test]
    fn a_name_is_unique_ignoring_case_among_managers_that_are_not_archived() {
        let sandbox = Sandbox::new();
        let first = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        assert_eq!(
            sandbox
                .promote("2026-10-22_090000", "RELEASE desk")
                .unwrap_err(),
            name_taken("RELEASE desk")
        );
        archive(&sandbox.registry, &first.key).unwrap();
        let second = sandbox
            .promote("2026-10-22_090000", "Release Desk")
            .unwrap();
        assert_eq!(
            second.key, "release-desk-2",
            "the archived key stays reserved"
        );
    }

    #[test]
    fn an_invalid_name_is_refused() {
        let sandbox = Sandbox::new();
        assert_eq!(
            sandbox.promote("2026-10-21_090000", " ").unwrap_err(),
            name_invalid()
        );
    }

    #[test]
    fn the_runs_own_address_is_kept_unless_a_manager_already_holds_it() {
        let sandbox = Sandbox::new();
        let run = sandbox.run("2026-10-21_090000");
        let live = [live_supervisor(Some("mail-triage"), &run)];
        let record = promote(
            &sandbox.registry,
            &sandbox.runs,
            "2026-10-21_090000",
            "Inbox",
            &live,
        )
        .unwrap();
        assert_eq!(record.key, "mail-triage");

        let other = sandbox.run("2026-10-22_090000");
        let live = [live_supervisor(Some("mail-triage"), &other)];
        let record = promote(
            &sandbox.registry,
            &sandbox.runs,
            "2026-10-22_090000",
            "Inbox 2",
            &live,
        )
        .unwrap();
        assert_eq!(record.key, "inbox-2", "the key is taken, so one is derived");
    }

    #[test]
    fn a_live_supervisors_key_in_another_folder_is_not_handed_out() {
        let sandbox = Sandbox::new();
        let run = sandbox.run("2026-10-21_090000");
        let elsewhere = sandbox.run("2026-10-22_090000");
        let live = [live_supervisor(Some("inbox"), &elsewhere)];
        let record = promote(
            &sandbox.registry,
            &sandbox.runs,
            "2026-10-21_090000",
            "Inbox",
            &live,
        )
        .unwrap();
        assert!(run.exists());
        assert_eq!(record.key, "inbox-2");
    }

    // ---- lifecycle ----

    #[test]
    fn rename_changes_the_name_and_never_the_key() {
        let sandbox = Sandbox::new();
        let record = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        let renamed = rename(&sandbox.registry, &record.key, " Ship Room ").unwrap();
        assert_eq!(
            (renamed.key.as_str(), renamed.name.as_str()),
            ("release-desk", "Ship Room")
        );
        assert_eq!(list(&sandbox.registry).managers, vec![renamed]);
    }

    #[test]
    fn rename_to_its_own_name_in_other_case_is_fine_but_a_neighbours_is_not() {
        let sandbox = Sandbox::new();
        let first = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        sandbox.promote("2026-10-22_090000", "Inbox").unwrap();
        assert!(rename(&sandbox.registry, &first.key, "release DESK").is_ok());
        assert_eq!(
            rename(&sandbox.registry, &first.key, "inbox").unwrap_err(),
            name_taken("inbox")
        );
        assert_eq!(
            rename(&sandbox.registry, &first.key, "").unwrap_err(),
            name_invalid()
        );
        assert_eq!(
            rename(&sandbox.registry, "nobody", "X").unwrap_err(),
            not_found("nobody")
        );
    }

    #[test]
    fn archive_and_restore_round_trip() {
        let sandbox = Sandbox::new();
        let record = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        let archived = archive(&sandbox.registry, &record.key).unwrap();
        assert!(archived.archived_at.is_some());
        let again = archive(&sandbox.registry, &record.key).unwrap();
        assert_eq!(
            again.archived_at, archived.archived_at,
            "archiving twice keeps the first time"
        );
        assert_eq!(
            restore(&sandbox.registry, &record.key).unwrap().archived_at,
            None
        );
        assert_eq!(
            archive(&sandbox.registry, "nobody").unwrap_err(),
            not_found("nobody")
        );
        assert_eq!(
            restore(&sandbox.registry, "nobody").unwrap_err(),
            not_found("nobody")
        );
    }

    #[test]
    fn restore_refuses_when_the_name_was_taken_meanwhile() {
        let sandbox = Sandbox::new();
        let first = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        archive(&sandbox.registry, &first.key).unwrap();
        sandbox
            .promote("2026-10-22_090000", "Release Desk")
            .unwrap();
        assert_eq!(
            restore(&sandbox.registry, &first.key).unwrap_err(),
            name_taken("Release Desk")
        );
        assert!(list(&sandbox.registry).managers[0].archived_at.is_some());
    }

    #[test]
    fn remove_forgets_only_an_archived_manager_and_deletes_nothing_on_disk() {
        let sandbox = Sandbox::new();
        let record = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        assert_eq!(
            remove(&sandbox.registry, &record.key).unwrap_err(),
            not_archived("Release Desk")
        );
        archive(&sandbox.registry, &record.key).unwrap();
        remove(&sandbox.registry, &record.key).unwrap();
        assert!(list(&sandbox.registry).managers.is_empty());
        assert!(sandbox
            .runs
            .join("2026-10-21_090000")
            .join(INSTRUCTIONS_FILE_NAME)
            .is_file());
        assert_eq!(
            remove(&sandbox.registry, &record.key).unwrap_err(),
            not_found(&record.key)
        );
    }

    #[test]
    fn a_removed_run_can_be_promoted_again() {
        let sandbox = Sandbox::new();
        let record = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        archive(&sandbox.registry, &record.key).unwrap();
        remove(&sandbox.registry, &record.key).unwrap();
        assert!(sandbox.promote("2026-10-21_090000", "Release Desk").is_ok());
    }

    // ---- the file ----

    #[test]
    fn the_registry_is_written_at_0600_with_its_version_and_leaves_no_temp_file() {
        let sandbox = Sandbox::new();
        sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        let written: Value = serde_json::from_slice(&sandbox.registry_bytes()).unwrap();
        assert_eq!(written["version"], REGISTRY_VERSION);
        assert_eq!(written["managers"][0]["runDir"], "2026-10-21_090000");
        assert_eq!(written["managers"][0]["archivedAt"], Value::Null);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&sandbox.registry)
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let leftovers: Vec<_> = std::fs::read_dir(sandbox.registry.parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn a_missing_registry_lists_nothing_without_an_error() {
        let sandbox = Sandbox::new();
        let listed = list(&sandbox.registry);
        assert!(listed.managers.is_empty() && listed.error.is_none());
    }

    #[test]
    fn an_unreadable_registry_is_reported_and_never_overwritten() {
        let broken: [&[u8]; 4] = [
            b"{ not json",
            br#"{"version": 2, "managers": []}"#,
            br#"{"managers": []}"#,
            br#"{"version": 1, "managers": [{"key": "x"}]}"#,
        ];
        for bytes in broken {
            let sandbox = Sandbox::new();
            std::fs::write(&sandbox.registry, bytes).unwrap();
            let pattern = regex::Regex::new(
                fixture()["refusals"]["registry_unreadable"]
                    .as_str()
                    .unwrap(),
            )
            .unwrap();

            let listed = list(&sandbox.registry);
            assert!(listed.managers.is_empty());
            assert!(pattern.is_match(&listed.error.unwrap()));

            let results = [
                sandbox.promote("2026-10-21_090000", "Desk").map(|_| ()),
                rename(&sandbox.registry, "x", "Y").map(|_| ()),
                archive(&sandbox.registry, "x").map(|_| ()),
                restore(&sandbox.registry, "x").map(|_| ()),
                remove(&sandbox.registry, "x"),
            ];
            for result in results {
                assert!(pattern.is_match(&result.unwrap_err()));
            }
            assert_eq!(sandbox.registry_bytes(), bytes);
            assert!(
                !sandbox
                    .runs
                    .join("2026-10-21_090000")
                    .join(INSTRUCTIONS_FILE_NAME)
                    .exists(),
                "a refused promotion must not touch the run folder"
            );
        }
    }

    #[test]
    fn two_promotions_at_once_both_survive() {
        let sandbox = Sandbox::new();
        let runs: Vec<String> = (0..8).map(|n| format!("2026-10-21_09000{n}")).collect();
        runs.iter().for_each(|run| {
            sandbox.run(run);
        });
        std::thread::scope(|scope| {
            for (n, run) in runs.iter().enumerate() {
                let sandbox = &sandbox;
                scope.spawn(move || {
                    promote(
                        &sandbox.registry,
                        &sandbox.runs,
                        run,
                        &format!("Desk {n}"),
                        &[],
                    )
                    .unwrap();
                });
            }
        });
        assert_eq!(list(&sandbox.registry).managers.len(), 8);
    }

    // ---- instructions ----

    #[test]
    fn instructions_are_read_from_the_managers_folder() {
        let sandbox = Sandbox::new();
        let record = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        let run = sandbox.runs.join("2026-10-21_090000");
        std::fs::write(run.join(INSTRUCTIONS_FILE_NAME), "Write in Spanish.").unwrap();
        assert_eq!(
            read_instructions(&sandbox.registry, &sandbox.runs, &record.key).unwrap(),
            Some("Write in Spanish.".to_string())
        );
    }

    #[test]
    fn missing_instructions_are_none_and_an_unknown_key_is_refused() {
        let sandbox = Sandbox::new();
        let record = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        std::fs::remove_file(
            sandbox
                .runs
                .join("2026-10-21_090000")
                .join(INSTRUCTIONS_FILE_NAME),
        )
        .unwrap();
        assert_eq!(
            read_instructions(&sandbox.registry, &sandbox.runs, &record.key),
            Ok(None)
        );
        assert_eq!(
            read_instructions(&sandbox.registry, &sandbox.runs, "nobody"),
            Err(not_found("nobody"))
        );
    }

    #[test]
    fn instructions_over_the_limit_are_refused_not_cut() {
        let sandbox = Sandbox::new();
        let record = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        let file = sandbox
            .runs
            .join("2026-10-21_090000")
            .join(INSTRUCTIONS_FILE_NAME);
        std::fs::write(&file, "x".repeat(MAX_INSTRUCTIONS_BYTES as usize)).unwrap();
        assert!(read_instructions(&sandbox.registry, &sandbox.runs, &record.key).is_ok());
        std::fs::write(&file, "x".repeat(MAX_INSTRUCTIONS_BYTES as usize + 1)).unwrap();
        assert_eq!(
            read_instructions(&sandbox.registry, &sandbox.runs, &record.key),
            Err(instructions_too_large(
                "Release Desk",
                MAX_INSTRUCTIONS_BYTES + 1
            ))
        );
    }

    // ---- the runs list ----

    #[test]
    fn runs_carry_the_manager_they_belong_to() {
        let sandbox = Sandbox::new();
        sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        sandbox.run("2026-10-22_090000");
        let record = list(&sandbox.registry).managers.remove(0);

        let mut runs = super::super::runs::list_runs(&sandbox.runs);
        attach_managers(&mut runs, &[record]);
        let by_name = |name: &str| runs.iter().find(|r| r.name == name).unwrap();

        assert_eq!(
            by_name("2026-10-21_090000").manager,
            Some(RunManager {
                key: "release-desk".into(),
                name: "Release Desk".into(),
                archived_at: None
            })
        );
        assert_eq!(by_name("2026-10-22_090000").manager, None);
    }

    #[test]
    fn an_archived_managers_run_says_so() {
        let sandbox = Sandbox::new();
        let record = sandbox
            .promote("2026-10-21_090000", "Release Desk")
            .unwrap();
        let archived = archive(&sandbox.registry, &record.key).unwrap();
        let mut runs = super::super::runs::list_runs(&sandbox.runs);
        attach_managers(&mut runs, &[archived.clone()]);
        assert_eq!(
            runs[0].manager.as_ref().unwrap().archived_at,
            archived.archived_at
        );
    }
}
