use super::*;
use crate::git::discovery::primary_project_path;
use crate::git::worktrees::*;
use git2::Repository;
use tempfile::TempDir;

#[test]
fn worktree_add_checks_out_a_sibling_auric_branch() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "Fix login!!!").unwrap();

    assert!(wt.is_auric);
    assert!(!wt.dirty);
    assert!(!wt.branch_ahead);
    assert!(wt.path.contains(".auric-wt"));
    assert!(wt
        .branch
        .as_deref()
        .unwrap()
        .starts_with("auric/fix-login-"));
    assert!(Path::new(&wt.path).join("a.txt").is_file());
    assert_eq!(
        fs::canonicalize(&wt.source_repo).unwrap(),
        fs::canonicalize(&path).unwrap()
    );

    let listed = git_worktree_list_impl(&path).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].path, wt.path);
}

#[test]
fn worktree_list_hides_foreign_worktrees() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let repo = Repository::open(&path).unwrap();
    let foreign = dir.path().join("foreign-wt");
    repo.worktree("foreign", &foreign, None).unwrap();

    assert!(git_worktree_list_impl(&path).unwrap().is_empty());
}

#[test]
fn worktree_remove_refuses_a_dirty_checkout_until_forced() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "edit").unwrap();
    fs::write(Path::new(&wt.path).join("a.txt"), "dirty").unwrap();

    let err = git_worktree_remove_impl(&path, &wt.path, false).unwrap_err();
    assert!(err.contains("uncommitted"), "{err}");
    assert!(Path::new(&wt.path).exists());

    git_worktree_remove_impl(&path, &wt.path, true).unwrap();
    assert!(!Path::new(&wt.path).exists());
    assert!(git_worktree_list_impl(&path).unwrap().is_empty());
}

#[test]
fn worktree_remove_rejects_a_path_we_did_not_create() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let err = git_worktree_remove_impl(&path, &path, true).unwrap_err();
    assert!(err.contains("Auric-managed"), "{err}");
}

#[test]
fn worktree_add_needs_a_commit() {
    let dir = TempDir::new().unwrap();
    Repository::init(dir.path()).unwrap();
    let err = git_worktree_add_impl(dir.path().to_str().unwrap(), "x").unwrap_err();
    assert!(err.contains("HEAD"), "{err}");
}

#[test]
fn primary_project_path_resolves_a_worktree_to_the_main_checkout() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "policy").unwrap();
    let resolved = primary_project_path(Path::new(&wt.path)).unwrap();
    assert_eq!(
        fs::canonicalize(&resolved).unwrap(),
        fs::canonicalize(&path).unwrap()
    );
}

#[test]
fn default_branch_is_main_or_master_from_the_repo() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    assert_eq!(git_default_branch_impl(&path).unwrap(), "main");

    force_default_branch(&path, "master");
    assert_eq!(git_default_branch_impl(&path).unwrap(), "master");
}

#[test]
fn default_branch_prefers_main_when_both_exist() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let repo = Repository::open(&path).unwrap();
    let commit = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("master", &commit, false).unwrap();
    assert_eq!(git_default_branch_impl(&path).unwrap(), "main");
}

#[test]
fn worktree_merge_fast_forwards_main_and_removes_the_checkout() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let wt = git_worktree_add_impl(&path, "feat").unwrap();
    commit_in(&wt.path, "b.txt", "from agent", "agent work");

    let result = git_worktree_merge_into_default_impl(&path, &wt.path, None).unwrap();
    assert_eq!(result.default_branch, "main");
    assert!(result.merged);
    assert!(result.fast_forward);
    assert!(result.cleaned_up);
    assert!(!Path::new(&wt.path).exists());
    assert_eq!(
        fs::read_to_string(Path::new(&path).join("b.txt")).unwrap(),
        "from agent"
    );
    assert!(git_worktree_list_impl(&path).unwrap().is_empty());
}

#[test]
fn worktree_merge_commits_dirty_files_first() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "master");
    let wt = git_worktree_add_impl(&path, "dirty").unwrap();
    fs::write(Path::new(&wt.path).join("c.txt"), "leftover").unwrap();

    let result =
        git_worktree_merge_into_default_impl(&path, &wt.path, Some("Agent work: Writer")).unwrap();
    assert_eq!(result.default_branch, "master");
    assert!(result.merged);
    assert!(result.cleaned_up);
    assert_eq!(
        fs::read_to_string(Path::new(&path).join("c.txt")).unwrap(),
        "leftover"
    );
}

#[test]
fn worktree_merge_refuses_a_conflict_and_keeps_the_worktree() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let wt = git_worktree_add_impl(&path, "clash").unwrap();
    commit_in(&path, "a.txt", "on main", "main edit");
    commit_in(&wt.path, "a.txt", "on worktree", "wt edit");

    let err = git_worktree_merge_into_default_impl(&path, &wt.path, None).unwrap_err();
    assert!(err.contains("conflict"), "{err}");
    assert!(Path::new(&wt.path).exists());
}

#[test]
fn worktree_merge_rejects_a_path_we_did_not_create() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let err = git_worktree_merge_into_default_impl(&path, &path, None).unwrap_err();
    assert!(err.contains("Auric-managed"), "{err}");
}
