//! Where an agent started from an MCP launch request may run.
//!
//! Sub-goal 09, directory rule: a requested agent runs in the requesting
//! agent's own working directory, or in a fresh IDE worktree of that same
//! repository (`<main>.auric-wt/<id>`, branch `auric/<id>`). The folder is
//! stored with the request by the MCP server (`AURIC_AGENT_CWD`, see
//! `src/mcp/tools/agentLaunch.ts`) and checked there once; this is the second,
//! native check at spawn time, against the row in the inbox rather than
//! against anything the frontend says.
//!
//! Reads the inbox only. The request row is the one the MCP server wrote, so a
//! forged `spawn_agent` call that names a request cannot pick its own folder.
//!
//! The stored folder is only as trustworthy as the `AURIC_AGENT_CWD` the MCP
//! server was started with. A shell agent that starts its own server process
//! with a forged value (review r3, blocker 1) is the excluded shell agent of
//! the threat model (notes/2026-09-26-09-antwort-nach-r3.md), not a case this
//! check can catch.

use crate::git::types::{AURIC_WORKTREE_BRANCH_PREFIX, AURIC_WORKTREE_DIR_SUFFIX};
use git2::Repository;
use rusqlite::{Connection, OptionalExtension};
use std::path::{Path, PathBuf};

/// Mirrors `LAUNCH_REQUEST_ORIGIN` / `LAUNCH_REQUEST_KEY_PREFIX` in
/// `src/lib/notifications/launchRequest.ts`.
const LAUNCH_REQUEST_ORIGIN: &str = "request_agent_launch";
const LAUNCH_REQUEST_KEY_PREFIX: &str = "agent-launch:";

/// What the request stored: the folder and whether a worktree was asked for.
#[derive(Debug, PartialEq, Eq)]
struct StoredPlacement {
    folder: String,
    use_worktree: bool,
    /// When the request was written, SQLite UTC `YYYY-MM-DD HH:MM:SS`.
    created_at: String,
}

fn stored_placement(conn: &Connection, request_uid: &str) -> Result<StoredPlacement, String> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT actions, created_at FROM notifications
              WHERE uid = ?1 AND source = 'agent' AND origin = ?2 AND dedupe_key LIKE ?3",
            rusqlite::params![
                request_uid,
                LAUNCH_REQUEST_ORIGIN,
                format!("{LAUNCH_REQUEST_KEY_PREFIX}%")
            ],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("Could not read launch request '{request_uid}': {error}"))?;
    let (actions, created_at) =
        row.ok_or_else(|| format!("'{request_uid}' is not an agent launch request"))?;
    let actions: serde_json::Value = serde_json::from_str(&actions).map_err(|error| {
        format!("Launch request '{request_uid}' has unreadable actions: {error}")
    })?;
    let spawn = actions
        .as_array()
        .and_then(|list| {
            list.iter()
                .find(|action| action["kind"].as_str() == Some("spawn-agent"))
        })
        .ok_or_else(|| format!("Launch request '{request_uid}' has no spawn-agent action"))?;
    let folder = spawn["repoPath"]
        .as_str()
        .filter(|folder| !folder.is_empty())
        .ok_or_else(|| format!("Launch request '{request_uid}' stored no folder to start in"))?;
    Ok(StoredPlacement {
        folder: folder.to_string(),
        use_worktree: spawn["useWorktree"].as_bool().unwrap_or(false),
        created_at,
    })
}

