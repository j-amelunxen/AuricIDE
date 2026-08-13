use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use walkdir::WalkDir;

/// Additive fields do NOT bump this — `#[serde(default)]` already makes old
/// files readable and new files are ignored field-wise by older builds. Bump it
/// only for the first breaking change (a rename, a retype, a semantic shift),
/// at which point the readers grow a `match` on it. Note it is shared with the
/// recent-projects store, so a bump stamps both files.
const STORE_VERSION: u32 = 1;
const MAX_RECENT_PROJECTS: usize = 50;
/// Kept separate from MAX_RECENT_PROJECTS even though both are 50: a dropped
/// starred record now costs the user an icon and a list of launch presets.
const MAX_STARRED_PROJECTS: usize = 50;
const MAX_SKILLS_PER_PROJECT: usize = 20;
const MAX_COMBOS_PER_PROJECT: usize = 20;
const MAX_STEPS_PER_COMBO: usize = 8;
const WHEEL_SLOT_COUNT: usize = 6;
const LEGACY_KEY: &str = "auric-recent-projects";
const LEGACY_STARRED_KEY: &str = "auric-starred-projects";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub opened_at: u64,
}

/// A user-chosen tile mark. The backend is storage, not policy: it never renders
/// an icon, so `kind` stays an opaque string instead of a serde enum. An enum
/// would make an unknown kind written by a newer build fail to deserialize — and
/// here a single field error fails the WHOLE file, which quarantines it and
/// costs the user every star. Forward compatibility beats Rust-side
/// exhaustiveness. The frontend narrows this and falls back to generated
/// initials for anything it does not recognise.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconOverride {
    pub kind: String,
    pub value: String,
}

/// A named launch preset for one project: a recurring task in two clicks.
/// `permission_mode` is a String rather than an enum because the legal values
/// come from the provider registry, and dynamic providers are importable at
/// runtime — there is no closed set to encode.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickAccessSkill {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headless: Option<bool>,
}

/// An ordered chain of launch presets. Ending one step starts the next.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickAccessCombo {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub steps: Vec<QuickAccessSkill>,
}

/// The per-project Quick Access settings, as one blob. They live INSIDE the
/// starred record on purpose: unstarring a project drops its settings with it,
/// which is the behaviour without any cleanup logic to get wrong.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StarredProjectSettings {
    #[serde(default)]
    pub icon: Option<ProjectIconOverride>,
    #[serde(default)]
    pub skills: Vec<QuickAccessSkill>,
    #[serde(default)]
    pub combos: Vec<QuickAccessCombo>,
    /// Missing means "keep the record's wheel, then drop ids that left skills".
    #[serde(default)]
    pub wheel_slots: Option<Vec<Option<String>>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StarredProject {
    pub path: String,
    pub name: String,
    pub starred_at: u64,
    /// Absent = fall back to the generated initials tile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<ProjectIconOverride>,
    /// Ordered — this IS the order the launch presets are offered in.
    ///
    /// `#[serde(default)]` is load-bearing, not decoration: a missing `Vec`
    /// is a hard deserialize error (unlike a missing `Option`), that error
    /// fails the whole file, and a failed file gets quarantined and rebuilt
    /// from legacy scraping. Without this attribute, every existing user
    /// loses every star on upgrade.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<QuickAccessSkill>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub combos: Vec<QuickAccessCombo>,
    /// Skill ids on the radial wheel, by slot. Null is an empty plus-slot.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub wheel_slots: Vec<Option<String>>,
}

