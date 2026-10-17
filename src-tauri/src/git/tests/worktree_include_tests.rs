use super::*;
use crate::git::staging::*;
use crate::git::worktrees::git_worktree_add_impl;
use std::fs;
use std::path::Path;
use tempfile::TempDir;

#[test]
fn worktree_carries_over_default_ignored_files_and_directories() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let repo_dir = Path::new(&path);

    // Setup .gitignore
    fs::write(
        repo_dir.join(".gitignore"),
        ".env\n.env.*\n.codegraph/\nnode_modules/\n",
    )
    .unwrap();
    git_stage_impl(&path, &[".gitignore".to_string()]).unwrap();
    git_commit_impl(&path, "ignore files").unwrap();

    // Create ignored files in source repo
    fs::write(repo_dir.join(".env"), "SECRET=alpha").unwrap();
    fs::write(repo_dir.join(".env.local"), "LOCAL=beta").unwrap();

    // Create .codegraph directory with files and a socket/pid
    let codegraph_dir = repo_dir.join(".codegraph");
    fs::create_dir_all(&codegraph_dir).unwrap();
    fs::write(codegraph_dir.join("codegraph.db"), "sqlite-data").unwrap();
    fs::write(codegraph_dir.join("daemon.pid"), "12345").unwrap();

    // Create node_modules directory
    let node_modules_dir = repo_dir.join("node_modules").join("pkg");
    fs::create_dir_all(&node_modules_dir).unwrap();
    fs::write(node_modules_dir.join("index.js"), "module.exports = {};").unwrap();

    let wt = git_worktree_add_impl(&path, "agent-test").unwrap();
    let wt_path = Path::new(&wt.path);

    // 1. .env and .env.local must be copied
    assert_eq!(
        fs::read_to_string(wt_path.join(".env")).unwrap(),
        "SECRET=alpha"
    );
    assert_eq!(
        fs::read_to_string(wt_path.join(".env.local")).unwrap(),
        "LOCAL=beta"
    );

    // Edits in worktree must not modify the source repo
    fs::write(wt_path.join(".env"), "SECRET=changed").unwrap();
    assert_eq!(
        fs::read_to_string(repo_dir.join(".env")).unwrap(),
        "SECRET=alpha"
    );

    // 2. .codegraph DB must be copied, but .pid must NOT be copied
    assert_eq!(
        fs::read_to_string(wt_path.join(".codegraph").join("codegraph.db")).unwrap(),
        "sqlite-data"
    );
    assert!(!wt_path.join(".codegraph").join("daemon.pid").exists());

    // 3. node_modules must be symlinked
    assert!(wt_path.join("node_modules").is_symlink());
    assert_eq!(
        fs::read_to_string(wt_path.join("node_modules").join("pkg").join("index.js")).unwrap(),
        "module.exports = {};"
    );

    // 4. Carried over list must be reported
    assert!(wt.carried_over.contains(&".env (copied)".to_string()));
    assert!(wt.carried_over.contains(&".env.local (copied)".to_string()));
    assert!(wt.carried_over.contains(&".codegraph (copied)".to_string()));
    assert!(wt
        .carried_over
        .contains(&"node_modules (symlinked)".to_string()));
}

#[test]
fn worktree_skips_tracked_files_even_if_matching_defaults() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let repo_dir = Path::new(&path);

    // Commit a .env file (so it's tracked in git, not ignored)
    fs::write(repo_dir.join(".env"), "TRACKED=true").unwrap();
    git_stage_impl(&path, &[".env".to_string()]).unwrap();
    git_commit_impl(&path, "add tracked .env").unwrap();

    let wt = git_worktree_add_impl(&path, "tracked-test").unwrap();
    // Tracked .env was checked out by git worktree checkout, but should NOT be in carried_over
    assert!(!wt.carried_over.iter().any(|c| c.contains(".env")));
}

#[test]
fn worktree_skips_untracked_files_that_are_not_git_ignored() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let repo_dir = Path::new(&path);

    // .env is NOT in .gitignore, but created on disk
    fs::write(repo_dir.join(".env"), "SECRET=not-ignored").unwrap();

    let wt = git_worktree_add_impl(&path, "unignored-test").unwrap();
    let wt_path = Path::new(&wt.path);

    assert!(!wt_path.join(".env").exists());
    assert!(wt.carried_over.is_empty());
}

#[test]
fn worktree_skips_missing_entries_silently() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let repo_dir = Path::new(&path);

    fs::write(repo_dir.join(".gitignore"), ".env\n.codegraph/\n").unwrap();
    git_stage_impl(&path, &[".gitignore".to_string()]).unwrap();
    git_commit_impl(&path, "ignore").unwrap();

    // Only .env exists on disk, .codegraph and node_modules are missing
    fs::write(repo_dir.join(".env"), "SECRET=only-env").unwrap();

    let wt = git_worktree_add_impl(&path, "silent-missing-test").unwrap();
    assert_eq!(wt.carried_over, vec![".env (copied)".to_string()]);
}