/// The stored folder, accepted only as the canonical spelling of an existing
/// directory: relative paths, `..` and symlinks all differ from their
/// canonical form.
fn canonical_stored_folder(folder: &str) -> Result<PathBuf, String> {
    let path = Path::new(folder);
    if !path.is_absolute() {
        return Err(format!("Launch folder '{folder}' is not absolute"));
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Launch folder '{folder}' cannot be resolved: {error}"))?;
    if canonical != path {
        return Err(format!(
            "Launch folder '{folder}' is not canonical (resolves to '{}')",
            canonical.display()
        ));
    }
    if !canonical.is_dir() {
        return Err(format!("Launch folder '{folder}' is not a directory"));
    }
    Ok(canonical)
}

/// The repository's common git directory, canonical. git2 0.19 has no
/// `commondir()`, so this reads git's own `commondir` file, which every linked
/// worktree's git directory carries; a main checkout is its own common dir.
fn common_dir(repo: &Repository) -> Result<PathBuf, String> {
    let git_dir = repo.path();
    let pointer = git_dir.join("commondir");
    let common = match std::fs::read_to_string(&pointer) {
        Ok(raw) => {
            let target = PathBuf::from(raw.trim());
            if target.is_absolute() {
                target
            } else {
                git_dir.join(target)
            }
        }
        Err(_) => git_dir.to_path_buf(),
    };
    common
        .canonicalize()
        .map_err(|error| format!("Could not resolve git common dir: {error}"))
}

fn open_repo(path: &Path, role: &str) -> Result<Repository, String> {
    Repository::open(path).map_err(|error| {
        format!(
            "{role} '{}' is not a git repository: {error}",
            path.display()
        )
    })
}

/// A fresh IDE worktree of the stored folder's repository: same common git
/// dir, directly inside `<main>.auric-wt/`, on an `auric/` branch.
/// The worktree must have been made after the request was written: its git
/// admin directory (`<common>/worktrees/<id>`) is no older than the request,
/// compared at whole seconds because SQLite stores seconds.
fn check_worktree_is_new(
    target: &Repository,
    cwd: &Path,
    requested_at: &str,
) -> Result<(), String> {
    let requested = chrono::NaiveDateTime::parse_from_str(requested_at, "%Y-%m-%d %H:%M:%S")
        .map_err(|error| {
            format!("Launch request has an unreadable time '{requested_at}': {error}")
        })?
        .and_utc()
        .timestamp();
    let meta = std::fs::metadata(target.path())
        .map_err(|error| format!("Could not read worktree '{}': {error}", cwd.display()))?;
    let made = meta
        .created()
        .or_else(|_| meta.modified())
        .map_err(|error| {
            format!(
                "Could not read when worktree '{}' was made: {error}",
                cwd.display()
            )
        })?;
    let made = chrono::DateTime::<chrono::Utc>::from(made).timestamp();
    if made < requested {
        return Err(format!(
            "Worktree '{}' was made before the request, not for it",
            cwd.display()
        ));
    }
    Ok(())
}

fn check_worktree(stored: &Path, cwd: &Path, requested_at: &str) -> Result<(), String> {
    let source = open_repo(stored, "Launch folder")?;
    let target = open_repo(cwd, "Worktree")?;
    if !target.is_worktree() {
        return Err(format!(
            "'{}' is not a git worktree, but the request asked for one",
            cwd.display()
        ));
    }
    if common_dir(&source)? != common_dir(&target)? {
        return Err(format!(
            "Worktree '{}' belongs to another repository than '{}'",
            cwd.display(),
            stored.display()
        ));
    }

    let main = crate::git::discovery::primary_project_path(stored)
        .ok_or_else(|| "Could not resolve the repository's main working tree".to_string())?
        .canonicalize()
        .map_err(|error| format!("Could not resolve the main working tree: {error}"))?;
    let main_name = main
        .file_name()
        .ok_or_else(|| "The main working tree has no folder name".to_string())?;
    let expected_parent = main.with_file_name(format!(
        "{}{AURIC_WORKTREE_DIR_SUFFIX}",
        main_name.to_string_lossy()
    ));
    if cwd.parent() != Some(expected_parent.as_path()) {
        return Err(format!(
            "Worktree '{}' is not an IDE worktree under '{}'",
            cwd.display(),
            expected_parent.display()
        ));
    }

    let head = target
        .head()
        .map_err(|error| format!("Worktree '{}' has no HEAD: {error}", cwd.display()))?;
    check_worktree_is_new(&target, cwd, requested_at)?;
    let branch = head.shorthand().unwrap_or_default();
    if !branch.starts_with(AURIC_WORKTREE_BRANCH_PREFIX) {
        return Err(format!(
            "Worktree '{}' is on '{branch}', not an IDE ({AURIC_WORKTREE_BRANCH_PREFIX}) branch",
            cwd.display()
        ));
    }
    Ok(())
}

/// Refuses the spawn unless `cwd` is where the launch request `request_uid`
/// may run: the stored folder itself, or (when the request asked for one) a
/// fresh IDE worktree of the same repository.
pub fn check_launch_directory(
    conn: &Connection,
    request_uid: &str,
    cwd: Option<&str>,
) -> Result<(), String> {
    let placement = stored_placement(conn, request_uid)?;
    let stored = canonical_stored_folder(&placement.folder)?;
    let cwd = cwd.ok_or_else(|| "A launch request needs a working directory".to_string())?;
    let cwd = Path::new(cwd)
        .canonicalize()
        .map_err(|error| format!("Working directory '{cwd}' cannot be resolved: {error}"))?;

    if placement.use_worktree {
        return check_worktree(&stored, &cwd, &placement.created_at);
    }
    if cwd != stored {
        return Err(format!(
            "A launch request may only start in the requesting agent's folder '{}', not '{}'",
            stored.display(),
            cwd.display()
        ));
    }
    Ok(())
}

/// Mirrors the stamp the MCP server puts on every agent-written spawn-agent
/// action it checked (`REQUESTER_PLACEMENT` in `src/mcp/requesterFolder.ts`).
const REQUESTER_PLACEMENT: &str = "requester";

/// The folder an agent-written spawn-agent action (`notify`, an agent's
/// schedule) was stamped with by the MCP server.
fn stamped_agent_folder(
    conn: &Connection,
    notification_uid: &str,
    action_id: &str,
) -> Result<String, String> {
    let actions: Option<String> = conn
        .query_row(
            "SELECT actions FROM notifications
              WHERE uid = ?1 AND source IN ('agent', 'mcp')",
            rusqlite::params![notification_uid],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not read notification '{notification_uid}': {error}"))?;
    let actions =
        actions.ok_or_else(|| format!("'{notification_uid}' is not written by an agent"))?;
    let actions: serde_json::Value = serde_json::from_str(&actions).map_err(|error| {
        format!("Notification '{notification_uid}' has unreadable actions: {error}")
    })?;
    let spawn = actions
        .as_array()
        .and_then(|list| {
            list.iter().find(|action| {
                action["id"].as_str() == Some(action_id)
                    && action["kind"].as_str() == Some("spawn-agent")
            })
        })
        .ok_or_else(|| {
            format!("Notification '{notification_uid}' has no spawn-agent action '{action_id}'")
        })?;
    if spawn["useWorktree"].as_bool().unwrap_or(false) {
        return Err(format!(
            "An agent-written Start button cannot make a worktree ('{notification_uid}'); \
             use request_agent_launch for that"
        ));
    }
    let folder = spawn["repoPath"]
        .as_str()
        .filter(|folder| !folder.is_empty());
    match (spawn["placement"].as_str(), folder) {
        (Some(REQUESTER_PLACEMENT), Some(folder)) => Ok(folder.to_string()),
        _ => Err(format!(
            "The Start button on '{notification_uid}' carries no checked folder (it was \
             written before the directory rule, or not by the IDE's MCP server); ask the \
             agent to send it again"
        )),
    }
}

/// Refuses the spawn unless `cwd` is the requesting agent's own folder, as
/// stamped on an agent-written spawn-agent action. Sub-goal 09, blocker 2 of
/// review r3: the general `notify` tool (and `schedule_create`) must not
/// reach a folder that `request_agent_launch` could not.
pub fn check_agent_notification_directory(
    conn: &Connection,
    notification_uid: &str,
    action_id: &str,
    cwd: Option<&str>,
) -> Result<(), String> {
    let folder = stamped_agent_folder(conn, notification_uid, action_id)?;
    let stored = canonical_stored_folder(&folder)?;
    let cwd =
        cwd.ok_or_else(|| "An agent-written Start button needs a working directory".to_string())?;
    let cwd = Path::new(cwd)
        .canonicalize()
        .map_err(|error| format!("Working directory '{cwd}' cannot be resolved: {error}"))?;
    if cwd != stored {
        return Err(format!(
            "An agent-written Start button may only start in the requesting agent's folder '{}', not '{}'",
            stored.display(),
            cwd.display()
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "launch_dir_tests.rs"]
mod tests;
