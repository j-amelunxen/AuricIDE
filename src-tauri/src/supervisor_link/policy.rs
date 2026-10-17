//! Which projects the supervisor link may show scenes from
//! (`docs/design-supervisor-link.md`, "Who sees what").
//!
//! `<app_data_dir>/supervisor-link.json` is Rust-owned and written at 0600.
//! It fails closed: a missing, unreadable or unknown-version file means no
//! project is visible, never all of them. Paths are compared canonically so a
//! symlink and its target find the same entry.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::supervisor::canonical_project_path;

/// Fixture `policyFileName`.
pub const POLICY_FILE_NAME: &str = "supervisor-link.json";

/// The only on-disk version this build reads. Another one is not guessed at.
const POLICY_VERSION: u32 = 1;

/// The policy as the rest of the link sees it: canonical, de-duplicated,
/// sorted project paths.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPolicy {
    pub scene_projects: Vec<String>,
}

/// `{ "version": 1, "scenes": { "projects": [..] } }`. Kept apart from
/// `LinkPolicy` so the file can grow sections without the frontend shape
/// following it.
#[derive(Debug, Serialize, Deserialize)]
struct PolicyFile {
    version: u32,
    scenes: ScenesSection,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ScenesSection {
    #[serde(default)]
    projects: Vec<String>,
}

pub fn policy_path_in(app_data: &Path) -> PathBuf {
    app_data.join(POLICY_FILE_NAME)
}

/// Canonical, de-duplicated, sorted. Two spellings of one folder collapse to
/// one entry, so the list the settings show is the list that is enforced.
fn canonical_projects<'a>(paths: impl IntoIterator<Item = &'a String>) -> Vec<String> {
    let mut projects: Vec<String> = paths
        .into_iter()
        .map(|path| canonical_project_path(path))
        .collect();
    projects.sort();
    projects.dedup();
    projects
}

/// The stored policy, or an empty one when the file is missing, broken or of
/// another version. Relative entries (only possible by hand-editing) are
/// dropped: they would resolve against whatever the app's cwd happens to be.
pub fn read_policy(app_data: &Path) -> LinkPolicy {
    let Ok(text) = std::fs::read_to_string(policy_path_in(app_data)) else {
        return LinkPolicy::default();
    };
    let Ok(file) = serde_json::from_str::<PolicyFile>(&text) else {
        return LinkPolicy::default();
    };
    if file.version != POLICY_VERSION {
        return LinkPolicy::default();
    }
    let absolute = file
        .scenes
        .projects
        .iter()
        .filter(|path| Path::new(path.as_str()).is_absolute());
    LinkPolicy {
        scene_projects: canonical_projects(absolute),
    }
}

/// Stores the policy and returns what was stored. Every path must be absolute;
/// the first one that is not is named in the error and nothing is written.
pub fn write_policy(app_data: &Path, policy: &LinkPolicy) -> Result<LinkPolicy, String> {
    if let Some(relative) = policy
        .scene_projects
        .iter()
        .find(|path| !Path::new(path.as_str()).is_absolute())
    {
        return Err(format!(
            "Scene project paths must be absolute, got \"{relative}\""
        ));
    }
    let stored = LinkPolicy {
        scene_projects: canonical_projects(&policy.scene_projects),
    };
    let file = PolicyFile {
        version: POLICY_VERSION,
        scenes: ScenesSection {
            projects: stored.scene_projects.clone(),
        },
    };
    let payload = serde_json::to_vec_pretty(&file).map_err(|error| error.to_string())?;
    write_private_atomic(&policy_path_in(app_data), &payload)?;
    Ok(stored)
}

