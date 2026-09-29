//! Claude Code keeps a per-folder list of MCP servers the user switched off
//! (`/mcp` → disable), in `~/.claude.json` under
//! `projects["<folder>"].disabledMcpServers`. The list matches by server name
//! and applies to `--mcp-config` servers too, so an `auric-pm` disabled there
//! once is gone from every agent the IDE starts in that folder: the launch
//! succeeds, the server shows up as `disabled`, and the agent works without its
//! goal, stations or tickets. A conductor goal agent then finishes its work,
//! cannot mark a single station and spends its attempts for nothing.
//!
//! The spawn is refused instead, with the one edit that fixes it.

use serde_json::Value;
use std::path::{Path, PathBuf};

/// The server name every binding registers (`crate::mcp::write_agent_mcp_configs`).
const AURIC_SERVER: &str = "auric-pm";

/// Where Claude Code keeps its global config: `$CLAUDE_CONFIG_DIR/.claude.json`
/// when that is set, `~/.claude.json` otherwise.
fn claude_global_config_path() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(dir).join(".claude.json"));
    }
    dirs::home_dir().map(|home| home.join(".claude.json"))
}

/// The folder whose entry disables `auric-pm` for an agent running in `cwd`,
/// if any. Claude Code keys the entry by the folder it was started in or by
/// that folder's git root, so `cwd` and each parent up to `project_root` are
/// checked — a worktree or subfolder of the project included, nothing above it.
pub fn folder_disabling_auric_pm(
    config: &Value,
    project_root: &Path,
    cwd: Option<&Path>,
) -> Option<PathBuf> {
    let projects = config.get("projects")?.as_object()?;
    let start = cwd
        .filter(|c| c.starts_with(project_root))
        .unwrap_or(project_root);
    start
        .ancestors()
        .take_while(|folder| folder.starts_with(project_root))
        .find(|folder| {
            projects
                .get(folder.to_string_lossy().as_ref())
                .and_then(|entry| entry.get("disabledMcpServers"))
                .and_then(Value::as_array)
                .is_some_and(|names| names.iter().any(|n| n.as_str() == Some(AURIC_SERVER)))
        })
        .map(Path::to_path_buf)
}

/// Refuses a Claude Code spawn whose folder has `auric-pm` switched off. A
/// config that is missing or unreadable is not a refusal: then nothing is
/// disabled that we could know about.
pub fn check_auric_pm_enabled(project_root: &Path, cwd: Option<&Path>) -> Result<(), String> {
    let Some(path) = claude_global_config_path() else {
        return Ok(());
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Ok(());
    };
    let Ok(config) = serde_json::from_str::<Value>(&raw) else {
        return Ok(());
    };
    match folder_disabling_auric_pm(&config, project_root, cwd) {
        None => Ok(()),
        Some(folder) => Err(format!(
            "Claude Code has the auric-pm MCP server switched off for {} \
             ({} → projects → disabledMcpServers). The agent would run without \
             its goal, stations and tickets. Remove \"auric-pm\" from that list, \
             then start again.",
            folder.display(),
            path.display()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config_disabling(folder: &str, names: &[&str]) -> Value {
        json!({ "projects": { folder: { "disabledMcpServers": names } } })
    }

    #[test]
    fn finds_auric_pm_disabled_for_the_project_folder() {
        let config = config_disabling("/work/shop", &["figma", "auric-pm"]);
        assert_eq!(
            folder_disabling_auric_pm(&config, Path::new("/work/shop"), None),
            Some(PathBuf::from("/work/shop"))
        );
    }

    #[test]
    fn other_disabled_servers_are_not_a_refusal() {
        let config = config_disabling("/work/shop", &["figma", "claude.ai Gmail"]);
        assert_eq!(
            folder_disabling_auric_pm(&config, Path::new("/work/shop"), None),
            None
        );
    }

    #[test]
    fn a_worktree_inside_the_project_is_checked_up_to_the_project_root() {
        let root = Path::new("/work/shop");
        let worktree = Path::new("/work/shop/.worktrees/fix");
        let at_worktree = config_disabling("/work/shop/.worktrees/fix", &["auric-pm"]);
        assert_eq!(
            folder_disabling_auric_pm(&at_worktree, root, Some(worktree)),
            Some(PathBuf::from("/work/shop/.worktrees/fix"))
        );
        let at_root = config_disabling("/work/shop", &["auric-pm"]);
        assert_eq!(
            folder_disabling_auric_pm(&at_root, root, Some(worktree)),
            Some(PathBuf::from("/work/shop"))
        );
    }

    #[test]
    fn a_folder_above_the_project_does_not_count() {
        let config = config_disabling("/work", &["auric-pm"]);
        assert_eq!(
            folder_disabling_auric_pm(&config, Path::new("/work/shop"), None),
            None
        );
    }

    #[test]
    fn a_cwd_outside_the_project_falls_back_to_the_project_root() {
        let config = config_disabling("/elsewhere", &["auric-pm"]);
        assert_eq!(
            folder_disabling_auric_pm(
                &config,
                Path::new("/work/shop"),
                Some(Path::new("/elsewhere"))
            ),
            None
        );
    }

    #[test]
    fn a_config_without_projects_disables_nothing() {
        assert_eq!(
            folder_disabling_auric_pm(&json!({}), Path::new("/work/shop"), None),
            None
        );
    }
}
