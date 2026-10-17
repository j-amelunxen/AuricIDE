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
fn worktree_merge_conflict_on_main_starts_the_merge_in_place() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let wt = git_worktree_add_impl(&path, "clash").unwrap();
    commit_in(&path, "a.txt", "on main\n", "main edit");
    commit_in(&wt.path, "a.txt", "on worktree\n", "wt edit");
    let main_before = Repository::open(&path)
        .unwrap()
        .head()
        .unwrap()
        .target()
        .unwrap();

    let result = git_worktree_merge_into_default_impl(&path, &wt.path, None).unwrap();
    assert!(!result.merged);
    assert!(!result.cleaned_up);
    assert!(!result.fast_forward);
    assert_eq!(result.oid, None);
    assert_eq!(result.conflicts, vec!["a.txt".to_string()]);
    assert!(
        Path::new(&wt.path).exists(),
        "the worktree stays until concluded"
    );

    let repo = Repository::open(&path).unwrap();
    assert_eq!(repo.head().unwrap().target().unwrap(), main_before);
    assert_eq!(repo.state(), git2::RepositoryState::Merge);
    let state = crate::git::merge::git_merge_state_impl(&path).unwrap();
    assert_eq!(state.ours_label.as_deref(), Some("main"));
    assert_eq!(state.theirs_label, wt.branch);
    let on_disk = fs::read_to_string(Path::new(&path).join("a.txt")).unwrap();
    assert!(on_disk.contains("<<<<<<< main\n"), "{on_disk}");
}

#[test]
fn worktree_merge_conflict_elsewhere_says_how_to_resolve_it() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    force_default_branch(&path, "main");
    let wt = git_worktree_add_impl(&path, "clash").unwrap();
    commit_in(&path, "a.txt", "on main", "main edit");
    commit_in(&wt.path, "a.txt", "on worktree", "wt edit");
    let repo = Repository::open(&path).unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("side", &head, false).unwrap();
    repo.set_head("refs/heads/side").unwrap();

    let err = git_worktree_merge_into_default_impl(&path, &wt.path, None).unwrap_err();
    let branch = wt.branch.clone().unwrap();
    assert_eq!(
        err,
        format!(
            "merge conflict — check out main and merge {branch} to resolve it in the merge panel"
        )
    );
    assert!(Path::new(&wt.path).exists());
    assert_eq!(repo.state(), git2::RepositoryState::Clean);
}

#[test]
fn worktree_merge_rejects_a_path_we_did_not_create() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let err = git_worktree_merge_into_default_impl(&path, &path, None).unwrap_err();
    assert!(err.contains("Auric-managed"), "{err}");
}

#[test]
fn worktree_list_reports_branch_dirty_and_ahead_from_the_checkout() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "work").unwrap();
    commit_in(&wt.path, "b.txt", "from agent", "agent work");
    fs::write(Path::new(&wt.path).join("c.txt"), "uncommitted").unwrap();

    let listed = git_worktree_list_impl(&path).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].branch, wt.branch);
    assert!(listed[0].dirty);
    assert!(listed[0].branch_ahead);
}

#[test]
fn worktree_list_is_clean_and_not_ahead_right_after_add() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    git_worktree_add_impl(&path, "fresh").unwrap();

    let listed = git_worktree_list_impl(&path).unwrap();
    assert_eq!(listed.len(), 1);
    assert!(!listed[0].dirty);
    assert!(!listed[0].branch_ahead);
    assert!(listed[0].is_auric);
}

#[test]
fn remove_unless_work_removes_an_untouched_worktree_and_its_branch() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "idle").unwrap();

    let outcome = git_worktree_remove_unless_work_impl(&wt.path).unwrap();
    assert!(outcome.removed);
    assert!(!outcome.dirty && !outcome.branch_ahead);
    assert_eq!(outcome.branch, wt.branch);
    assert!(!Path::new(&wt.path).exists());
    let repo = Repository::open(&path).unwrap();
    assert!(repo
        .find_branch(wt.branch.as_deref().unwrap(), git2::BranchType::Local)
        .is_err());
}

#[test]
fn remove_unless_work_keeps_a_worktree_with_uncommitted_changes() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "dirty").unwrap();
    fs::write(Path::new(&wt.path).join("a.txt"), "changed").unwrap();

    let outcome = git_worktree_remove_unless_work_impl(&wt.path).unwrap();
    assert!(!outcome.removed);
    assert!(outcome.dirty);
    assert!(Path::new(&wt.path).exists());
}

#[test]
fn remove_unless_work_keeps_a_worktree_with_unmerged_commits() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let wt = git_worktree_add_impl(&path, "ahead").unwrap();
    commit_in(&wt.path, "b.txt", "from agent", "agent work");

    let outcome = git_worktree_remove_unless_work_impl(&wt.path).unwrap();
    assert!(!outcome.removed);
    assert!(!outcome.dirty);
    assert!(outcome.branch_ahead);
    assert!(Path::new(&wt.path).exists());
    assert_eq!(git_worktree_list_impl(&path).unwrap().len(), 1);
}

#[test]
fn remove_unless_work_refuses_a_folder_that_is_no_auric_worktree() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let err = git_worktree_remove_unless_work_impl(&path).unwrap_err();
    assert!(err.contains("Auric-managed"), "{err}");
    assert!(Path::new(&path).join("a.txt").is_file());
}