/// Temp file at 0600, then a rename, as `supervisor::write_policy_atomic`
/// does for its typed policy: a read mid-write sees the old file or the new
/// one. Writes are serialised and each has its own temp file, so two saves
/// cannot truncate each other.
fn write_private_atomic(path: &Path, payload: &[u8]) -> Result<(), String> {
    static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    static WRITE_SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let _writing = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let parent = path
        .parent()
        .ok_or_else(|| "The supervisor link policy has no parent directory".to_string())?;
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

/// Whether `project` is listed, both sides compared canonically.
pub fn allows(policy: &LinkPolicy, project: &str) -> bool {
    let wanted = canonical_project_path(project);
    policy
        .scene_projects
        .iter()
        .any(|listed| canonical_project_path(listed) == wanted)
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
    projects: Vec<String>,
) -> Result<LinkPolicy, String> {
    write_policy(
        &app_data_dir(&app)?,
        &LinkPolicy {
            scene_projects: projects,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = include_str!("../../../src/lib/agents/supervisorLink.fixtures.json");

    fn real(path: &Path) -> String {
        path.canonicalize().unwrap().to_str().unwrap().to_string()
    }

    #[test]
    fn the_file_name_is_the_fixture() {
        let fixtures: serde_json::Value = serde_json::from_str(FIXTURES).unwrap();
        assert_eq!(fixtures["policyFileName"], POLICY_FILE_NAME);
    }

    #[test]
    fn a_written_policy_reads_back_canonical_sorted_and_unique() {
        let app = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let a = tempfile::tempdir().unwrap();
        let b_path = b.path().to_str().unwrap().to_string();
        let a_path = a.path().to_str().unwrap().to_string();
        let stored = write_policy(
            app.path(),
            &LinkPolicy {
                scene_projects: vec![b_path.clone(), a_path, b_path],
            },
        )
        .unwrap();
        let mut expected = vec![real(a.path()), real(b.path())];
        expected.sort();
        assert_eq!(stored.scene_projects, expected);
        assert_eq!(read_policy(app.path()), stored);

        let on_disk: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(policy_path_in(app.path())).unwrap())
                .unwrap();
        assert_eq!(on_disk["version"], 1);
        assert_eq!(on_disk["scenes"]["projects"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn a_missing_broken_or_foreign_file_shows_nothing() {
        let app = tempfile::tempdir().unwrap();
        assert_eq!(read_policy(app.path()), LinkPolicy::default());
        let project = tempfile::tempdir().unwrap();
        let listed = project.path().to_str().unwrap();
        for text in [
            String::new(),
            "not json".to_string(),
            "[]".to_string(),
            format!(r#"{{ "version": 2, "scenes": {{ "projects": ["{listed}"] }} }}"#),
            format!(r#"{{ "scenes": {{ "projects": ["{listed}"] }} }}"#),
            r#"{ "version": 1 }"#.to_string(),
            r#"{ "version": 1, "scenes": { "projects": [1] } }"#.to_string(),
        ] {
            std::fs::write(policy_path_in(app.path()), &text).unwrap();
            assert_eq!(read_policy(app.path()), LinkPolicy::default(), "{text}");
        }
    }

    #[test]
    fn a_hand_written_relative_entry_is_dropped() {
        let app = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let listed = project.path().to_str().unwrap();
        std::fs::write(
            policy_path_in(app.path()),
            format!(
                r#"{{ "version": 1, "scenes": {{ "projects": ["relative/dir", "{listed}"] }} }}"#
            ),
        )
        .unwrap();
        assert_eq!(
            read_policy(app.path()).scene_projects,
            vec![real(project.path())]
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let app = tempfile::tempdir().unwrap();
        write_policy(app.path(), &LinkPolicy::default()).unwrap();
        let mode = std::fs::metadata(policy_path_in(app.path()))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn a_relative_path_is_refused_by_name_and_nothing_is_written() {
        let app = tempfile::tempdir().unwrap();
        let error = write_policy(
            app.path(),
            &LinkPolicy {
                scene_projects: vec!["projects/accounting".to_string()],
            },
        )
        .unwrap_err();
        assert!(error.contains("projects/accounting"), "{error}");
        assert!(!policy_path_in(app.path()).exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_project_is_stored_and_matched_as_its_target() {
        let app = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let links = tempfile::tempdir().unwrap();
        let link = links.path().join("alias");
        std::os::unix::fs::symlink(target.path(), &link).unwrap();
        let stored = write_policy(
            app.path(),
            &LinkPolicy {
                scene_projects: vec![link.to_str().unwrap().to_string()],
            },
        )
        .unwrap();
        assert_eq!(stored.scene_projects, vec![real(target.path())]);
        assert!(allows(&stored, link.to_str().unwrap()));
        assert!(allows(&stored, target.path().to_str().unwrap()));
        assert!(!allows(&stored, links.path().to_str().unwrap()));
    }
}