impl StarredProject {
    /// A later duplicate of the same path contributes only what the winner is
    /// MISSING. Identity stays with the record that won; per-project settings
    /// are never dropped just because two copies of one path met in a merge.
    ///
    /// This matters on the recovery path: after a quarantine the backend
    /// rebuilds bare records from legacy scraping, and the frontend then sends
    /// its localStorage copy — which still carries the icon and the skills.
    /// First-wins would throw away the very thing being recovered.
    fn absorb(&mut self, other: StarredProject) {
        if self.icon.is_none() {
            self.icon = other.icon;
        }
        // Whole-list fill, never an element-wise union: a union would
        // resurrect skills the user deliberately deleted.
        if self.skills.is_empty() {
            self.skills = other.skills;
        }
        if self.combos.is_empty() {
            self.combos = other.combos;
        }
        if self.wheel_slots.is_empty() {
            self.wheel_slots = other.wheel_slots;
        }
        if self.name.trim().is_empty() {
            self.name = other.name;
        }
        // "Pinned since" is the earliest claim, and it drives the sort.
        self.starred_at = self.starred_at.min(other.starred_at);
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct RecentProjectsFile {
    version: u32,
    projects: Vec<RecentProject>,
}

pub struct RecentProjectsState {
    store_path: PathBuf,
    projects: Mutex<Vec<RecentProject>>,
}

pub struct StarredProjectsState {
    store_path: PathBuf,
    projects: Mutex<Vec<StarredProject>>,
}

impl RecentProjectsState {
    pub fn initialize(store_path: PathBuf) -> Self {
        let projects = match read_store(&store_path) {
            Ok(Some(projects)) => projects,
            Ok(None) => {
                let imported = import_legacy_webkit_profiles();
                if let Err(error) = write_store_atomic(&store_path, &imported) {
                    eprintln!("Failed to initialize recent projects store: {error}");
                }
                imported
            }
            Err(error) => {
                preserve_corrupt_store(&store_path);
                eprintln!("Recent projects store was invalid and was preserved: {error}");
                let imported = import_legacy_webkit_profiles();
                if let Err(write_error) = write_store_atomic(&store_path, &imported) {
                    eprintln!("Failed to recover recent projects store: {write_error}");
                }
                imported
            }
        };
        Self {
            store_path,
            projects: Mutex::new(projects),
        }
    }

    fn update<F>(&self, operation: F) -> Result<Vec<RecentProject>, String>
    where
        F: FnOnce(&mut Vec<RecentProject>),
    {
        let mut projects = self
            .projects
            .lock()
            .map_err(|_| "Recent projects lock poisoned".to_string())?;
        operation(&mut projects);
        *projects = merge_projects(std::mem::take(&mut *projects));
        write_store_atomic(&self.store_path, &projects)?;
        Ok(projects.clone())
    }
}

impl StarredProjectsState {
    pub fn initialize(store_path: PathBuf) -> Self {
        let projects = match read_starred_store(&store_path) {
            Ok(Some(projects)) => projects,
            Ok(None) => {
                let imported = import_legacy_starred_profiles();
                if let Err(error) = write_starred_store_atomic(&store_path, &imported) {
                    eprintln!("Failed to initialize starred projects store: {error}");
                }
                imported
            }
            Err(error) => {
                preserve_corrupt_store_as(&store_path, "starred-projects");
                eprintln!("Starred projects store was invalid and was preserved: {error}");
                let imported = import_legacy_starred_profiles();
                if let Err(write_error) = write_starred_store_atomic(&store_path, &imported) {
                    eprintln!("Failed to recover starred projects store: {write_error}");
                }
                imported
            }
        };
        Self {
            store_path,
            projects: Mutex::new(projects),
        }
    }

    fn update<F>(&self, operation: F) -> Result<Vec<StarredProject>, String>
    where
        F: FnOnce(&mut Vec<StarredProject>),
    {
        let mut projects = self
            .projects
            .lock()
            .map_err(|_| "Starred projects lock poisoned".to_string())?;
        operation(&mut projects);
        *projects = merge_starred_projects(std::mem::take(&mut *projects));
        write_starred_store_atomic(&self.store_path, &projects)?;
        Ok(projects.clone())
    }
}

#[tauri::command]
pub fn recent_projects_list(
    state: tauri::State<'_, RecentProjectsState>,
) -> Result<Vec<RecentProject>, String> {
    state
        .projects
        .lock()
        .map(|projects| projects.clone())
        .map_err(|_| "Recent projects lock poisoned".to_string())
}

#[tauri::command]
pub fn recent_projects_import(
    legacy_projects: Vec<RecentProject>,
    state: tauri::State<'_, RecentProjectsState>,
) -> Result<Vec<RecentProject>, String> {
    state.update(|projects| projects.extend(legacy_projects))
}

#[tauri::command]
pub fn recent_projects_add(
    path: String,
    state: tauri::State<'_, RecentProjectsState>,
) -> Result<Vec<RecentProject>, String> {
    if path.trim().is_empty() {
        return Err("Project path must not be empty".to_string());
    }
    let name = Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&path)
        .to_string();
    let opened_at = chrono::Utc::now().timestamp_millis().max(0) as u64;
    state.update(|projects| {
        projects.push(RecentProject {
            path,
            name,
            opened_at,
        })
    })
}

#[tauri::command]
pub fn recent_projects_remove(
    path: String,
    state: tauri::State<'_, RecentProjectsState>,
) -> Result<Vec<RecentProject>, String> {
    state.update(|projects| projects.retain(|project| project.path != path))
}

#[tauri::command]
pub fn starred_projects_list(
    state: tauri::State<'_, StarredProjectsState>,
) -> Result<Vec<StarredProject>, String> {
    state
        .projects
        .lock()
        .map(|projects| projects.clone())
        .map_err(|_| "Starred projects lock poisoned".to_string())
}

#[tauri::command]
pub fn starred_projects_import(
    legacy_projects: Vec<StarredProject>,
    state: tauri::State<'_, StarredProjectsState>,
) -> Result<Vec<StarredProject>, String> {
    state.update(|projects| projects.extend(legacy_projects))
}

#[tauri::command]
pub fn starred_projects_add(
    path: String,
    state: tauri::State<'_, StarredProjectsState>,
) -> Result<Vec<StarredProject>, String> {
    if path.trim().is_empty() {
        return Err("Project path must not be empty".to_string());
    }
    let starred_at = chrono::Utc::now().timestamp_millis().max(0) as u64;
    state.update(|projects| push_starred_project(projects, path, starred_at))
}

#[tauri::command]
pub fn starred_projects_remove(
    path: String,
    state: tauri::State<'_, StarredProjectsState>,
) -> Result<Vec<StarredProject>, String> {
    state.update(|projects| projects.retain(|project| project.path != path))
}

/// One coarse command that replaces the whole settings blob. The store rewrites
/// the entire file on every mutation anyway, so fine-grained set-icon /
/// add-skill / reorder commands would buy zero I/O while quadrupling the IPC
/// surface. Convenience belongs in the store slice, not on the wire.
#[tauri::command]
pub fn starred_projects_update_settings(
    path: String,
    settings: StarredProjectSettings,
    state: tauri::State<'_, StarredProjectsState>,
) -> Result<Vec<StarredProject>, String> {
    if path.trim().is_empty() {
        return Err("Project path must not be empty".to_string());
    }
    // `update` cannot return a value through the closure, so the not-found
    // signal rides out on a captured flag rather than reshaping the state
    // helper that the recent-projects side also depends on. The file is
    // rewritten either way, which is harmless: nothing changed.
    let mut found = false;
    let projects = state.update(|projects| {
        found = apply_starred_settings(projects, &path, settings);
    })?;
    if !found {
        return Err(format!("Project is not starred: {path}"));
    }
    Ok(projects)
}

fn merge_projects(projects: Vec<RecentProject>) -> Vec<RecentProject> {
    let mut by_path: HashMap<String, RecentProject> = HashMap::new();
    for project in projects
        .into_iter()
        .filter(|project| !project.path.trim().is_empty())
    {
        match by_path.get(&project.path) {
            Some(existing) if existing.opened_at > project.opened_at => {}
            _ => {
                by_path.insert(project.path.clone(), project);
            }
        }
    }
    let mut merged: Vec<_> = by_path.into_values().collect();
    merged.sort_by(|a, b| {
        b.opened_at
            .cmp(&a.opened_at)
            .then_with(|| a.path.cmp(&b.path))
    });
    merged.truncate(MAX_RECENT_PROJECTS);
    merged
}

fn merge_starred_projects(projects: Vec<StarredProject>) -> Vec<StarredProject> {
    use std::collections::hash_map::Entry;
    let mut by_path: HashMap<String, StarredProject> = HashMap::new();
    for project in projects
        .into_iter()
        .filter(|project| !project.path.trim().is_empty())
    {
        match by_path.entry(project.path.clone()) {
            Entry::Vacant(slot) => {
                slot.insert(project);
            }
            Entry::Occupied(mut slot) => slot.get_mut().absorb(project),
        }
    }
    let mut merged: Vec<_> = by_path.into_values().collect();
    merged.sort_by(|a, b| {
        a.starred_at
            .cmp(&b.starred_at)
            .then_with(|| a.path.cmp(&b.path))
    });
    merged.truncate(MAX_STARRED_PROJECTS);
    merged
}

/// Trims, drops blanks, dedupes ids (first wins) and caps the list. The store
/// file is rewritten in full on every star toggle, so an unbounded blob from
/// the frontend is a size problem for every future write, not just this one.
fn normalize_skills(skills: Vec<QuickAccessSkill>) -> Vec<QuickAccessSkill> {
    let mut seen = std::collections::HashSet::new();
    skills
        .into_iter()
        .map(|mut skill| {
            skill.id = skill.id.trim().to_string();
            skill.label = skill.label.trim().to_string();
            skill
        })
        .filter(|skill| !skill.id.is_empty() && !skill.label.is_empty())
        .filter(|skill| seen.insert(skill.id.clone()))
        .take(MAX_SKILLS_PER_PROJECT)
        .collect()
}

fn known_wheel_ids(project: &StarredProject) -> std::collections::HashSet<String> {
    let mut ids: std::collections::HashSet<String> = project
        .skills
        .iter()
        .map(|skill| skill.id.clone())
        .collect();
    for combo in &project.combos {
        ids.insert(format!("combo:{}", combo.id));
        for step in &combo.steps {
            ids.insert(step.id.clone());
        }
    }
    ids
}

fn normalize_wheel_slots(
    slots: Vec<Option<String>>,
    skill_ids: &std::collections::HashSet<String>,
) -> Vec<Option<String>> {
    let mut seen = std::collections::HashSet::new();
    let mut out = vec![None; WHEEL_SLOT_COUNT];
    for (index, slot) in slots.into_iter().take(WHEEL_SLOT_COUNT).enumerate() {
        let Some(id) = slot else { continue };
        let id = id.trim().to_string();
        if id.is_empty() || !skill_ids.contains(&id) || !seen.insert(id.clone()) {
            continue;
        }
        out[index] = Some(id);
    }
    if out.iter().all(Option::is_none) {
        Vec::new()
    } else {
        out
    }
}

fn normalize_combos(combos: Vec<QuickAccessCombo>) -> Vec<QuickAccessCombo> {
    let mut seen = std::collections::HashSet::new();
    combos
        .into_iter()
        .map(|mut combo| {
            combo.id = combo.id.trim().to_string();
            combo.label = combo.label.trim().to_string();
            combo.steps = normalize_skills(combo.steps)
                .into_iter()
                .take(MAX_STEPS_PER_COMBO)
                .collect();
            combo
        })
        .filter(|combo| !combo.id.is_empty() && !combo.label.is_empty())
        .filter(|combo| seen.insert(combo.id.clone()))
        .take(MAX_COMBOS_PER_PROJECT)
        .collect()
}

/// Replaces one project's settings blob. Returns false when the path is not
/// starred — a settings write for an unstarred path means the UI is out of
/// sync, and silently resurrecting a star would be the worse failure.
fn apply_starred_settings(
    projects: &mut [StarredProject],
    path: &str,
    settings: StarredProjectSettings,
) -> bool {
    let Some(target) = projects.iter_mut().find(|project| project.path == path) else {
        return false;
    };
    target.icon = settings.icon;
    target.skills = normalize_skills(settings.skills);
    target.combos = normalize_combos(settings.combos);
    let known_ids = known_wheel_ids(target);
    let incoming = settings
        .wheel_slots
        .unwrap_or_else(|| target.wheel_slots.clone());
    target.wheel_slots = normalize_wheel_slots(incoming, &known_ids);
    true
}

/// Idempotent by path: re-adding an already starred project is a no-op, so its
/// settings survive. Extracted from the command so it can be tested without a
/// `tauri::State`.
fn push_starred_project(projects: &mut Vec<StarredProject>, path: String, starred_at: u64) {
    if projects.iter().any(|project| project.path == path) {
        return;
    }
    let name = Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&path)
        .to_string();
    projects.push(StarredProject {
        path,
        name,
        starred_at,
        icon: None,
        skills: Vec::new(),
        combos: Vec::new(),
        wheel_slots: Vec::new(),
    });
}

