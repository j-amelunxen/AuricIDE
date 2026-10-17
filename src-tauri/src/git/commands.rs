use super::blame::git_blame_impl;
use super::diff::{
    git_diff_commit_impl, git_diff_file_ref_impl, git_diff_impl, git_diff_ref_files_impl,
};
use super::discard::git_discard_impl;
use super::discovery::git_discover_repos_impl;
use super::log::{git_list_branches_impl, git_log_since_impl};
use super::merge::{
    git_apply_patch_impl, git_conflict_file_impl, git_conflict_origins_impl, git_merge_abort_impl,
    git_merge_base_impl, git_merge_branch_impl, git_merge_conclude_impl, git_merge_preview_impl,
    git_merge_state_impl, git_resolve_conflict_impl, git_resolve_conflict_side_impl,
};
use super::operation_step::{git_operation_step_impl, OPERATION_STEP_TIMEOUT};
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
    push: Option<bool>,
) -> Result<WorktreeMergeResult, String> {
    git_worktree_merge_into_default_impl(
        &repo_path,
        &worktree_path,
        commit_message.as_deref(),
        push.unwrap_or(false),
    )
}

#[tauri::command(async)]
pub fn git_merge_state(repo_path: String) -> Result<GitMergeState, String> {
    git_merge_state_impl(&repo_path)
}

#[tauri::command(async)]
pub fn git_conflict_file(repo_path: String, file_path: String) -> Result<GitConflictFile, String> {
    git_conflict_file_impl(&repo_path, &file_path)
}

#[tauri::command(async)]
pub fn git_conflict_origins(
    repo_path: String,
    file_path: String,
) -> Result<GitConflictOrigins, String> {
    git_conflict_origins_impl(&repo_path, &file_path)
}

#[tauri::command(async)]
pub fn git_resolve_conflict(
    repo_path: String,
    file_path: String,
    content: Option<String>,
) -> Result<(), String> {
    git_resolve_conflict_impl(&repo_path, &file_path, content.as_deref())
}

#[tauri::command(async)]
pub fn git_resolve_conflict_side(
    repo_path: String,
    file_path: String,
    side: String,
) -> Result<(), String> {
    git_resolve_conflict_side_impl(&repo_path, &file_path, &side)
}

#[tauri::command(async)]
pub fn git_merge_abort(repo_path: String) -> Result<(), String> {
    git_merge_abort_impl(&repo_path)
}

#[tauri::command(async)]
pub fn git_merge_conclude(repo_path: String, message: String) -> Result<String, String> {
    git_merge_conclude_impl(&repo_path, &message)
}

#[tauri::command(async)]
pub fn git_merge_branch(repo_path: String, branch: String) -> Result<GitMergeStartResult, String> {
    git_merge_branch_impl(&repo_path, &branch)
}

#[tauri::command(async)]
pub fn git_merge_preview(repo_path: String, branch: String) -> Result<GitMergePreview, String> {
    git_merge_preview_impl(&repo_path, &branch)
}

/// Runs the real git, resolved through the login shell's PATH: an app
/// launched from `/Applications` has no Homebrew git on its own PATH.
#[tauri::command]
pub async fn git_operation_step(
    repo_path: String,
    action: String,
) -> Result<GitOperationStepResult, String> {
    let git = crate::video_import::preflight::resolve_executable("git")
        .await
        .ok_or_else(|| "git was not found on this machine; install it to continue".to_string())?;
    let env = crate::agents::cached_login_shell_env().await;
    git_operation_step_impl(&repo_path, &action, &git, env, OPERATION_STEP_TIMEOUT).await
}

#[tauri::command(async)]
pub fn git_apply_patch(
    repo_path: String,
    patch: String,
    target: String,
    guard: Option<ApplyPatchGuard>,
) -> Result<(), String> {
    git_apply_patch_impl(&repo_path, &patch, &target, guard.as_ref())
}

#[tauri::command(async)]
pub fn git_merge_base(repo_path: String, a: String, b: String) -> Result<String, String> {
    git_merge_base_impl(&repo_path, &a, &b)
}
