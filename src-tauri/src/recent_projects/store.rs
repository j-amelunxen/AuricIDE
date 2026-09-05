use super::legacy::{import_legacy_starred_profiles, import_legacy_webkit_profiles};
use super::types::*;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct RecentProjectsState {
    pub store_path: PathBuf,
    pub projects: Mutex<Vec<RecentProject>>,
}

pub struct StarredProjectsState {
    pub store_path: PathBuf,
    pub projects: Mutex<Vec<StarredProject>>,
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

    pub fn update<F>(&self, operation: F) -> Result<Vec<RecentProject>, String>
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

    pub fn update<F>(&self, operation: F) -> Result<Vec<StarredProject>, String>
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

pub fn merge_projects(projects: Vec<RecentProject>) -> Vec<RecentProject> {
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

pub fn merge_starred_projects(projects: Vec<StarredProject>) -> Vec<StarredProject> {
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

pub fn normalize_skills(skills: Vec<QuickAccessSkill>) -> Vec<QuickAccessSkill> {
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

pub fn known_wheel_ids(project: &StarredProject) -> std::collections::HashSet<String> {
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

pub fn normalize_wheel_slots(
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

pub fn normalize_combos(combos: Vec<QuickAccessCombo>) -> Vec<QuickAccessCombo> {
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

pub fn apply_starred_settings(
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

pub fn push_starred_project(projects: &mut Vec<StarredProject>, path: String, starred_at: u64) {
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

pub fn read_store(path: &Path) -> Result<Option<Vec<RecentProject>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let file: RecentProjectsFile =
        serde_json::from_str(&contents).map_err(|error| error.to_string())?;
    Ok(Some(merge_projects(file.projects)))
}

pub fn write_store_atomic(path: &Path, projects: &[RecentProject]) -> Result<(), String> {
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

pub fn read_starred_store(path: &Path) -> Result<Option<Vec<StarredProject>>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let file: StarredProjectsFile =
        serde_json::from_str(&contents).map_err(|error| error.to_string())?;
    Ok(Some(merge_starred_projects(file.projects)))
}

pub fn write_starred_store_atomic(path: &Path, projects: &[StarredProject]) -> Result<(), String> {
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

pub fn preserve_corrupt_store(path: &Path) {
    preserve_corrupt_store_as(path, "recent-projects");
}

pub fn preserve_corrupt_store_as(path: &Path, name: &str) {
    if path.exists() {
        let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
        let backup = path.with_file_name(format!("{name}.corrupt-{timestamp}.json.bak"));
        let _ = fs::copy(path, backup);
    }
}