fn read_store(path: &Path) -> Result<Option<Vec<RecentProject>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let file: RecentProjectsFile =
        serde_json::from_str(&contents).map_err(|error| error.to_string())?;
    Ok(Some(merge_projects(file.projects)))
}

fn write_store_atomic(path: &Path, projects: &[RecentProject]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Recent projects store has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::copy(path, path.with_extension("json.bak")).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    let payload = serde_json::to_vec_pretty(&RecentProjectsFile {
        version: STORE_VERSION,
        projects: projects.to_vec(),
    })
    .map_err(|error| error.to_string())?;
    let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
    file.write_all(&payload)
        .and_then(|_| file.sync_all())
        .map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())?;
    Ok(())
}

fn read_starred_store(path: &Path) -> Result<Option<Vec<StarredProject>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let file: StarredProjectsFile =
        serde_json::from_str(&contents).map_err(|error| error.to_string())?;
    Ok(Some(merge_starred_projects(file.projects)))
}

#[derive(Debug, Deserialize, Serialize)]
struct StarredProjectsFile {
    version: u32,
    projects: Vec<StarredProject>,
}

fn write_starred_store_atomic(path: &Path, projects: &[StarredProject]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Starred projects store has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::copy(path, path.with_extension("json.bak")).map_err(|error| error.to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    let payload = serde_json::to_vec_pretty(&StarredProjectsFile {
        version: STORE_VERSION,
        projects: projects.to_vec(),
    })
    .map_err(|error| error.to_string())?;
    let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
    file.write_all(&payload)
        .and_then(|_| file.sync_all())
        .map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())?;
    Ok(())
}

