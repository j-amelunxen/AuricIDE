use super::blame::git_blame_impl;
use super::diff::{
    git_diff_commit_impl, git_diff_file_ref_impl, git_diff_impl, git_diff_ref_files_impl,
};
use super::discard::git_discard_impl;
use super::discovery::git_discover_repos_impl;
use super::log::{git_list_branches_impl, git_log_since_impl};
use super::staging::{git_commit_impl, git_push_impl, git_stage_impl, git_unstage_impl};
use super::status::{git_branch_info_impl, git_projects_dirty_impl, git_status_impl};
use super::types::*;
use super::worktrees::{
    git_default_branch_impl, git_worktree_add_impl, git_worktree_list_impl,
    git_worktree_merge_into_default_impl, git_worktree_remove_impl,
};
use std::path::Path;

#[tauri::command(async)]
pub fn git_status(repo_path: String) -> Result<Vec<GitFileStatus>, String> {
    git_status_impl(&repo_path)
}

#[tauri::command(async)]
pub fn git_discover_repos(root_path: String) -> Result<Vec<GitRepoRef>, String> {
    git_discover_repos_impl(Path::new(&root_path))
}

#[tauri::command(async)]
pub fn git_projects_dirty(paths: Vec<String>) -> Vec<ProjectDirty> {
    git_projects_dirty_impl(&paths)
}

#[tauri::command(async)]
pub fn git_branch_info(repo_path: String) -> Result<BranchInfo, String> {
    git_branch_info_impl(&repo_path)
}

#[tauri::command(async)]
pub fn git_diff(
    repo_path: String,
    file_path: String,
    side: Option<String>,
) -> Result<String, String> {
    git_diff_impl(&repo_path, &file_path, side.as_deref())
}

#[tauri::command(async)]
pub fn git_stage(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    git_stage_impl(&repo_path, &paths)
}

#[tauri::command(async)]
pub fn git_unstage(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    git_unstage_impl(&repo_path, &paths)
}

#[tauri::command(async)]
pub fn git_commit(repo_path: String, message: String) -> Result<String, String> {
    git_commit_impl(&repo_path, &message)
}

#[tauri::command(async)]
pub fn git_discard(repo_path: String, file_path: String) -> Result<(), String> {
    git_discard_impl(&repo_path, &file_path)
}

#[tauri::command(async)]
pub fn git_push(repo_path: String) -> Result<(), String> {
    git_push_impl(&repo_path)
}

#[tauri::command(async)]
pub fn git_log_since(
    repo_path: String,
    since_iso: Option<String>,
    path_prefix: Option<String>,
) -> Result<Vec<CommitInfo>, String> {
    git_log_since_impl(
        &repo_path,
        since_iso.as_deref(),
        path_prefix.as_deref(),
        200,
        GIT_LOG_MAX_SCAN,
    )
}

#[tauri::command(async)]
pub fn git_list_branches(repo_path: String) -> Result<Vec<GitBranch>, String> {
    git_list_branches_impl(&repo_path)
}

#[tauri::command(async)]
pub fn git_blame(repo_path: String, file_path: String) -> Result<Vec<BlameHunk>, String> {
    git_blame_impl(&repo_path, &file_path)
}

#[tauri::command(async)]
pub fn git_diff_commit(
    repo_path: String,
    oid: String,
    file_path: String,
) -> Result<String, String> {
    git_diff_commit_impl(&repo_path, &oid, &file_path)
}

#[tauri::command(async)]
pub fn git_diff_ref_files(
    repo_path: String,
    ref_name: String,
) -> Result<Vec<GitNameStatus>, String> {
    git_diff_ref_files_impl(&repo_path, &ref_name)
}

#[tauri::command(async)]
pub fn git_diff_file_ref(
    repo_path: String,
    ref_name: String,
    file_path: String,
) -> Result<String, String> {
    git_diff_file_ref_impl(&repo_path, &ref_name, &file_path)
}

#[tauri::command(async)]
pub fn git_worktree_add(repo_path: String, name: String) -> Result<GitWorktree, String> {
    git_worktree_add_impl(&repo_path, &name)
}

#[tauri::command(async)]
pub fn git_worktree_list(repo_path: String) -> Result<Vec<GitWorktree>, String> {
    git_worktree_list_impl(&repo_path)
}

#[tauri::command(async)]
pub fn git_worktree_remove(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> Result<(), String> {
    git_worktree_remove_impl(&repo_path, &worktree_path, force)
}

#[tauri::command(async)]
pub fn git_default_branch(repo_path: String) -> Result<String, String> {
    git_default_branch_impl(&repo_path)
}

#[tauri::command(async)]
pub fn git_worktree_merge_into_default(
    repo_path: String,
    worktree_path: String,
    commit_message: Option<String>,
) -> Result<WorktreeMergeResult, String> {
    git_worktree_merge_into_default_impl(&repo_path, &worktree_path, commit_message.as_deref())
}
