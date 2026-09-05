use crate::git::staging::*;
use crate::git::types::*;
use git2::{BranchType, Repository};
use std::fs;
use std::path::Path;
use std::process::Command as StdCommand;
use tempfile::TempDir;

/// A repo with one commit, ready for push tests.
pub(crate) fn committed_repo(dir: &TempDir) -> String {
    let path = dir.path().to_str().unwrap().to_string();
    let repo = Repository::init(&path).unwrap();
    let mut config = repo.config().unwrap();
    config.set_str("user.name", "Test").unwrap();
    config.set_str("user.email", "test@example.com").unwrap();
    fs::write(dir.path().join("a.txt"), "hi").unwrap();
    git_stage_impl(&path, &["a.txt".to_string()]).unwrap();
    git_commit_impl(&path, "init").unwrap();
    path
}

/// `git`, detached from any git environment the caller happens to be in.
pub(crate) fn git_command(dir: &std::path::Path) -> StdCommand {
    let mut command = StdCommand::new("git");
    command
        .current_dir(dir)
        .env_remove("GIT_DIR")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_OBJECT_DIRECTORY")
        .env_remove("GIT_ALTERNATE_OBJECT_DIRECTORIES")
        .env_remove("GIT_AUTHOR_NAME")
        .env_remove("GIT_AUTHOR_EMAIL")
        .env_remove("GIT_AUTHOR_DATE")
        .env_remove("GIT_COMMITTER_NAME")
        .env_remove("GIT_COMMITTER_EMAIL")
        .env_remove("GIT_COMMITTER_DATE");
    command
}

pub(crate) fn init_test_repo() -> TempDir {
    let dir = TempDir::new().unwrap();
    let path = dir.path();
    git_command(path).args(["init"]).output().unwrap();
    git_command(path)
        .args(["config", "user.email", "test@test.com"])
        .output()
        .unwrap();
    git_command(path)
        .args(["config", "user.name", "Test"])
        .output()
        .unwrap();
    dir
}

pub(crate) fn commit_file(dir: &TempDir, rel_path: &str, content: &str, message: &str) {
    let full = dir.path().join(rel_path);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&full, content).unwrap();
    git_command(dir.path()).args(["add", "."]).output().unwrap();
    git_command(dir.path())
        .args(["commit", "-m", message])
        .output()
        .unwrap();
}

pub(crate) fn find_status<'a>(rows: &'a [GitFileStatus], path: &str) -> &'a GitFileStatus {
    rows.iter()
        .find(|s| s.path == path)
        .unwrap_or_else(|| panic!("missing status for {path}"))
}

pub(crate) fn current_branch_name(repo_path: &str) -> String {
    Repository::open(repo_path)
        .unwrap()
        .head()
        .unwrap()
        .shorthand()
        .unwrap()
        .to_string()
}

pub(crate) fn add_remote_tracking(repo_path: &str, name: &str) {
    let repo = Repository::open(repo_path).unwrap();
    let oid = repo.head().unwrap().target().unwrap();
    repo.reference(&format!("refs/remotes/{name}"), oid, true, "test")
        .unwrap();
}

pub(crate) fn init_repo(path: &Path) {
    fs::create_dir_all(path).unwrap();
    git_command(path).args(["init"]).output().unwrap();
}

pub(crate) fn configure_repo_identity(path: &Path) {
    git_command(path)
        .args(["config", "user.email", "test@test.com"])
        .output()
        .unwrap();
    git_command(path)
        .args(["config", "user.name", "Test"])
        .output()
        .unwrap();
}

pub(crate) fn commit_all(path: &Path, message: &str) {
    git_command(path).args(["add", "."]).output().unwrap();
    git_command(path)
        .args(["commit", "-m", message])
        .output()
        .unwrap();
}

pub(crate) fn dirty_for(path: &str) -> bool {
    crate::git::status::git_projects_dirty_impl(&[path.to_string()])
        .into_iter()
        .find(|row| row.path == path)
        .expect("batch must echo every input path")
        .dirty
}

pub(crate) fn dirty_nested_repo_at(parent: &Path, name: &str) {
    let nested = parent.join(name);
    fs::create_dir(&nested).unwrap();
    let repo = Repository::init(&nested).unwrap();
    let mut config = repo.config().unwrap();
    config.set_str("user.name", "Test").unwrap();
    config.set_str("user.email", "test@example.com").unwrap();
    fs::write(nested.join("a.txt"), "hi").unwrap();
    git_stage_impl(nested.to_str().unwrap(), &["a.txt".to_string()]).unwrap();
    git_commit_impl(nested.to_str().unwrap(), "init").unwrap();
    fs::write(nested.join("a.txt"), "dirty").unwrap();
}

pub(crate) fn committed_origin_repo() -> TempDir {
    let origin = TempDir::new().unwrap();
    committed_repo(&origin);
    origin
}

pub(crate) fn add_submodule(parent: &Path, origin: &Path, name: &str) {
    let add = git_command(parent)
        .args(["submodule", "add", origin.to_str().unwrap(), name])
        .output()
        .unwrap();
    assert!(
        add.status.success(),
        "git submodule add failed: {}",
        String::from_utf8_lossy(&add.stderr)
    );
    git_command(parent)
        .args(["commit", "-m", "add submodule"])
        .output()
        .unwrap();
}

pub(crate) fn rename_head_branch(path: &str, new_name: &str) {
    let repo = Repository::open(path).unwrap();
    let current = repo.head().unwrap().shorthand().unwrap().to_string();
    if current == new_name {
        return;
    }
    {
        let mut branch = repo.find_branch(&current, BranchType::Local).unwrap();
        branch.rename(new_name, true).unwrap();
    }
    repo.set_head(&format!("refs/heads/{new_name}")).unwrap();
}

pub(crate) fn delete_local_branch(path: &str, name: &str) {
    let repo = Repository::open(path).unwrap();
    if let Ok(mut b) = repo.find_branch(name, BranchType::Local) {
        b.delete().unwrap();
    };
}

pub(crate) fn force_default_branch(path: &str, name: &str) {
    rename_head_branch(path, name);
    for other in ["main", "master"] {
        if other != name {
            delete_local_branch(path, other);
        }
    }
}

pub(crate) fn commit_in(repo_path: &str, file: &str, contents: &str, message: &str) {
    fs::write(Path::new(repo_path).join(file), contents).unwrap();
    git_stage_impl(repo_path, &[file.to_string()]).unwrap();
    git_commit_impl(repo_path, message).unwrap();
}

mod diff_tests;
mod discovery_tests;
mod log_tests;
mod staging_tests;
mod status_tests;
mod worktree_tests;
