use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use walkdir::WalkDir;

const STORE_VERSION: u32 = 1;
const MAX_RECENT_PROJECTS: usize = 50;
const LEGACY_KEY: &str = "auric-recent-projects";
const LEGACY_STARRED_KEY: &str = "auric-starred-projects";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub opened_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StarredProject {
    pub path: String,
    pub name: String,
    pub starred_at: u64,
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
    let name = Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&path)
        .to_string();
    let starred_at = chrono::Utc::now().timestamp_millis().max(0) as u64;
    state.update(|projects| {
        if !projects.iter().any(|project| project.path == path) {
            projects.push(StarredProject {
                path,
                name,
                starred_at,
            });
        }
    })
}

#[tauri::command]
pub fn starred_projects_remove(
    path: String,
    state: tauri::State<'_, StarredProjectsState>,
) -> Result<Vec<StarredProject>, String> {
    state.update(|projects| projects.retain(|project| project.path != path))
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
    let mut by_path: HashMap<String, StarredProject> = HashMap::new();
    for project in projects
        .into_iter()
        .filter(|project| !project.path.trim().is_empty())
    {
        by_path.entry(project.path.clone()).or_insert(project);
    }
    let mut merged: Vec<_> = by_path.into_values().collect();
    merged.sort_by(|a, b| {
        a.starred_at
            .cmp(&b.starred_at)
            .then_with(|| a.path.cmp(&b.path))
    });
    merged.truncate(MAX_RECENT_PROJECTS);
    merged
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
        return merge_projects(imported);
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
        return merge_starred_projects(imported);
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

fn decode_webkit_value(value: &[u8]) -> String {
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

    #[test]
    fn starred_merge_preserves_star_order_and_deduplicates() {
        let projects = vec![
            StarredProject {
                path: "/b".into(),
                name: "b".into(),
                starred_at: 2,
            },
            StarredProject {
                path: "/a".into(),
                name: "a".into(),
                starred_at: 1,
            },
            StarredProject {
                path: "/a".into(),
                name: "a-new".into(),
                starred_at: 3,
            },
        ];
        let merged = merge_starred_projects(projects);
        assert_eq!(
            merged
                .iter()
                .map(|project| project.path.as_str())
                .collect::<Vec<_>>(),
            vec!["/a", "/b"]
        );
    }
}