#[test]
fn worktree_uses_auric_worktree_include_override() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let repo_dir = Path::new(&path);

    fs::write(repo_dir.join(".gitignore"), ".env\ncache/\ndeps/\n").unwrap();
    git_stage_impl(&path, &[".gitignore".to_string()]).unwrap();
    git_commit_impl(&path, "ignore").unwrap();

    fs::create_dir_all(repo_dir.join(".auric")).unwrap();
    fs::write(
        repo_dir.join(".auric").join("worktree-include"),
        "# Custom configuration\ncopy: cache\nsymlink: deps\n",
    )
    .unwrap();

    // Create ignored dirs
    let cache_dir = repo_dir.join("cache");
    fs::create_dir_all(&cache_dir).unwrap();
    fs::write(cache_dir.join("item.bin"), "cache-data").unwrap();

    let deps_dir = repo_dir.join("deps");
    fs::create_dir_all(&deps_dir).unwrap();
    fs::write(deps_dir.join("dep.bin"), "dep-data").unwrap();

    // Also create .env which would be in defaults, but .auric/worktree-include overrides defaults!
    fs::write(repo_dir.join(".env"), "IGNORED_BY_CUSTOM").unwrap();

    let wt = git_worktree_add_impl(&path, "custom-auric-test").unwrap();
    let wt_path = Path::new(&wt.path);

    // .env should NOT be carried over because custom config overrides defaults
    assert!(!wt_path.join(".env").exists());

    // cache was copied
    assert_eq!(
        fs::read_to_string(wt_path.join("cache").join("item.bin")).unwrap(),
        "cache-data"
    );
    assert!(!wt_path.join("cache").is_symlink());

    // deps was symlinked
    assert!(wt_path.join("deps").is_symlink());
    assert_eq!(
        fs::read_to_string(wt_path.join("deps").join("dep.bin")).unwrap(),
        "dep-data"
    );

    assert_eq!(
        wt.carried_over,
        vec!["cache (copied)".to_string(), "deps (symlinked)".to_string()]
    );
}

#[test]
fn worktree_uses_claude_worktreeinclude_fallback() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let repo_dir = Path::new(&path);

    fs::write(repo_dir.join(".gitignore"), ".env\nlocal.json\n").unwrap();
    git_stage_impl(&path, &[".gitignore".to_string()]).unwrap();
    git_commit_impl(&path, "ignore").unwrap();

    // Standard Claude Code .worktreeinclude (no mode prefix, defaults to copy)
    fs::write(repo_dir.join(".worktreeinclude"), ".env\nlocal.json\n").unwrap();
    fs::write(repo_dir.join(".env"), "SECRET=claude").unwrap();
    fs::write(repo_dir.join("local.json"), "{\"local\": true}").unwrap();

    let wt = git_worktree_add_impl(&path, "claude-include-test").unwrap();
    let wt_path = Path::new(&wt.path);

    assert_eq!(
        fs::read_to_string(wt_path.join(".env")).unwrap(),
        "SECRET=claude"
    );
    assert_eq!(
        fs::read_to_string(wt_path.join("local.json")).unwrap(),
        "{\"local\": true}"
    );
    assert_eq!(
        wt.carried_over,
        vec![
            ".env (copied)".to_string(),
            "local.json (copied)".to_string()
        ]
    );
}

#[test]
fn auric_worktree_include_takes_precedence_over_worktreeinclude() {
    let dir = TempDir::new().unwrap();
    let path = committed_repo(&dir);
    let repo_dir = Path::new(&path);

    fs::write(repo_dir.join(".gitignore"), "from-auric\nfrom-claude\n").unwrap();
    git_stage_impl(&path, &[".gitignore".to_string()]).unwrap();
    git_commit_impl(&path, "ignore").unwrap();

    fs::create_dir_all(repo_dir.join(".auric")).unwrap();
    fs::write(
        repo_dir.join(".auric").join("worktree-include"),
        "from-auric\n",
    )
    .unwrap();
    fs::write(repo_dir.join(".worktreeinclude"), "from-claude\n").unwrap();

    fs::write(repo_dir.join("from-auric"), "auric").unwrap();
    fs::write(repo_dir.join("from-claude"), "claude").unwrap();

    let wt = git_worktree_add_impl(&path, "precedence-test").unwrap();
    let wt_path = Path::new(&wt.path);

    assert!(wt_path.join("from-auric").exists());
    assert!(!wt_path.join("from-claude").exists());
    assert_eq!(wt.carried_over, vec!["from-auric (copied)".to_string()]);
}