fn preserve_corrupt_store(path: &Path) {
    preserve_corrupt_store_as(path, "recent-projects");
}

fn preserve_corrupt_store_as(path: &Path, name: &str) {
    if path.exists() {
        let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
        let backup = path.with_file_name(format!("{name}.corrupt-{timestamp}.json.bak"));
        let _ = fs::copy(path, backup);
    }
}

fn import_legacy_webkit_profiles() -> Vec<RecentProject> {
    #[cfg(target_os = "macos")]
    {
        let Some(home) = dirs::home_dir() else {
            return Vec::new();
        };
        let roots = ["auric-ide", "com.auricide.ide", "com.auricide.app"];
        let mut imported = Vec::new();
        for app_id in roots {
            let root = home.join("Library/WebKit").join(app_id).join("WebsiteData");
            if !root.exists() {
                continue;
            }
            for entry in WalkDir::new(root)
                .follow_links(false)
                .into_iter()
                .filter_map(Result::ok)
            {
                if entry.file_name() == "localstorage.sqlite3" {
                    imported.extend(read_legacy_sqlite(entry.path()));
                }
            }
        }
        merge_projects(imported)
    }
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

fn import_legacy_starred_profiles() -> Vec<StarredProject> {
    #[cfg(target_os = "macos")]
    {
        let Some(home) = dirs::home_dir() else {
            return Vec::new();
        };
        let roots = ["auric-ide", "com.auricide.ide", "com.auricide.app"];
        let mut imported = Vec::new();
        for app_id in roots {
            let root = home.join("Library/WebKit").join(app_id).join("WebsiteData");
            if !root.exists() {
                continue;
            }
            for entry in WalkDir::new(root)
                .follow_links(false)
                .into_iter()
                .filter_map(Result::ok)
            {
                if entry.file_name() == "localstorage.sqlite3" {
                    imported.extend(read_legacy_starred_sqlite(entry.path()));
                }
            }
        }
        merge_starred_projects(imported)
    }
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

fn read_legacy_sqlite(path: &Path) -> Vec<RecentProject> {
    let Ok(connection) = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    let Ok(value) = connection.query_row(
        "SELECT value FROM ItemTable WHERE key = ?1",
        [LEGACY_KEY],
        |row| row.get::<_, Vec<u8>>(0),
    ) else {
        return Vec::new();
    };
    let decoded = decode_webkit_value(&value);
    serde_json::from_str::<Vec<RecentProject>>(&decoded).unwrap_or_default()
}

fn read_legacy_starred_sqlite(path: &Path) -> Vec<StarredProject> {
    let Ok(connection) = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    let Ok(value) = connection.query_row(
        "SELECT value FROM ItemTable WHERE key = ?1",
        [LEGACY_STARRED_KEY],
        |row| row.get::<_, Vec<u8>>(0),
    ) else {
        return Vec::new();
    };
    let decoded = decode_webkit_value(&value);
    serde_json::from_str::<Vec<StarredProject>>(&decoded).unwrap_or_default()
}

/// WebKit stores a `localStorage` value as UTF-16 when it wrote it that way and
/// as plain UTF-8 otherwise, with no flag to say which. Shared with
/// [`crate::webview_prefs`], which reads the same tables.
pub(crate) fn decode_webkit_value(value: &[u8]) -> String {
    if value.starts_with(&[0xff, 0xfe]) || value.iter().skip(1).step_by(2).all(|byte| *byte == 0) {
        let offset = if value.starts_with(&[0xff, 0xfe]) {
            2
        } else {
            0
        };
        let units: Vec<u16> = value[offset..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(value).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(path: &str, opened_at: u64) -> RecentProject {
        RecentProject {
            path: path.into(),
            name: path.trim_start_matches('/').into(),
            opened_at,
        }
    }

    #[test]
    fn merge_keeps_latest_entry_and_orders_descending() {
        let merged = merge_projects(vec![project("/a", 1), project("/b", 2), project("/a", 3)]);
        assert_eq!(merged, vec![project("/a", 3), project("/b", 2)]);
    }

    #[test]
    fn decodes_webkit_utf16_values() {
        let text = "[{\"path\":\"/a\"}]";
        let encoded: Vec<u8> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_webkit_value(&encoded), text);
    }

    #[test]
    fn atomic_write_keeps_previous_version_as_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recent-projects.json");
        write_store_atomic(&path, &[project("/old", 1)]).unwrap();
        write_store_atomic(&path, &[project("/new", 2)]).unwrap();
        let backup = read_store(&path.with_extension("json.bak"))
            .unwrap()
            .unwrap();
        assert_eq!(backup, vec![project("/old", 1)]);
        assert_eq!(
            read_store(&path).unwrap().unwrap(),
            vec![project("/new", 2)]
        );
    }

    fn starred(path: &str, starred_at: u64) -> StarredProject {
        StarredProject {
            path: path.into(),
            name: path.trim_start_matches('/').into(),
            starred_at,
            icon: None,
            skills: Vec::new(),
            combos: Vec::new(),
            wheel_slots: Vec::new(),
        }
    }

    fn combo(id: &str, steps: Vec<QuickAccessSkill>) -> QuickAccessCombo {
        QuickAccessCombo {
            id: id.into(),
            label: id.into(),
            steps,
        }
    }

    fn skill(id: &str) -> QuickAccessSkill {
        QuickAccessSkill {
            id: id.into(),
            label: id.into(),
            prompt: format!("/{id}"),
            provider_id: None,
            model: None,
            permission_mode: None,
            headless: None,
        }
    }

    #[test]
    fn starred_merge_preserves_star_order_and_deduplicates() {
        let projects = vec![starred("/b", 2), starred("/a", 1), starred("/a", 3)];
        let merged = merge_starred_projects(projects);
        assert_eq!(
            merged
                .iter()
                .map(|project| project.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/a", "/b"]
        );
    }

    /// The guard against quarantining every existing user's stars on upgrade.
    /// Deliberately a raw literal in the OLD shape — serializing a new struct
    /// and reading it back would prove nothing about old files on disk.
    #[test]
    fn starred_store_reads_pre_settings_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("starred-projects.json");
        fs::write(
            &path,
            r#"{"version":1,"projects":[{"path":"/a","name":"a","starredAt":1}]}"#,
        )
        .unwrap();

        let loaded = read_starred_store(&path).unwrap().unwrap();

        assert_eq!(loaded, vec![starred("/a", 1)]);
        assert!(loaded[0].icon.is_none());
        assert!(loaded[0].skills.is_empty());
    }

    #[test]
    fn starred_store_round_trips_icon_and_skills() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("starred-projects.json");
        let mut project = starred("/a", 1);
        project.icon = Some(ProjectIconOverride {
            kind: "glyph".into(),
            value: "rocket_launch".into(),
        });
        project.skills = vec![QuickAccessSkill {
            provider_id: Some("claude".into()),
            model: Some("opus".into()),
            permission_mode: Some("plan".into()),
            headless: Some(true),
            ..skill("changelog")
        }];

        write_starred_store_atomic(&path, std::slice::from_ref(&project)).unwrap();

        assert_eq!(read_starred_store(&path).unwrap().unwrap(), vec![project]);
    }

    /// A newer build may write an icon kind this one has never heard of. It has
    /// to survive the read, or the whole file is quarantined over one field.
    #[test]
    fn starred_store_survives_unknown_icon_kind() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("starred-projects.json");
        fs::write(
            &path,
            r#"{"version":1,"projects":[{"path":"/a","name":"a","starredAt":1,
               "icon":{"kind":"sticker","value":"x"}}]}"#,
        )
        .unwrap();

        let loaded = read_starred_store(&path).unwrap().unwrap();

        assert_eq!(loaded[0].icon.as_ref().unwrap().kind, "sticker");
    }

    /// The quarantine-recovery scenario: the backend rebuilt a bare record from
    /// legacy scraping, the frontend then sends its localStorage copy carrying
    /// the settings. First-wins would discard the recovery payload.
    #[test]
    fn merge_starred_absorbs_settings_from_a_bare_winner() {
        let mut rich = starred("/a", 5);
        rich.icon = Some(ProjectIconOverride {
            kind: "emoji".into(),
            value: "🚀".into(),
        });
        rich.skills = vec![skill("changelog")];

        let merged = merge_starred_projects(vec![starred("/a", 1), rich]);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].icon.as_ref().unwrap().value, "🚀");
        assert_eq!(merged[0].skills, vec![skill("changelog")]);
        // Identity and "pinned since" stay with the earliest claim.
        assert_eq!(merged[0].starred_at, 1);
    }

    #[test]
    fn merge_starred_never_resurrects_deleted_skills() {
        let mut current = starred("/a", 1);
        current.skills = vec![skill("kept")];
        let mut stale = starred("/a", 2);
        stale.skills = vec![skill("kept"), skill("deleted"), skill("also-deleted")];

        let merged = merge_starred_projects(vec![current, stale]);

        assert_eq!(merged[0].skills, vec![skill("kept")]);
    }

    #[test]
    fn apply_settings_updates_only_the_named_project() {
        let mut projects = vec![starred("/a", 1), starred("/b", 2)];

        let applied = apply_starred_settings(
            &mut projects,
            "/b",
            StarredProjectSettings {
                icon: Some(ProjectIconOverride {
                    kind: "glyph".into(),
                    value: "bolt".into(),
                }),
                skills: vec![skill("seo")],
                combos: Vec::new(),
                wheel_slots: None,
            },
        );

        assert!(applied);
        assert_eq!(projects[0], starred("/a", 1));
        assert_eq!(projects[1].icon.as_ref().unwrap().value, "bolt");
        assert_eq!(projects[1].skills, vec![skill("seo")]);
    }

    #[test]
    fn apply_settings_refuses_an_unstarred_path() {
        let mut projects = vec![starred("/a", 1)];

        let applied =
            apply_starred_settings(&mut projects, "/nope", StarredProjectSettings::default());

        assert!(!applied);
        assert_eq!(projects, vec![starred("/a", 1)]);
    }

    /// Re-adding a starred path must stay a no-op — otherwise starring a
    /// project you already configured would wipe its icon and skills.
    #[test]
    fn add_does_not_reset_existing_settings() {
        let mut configured = starred("/a", 1);
        configured.skills = vec![skill("changelog")];
        let mut projects = vec![configured.clone()];

        push_starred_project(&mut projects, "/a".into(), 999);

        assert_eq!(projects, vec![configured]);
    }

    #[test]
    fn normalize_skills_caps_dedupes_and_drops_blanks() {
        let mut skills = vec![
            skill("  keep  "),
            QuickAccessSkill {
                label: "   ".into(),
                ..skill("blank-label")
            },
            QuickAccessSkill {
                id: "  ".into(),
                ..skill("blank-id")
            },
            QuickAccessSkill {
                label: "duplicate".into(),
                ..skill("keep")
            },
        ];
        skills.extend((0..30).map(|i| skill(&format!("bulk-{i}"))));

        let normalized = normalize_skills(skills);

        assert_eq!(normalized.len(), MAX_SKILLS_PER_PROJECT);
        assert_eq!(normalized[0].id, "keep");
        assert_eq!(
            normalized.iter().filter(|s| s.id == "keep").count(),
            1,
            "a duplicate id must not survive"
        );
        assert!(normalized.iter().all(|s| !s.label.trim().is_empty()));
    }

    #[test]
    fn starred_store_round_trips_combos() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("starred-projects.json");
        let mut project = starred("/a", 1);
        project.combos = vec![combo(
            "blog-write",
            vec![skill("finalize"), skill("rewrite")],
        )];

        write_starred_store_atomic(&path, std::slice::from_ref(&project)).unwrap();

        assert_eq!(read_starred_store(&path).unwrap().unwrap(), vec![project]);
    }

    #[test]
    fn merge_starred_absorbs_combos_from_a_bare_winner() {
        let mut rich = starred("/a", 5);
        rich.combos = vec![combo(
            "blog-write",
            vec![skill("finalize"), skill("rewrite")],
        )];

        let merged = merge_starred_projects(vec![starred("/a", 1), rich]);

        assert_eq!(merged[0].combos.len(), 1);
        assert_eq!(merged[0].combos[0].id, "blog-write");
        assert_eq!(merged[0].starred_at, 1);
    }

    #[test]
    fn merge_starred_never_resurrects_deleted_combos() {
        let mut current = starred("/a", 1);
        current.combos = vec![combo("kept", vec![skill("a"), skill("b")])];
        let mut stale = starred("/a", 2);
        stale.combos = vec![
            combo("kept", vec![skill("a"), skill("b")]),
            combo("deleted", vec![skill("c"), skill("d")]),
        ];

        let merged = merge_starred_projects(vec![current, stale]);

        assert_eq!(merged[0].combos.len(), 1);
        assert_eq!(merged[0].combos[0].id, "kept");
    }

    #[test]
    fn apply_settings_writes_combos() {
        let mut projects = vec![starred("/a", 1)];

        let applied = apply_starred_settings(
            &mut projects,
            "/a",
            StarredProjectSettings {
                combos: vec![combo(
                    "blog-write",
                    vec![skill("finalize"), skill("rewrite")],
                )],
                ..StarredProjectSettings::default()
            },
        );

        assert!(applied);
        assert_eq!(projects[0].combos[0].id, "blog-write");
    }

    #[test]
    fn apply_settings_writes_wheel_slots_and_drops_unknown_ids() {
        let mut projects = vec![starred("/a", 1)];
        projects[0].skills = vec![skill("research")];

        let applied = apply_starred_settings(
            &mut projects,
            "/a",
            StarredProjectSettings {
                skills: vec![skill("research")],
                wheel_slots: Some(vec![None, Some("research".into()), Some("gone".into())]),
                ..StarredProjectSettings::default()
            },
        );

        assert!(applied);
        assert_eq!(projects[0].wheel_slots[1].as_deref(), Some("research"));
        assert!(
            projects[0]
                .wheel_slots
                .iter()
                .filter(|s| s.is_some())
                .count()
                == 1
        );
    }

    #[test]
    fn apply_settings_keeps_the_wheel_when_the_payload_omits_it() {
        let mut projects = vec![starred("/a", 1)];
        projects[0].skills = vec![skill("research")];
        projects[0].wheel_slots = vec![Some("research".into())];

        apply_starred_settings(
            &mut projects,
            "/a",
            StarredProjectSettings {
                skills: vec![skill("research")],
                ..StarredProjectSettings::default()
            },
        );

        assert_eq!(projects[0].wheel_slots[0].as_deref(), Some("research"));
    }

    #[test]
    fn apply_settings_scrubs_wheel_slots_when_the_skill_is_removed() {
        let mut projects = vec![starred("/a", 1)];
        projects[0].skills = vec![skill("research")];
        projects[0].wheel_slots = vec![Some("research".into())];

        apply_starred_settings(
            &mut projects,
            "/a",
            StarredProjectSettings {
                skills: Vec::new(),
                ..StarredProjectSettings::default()
            },
        );

        assert!(projects[0].wheel_slots.is_empty());
    }

    #[test]
    fn apply_settings_keeps_a_combo_on_the_wheel() {
        let mut projects = vec![starred("/a", 1)];

        let applied = apply_starred_settings(
            &mut projects,
            "/a",
            StarredProjectSettings {
                combos: vec![combo("blog-write", vec![skill("finalize")])],
                wheel_slots: Some(vec![Some("combo:blog-write".into())]),
                ..StarredProjectSettings::default()
            },
        );

        assert!(applied);
        assert_eq!(
            projects[0].wheel_slots[0].as_deref(),
            Some("combo:blog-write")
        );
    }
}
