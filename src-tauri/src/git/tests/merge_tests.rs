use super::*;
use crate::git::merge::*;
use crate::git::status::git_status_impl;
use git2::Repository;
use std::process::Output;
use tempfile::TempDir;

const BASE: &str = "line1\nbase\nline3\n";

fn git(dir: &Path, args: &[&str]) -> Output {
    git_command(dir).args(args).output().unwrap()
}

fn git_ok(dir: &Path, args: &[&str]) -> String {
    let out = git(dir, args);
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// A repo on `main` with one commit of `files`, and a `feature` branch at the
/// same commit. HEAD stays on `main`.
fn repo_with(files: &[(&str, &[u8])]) -> TempDir {
    let dir = init_test_repo();
    git_ok(dir.path(), &["symbolic-ref", "HEAD", "refs/heads/main"]);
    for (name, content) in files {
        fs::write(dir.path().join(name), content).unwrap();
    }
    fs::write(dir.path().join("other.txt"), "untouched\n").unwrap();
    git_ok(dir.path(), &["add", "."]);
    git_ok(dir.path(), &["commit", "-qm", "base"]);
    git_ok(dir.path(), &["branch", "feature"]);
    dir
}

/// Runs `edit` on `branch` and commits the result, then returns to `main`.
fn commit_on(dir: &TempDir, branch: &str, edit: impl FnOnce(&Path)) {
    git_ok(dir.path(), &["checkout", "-q", branch]);
    edit(dir.path());
    git_ok(dir.path(), &["add", "-A"]);
    git_ok(dir.path(), &["commit", "-qm", &format!("on {branch}")]);
    git_ok(dir.path(), &["checkout", "-q", "main"]);
}

fn write(path: &Path, name: &str, content: &str) {
    fs::write(path.join(name), content).unwrap();
}

/// `a.txt` changed differently on both sides; `git merge feature` stopped.
fn terminal_conflict() -> TempDir {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    commit_on(&dir, "feature", |p| {
        write(p, "a.txt", "line1\ntheirs\nline3\n")
    });
    commit_on(&dir, "main", |p| write(p, "a.txt", "line1\nours\nline3\n"));
    let out = git(dir.path(), &["merge", "feature"]);
    assert!(!out.status.success(), "the fixture must conflict");
    dir
}

fn p(dir: &TempDir) -> &str {
    dir.path().to_str().unwrap()
}

fn kinds(state: &GitMergeState) -> Vec<(&str, &str)> {
    state
        .conflicts
        .iter()
        .map(|c| (c.path.as_str(), c.kind.as_str()))
        .collect()
}

fn head_oid(dir: &TempDir) -> String {
    git_ok(dir.path(), &["rev-parse", "HEAD"])
        .trim()
        .to_string()
}

fn merge_head_exists(dir: &TempDir) -> bool {
    dir.path().join(".git").join("MERGE_HEAD").exists()
}

// ---------- git_merge_state ----------

#[test]
fn merge_state_is_none_on_a_clean_repo_and_outside_a_repo() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    let state = git_merge_state_impl(p(&dir)).unwrap();
    assert!(!state.in_progress);
    assert_eq!(state.operation, "none");
    assert_eq!(state.ours_label.as_deref(), Some("main"));
    assert_eq!(state.theirs_label, None);
    assert_eq!(state.message, None);
    assert!(state.conflicts.is_empty());

    let nowhere = TempDir::new().unwrap();
    let state = git_merge_state_impl(p(&nowhere)).unwrap();
    assert!(!state.in_progress);
    assert_eq!(state.operation, "none");
    assert_eq!(state.ours_label, None);
}

#[test]
fn merge_state_reports_a_terminal_merge_with_branch_labels() {
    let dir = terminal_conflict();
    let feature = git_ok(dir.path(), &["rev-parse", "feature"])
        .trim()
        .to_string();

    let state = git_merge_state_impl(p(&dir)).unwrap();
    assert!(state.in_progress);
    assert_eq!(state.operation, "merge");
    assert_eq!(state.ours_label.as_deref(), Some("main"));
    assert_eq!(state.theirs_label.as_deref(), Some("feature"));
    assert_eq!(state.theirs_oid.as_deref(), Some(feature.as_str()));
    let message = state.message.as_deref().unwrap();
    assert!(message.starts_with("Merge branch 'feature'"), "{message}");
    assert!(!message.lines().any(|l| l.starts_with('#')), "{message}");
    assert_eq!(kinds(&state), vec![("a.txt", "content")]);
}

#[test]
fn merge_state_labels_a_detached_head_by_short_oid() {
    let dir = terminal_conflict();
    git_ok(dir.path(), &["merge", "--abort"]);
    let main = head_oid(&dir);
    git_ok(dir.path(), &["checkout", "-q", "--detach"]);
    let state = git_merge_state_impl(p(&dir)).unwrap();
    assert_eq!(state.ours_label.as_deref(), Some(&main[..7]));
}

#[test]
fn merge_state_falls_back_to_the_short_merge_head_oid() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    commit_on(&dir, "feature", |p| {
        write(p, "a.txt", "line1\ntheirs\nline3\n")
    });
    commit_on(&dir, "main", |p| write(p, "a.txt", "line1\nours\nline3\n"));
    let feature = git_ok(dir.path(), &["rev-parse", "feature"])
        .trim()
        .to_string();
    // Merging by oid writes "Merge commit '<oid>'" — no branch to name.
    let out = git(dir.path(), &["merge", &feature]);
    assert!(!out.status.success());

    let state = git_merge_state_impl(p(&dir)).unwrap();
    assert_eq!(state.theirs_label.as_deref(), Some(&feature[..7]));
}

#[test]
fn branch_is_read_from_every_merge_msg_shape_git_writes() {
    assert_eq!(
        branch_from_merge_msg("Merge branch 'feature/x'\n\n# Conflicts:\n#\ta.txt\n"),
        Some("feature/x".to_string())
    );
    assert_eq!(
        branch_from_merge_msg("Merge branch 'feature' into develop\n"),
        Some("feature".to_string())
    );
    assert_eq!(
        branch_from_merge_msg("Merge remote-tracking branch 'origin/x'\n"),
        Some("origin/x".to_string())
    );
    assert_eq!(branch_from_merge_msg("Merge commit 'abc1234'\n"), None);
    assert_eq!(branch_from_merge_msg("Merge branch 'unterminated\n"), None);
    assert_eq!(branch_from_merge_msg(""), None);
}

#[test]
fn merge_state_names_each_conflict_kind() {
    let dir = repo_with(&[
        ("both.txt", BASE.as_bytes()),
        ("gone-here.txt", BASE.as_bytes()),
        ("gone-there.txt", BASE.as_bytes()),
        ("image.bin", b"\x00\x01base"),
    ]);
    commit_on(&dir, "feature", |p| {
        write(p, "both.txt", "line1\ntheirs\nline3\n");
        write(p, "gone-here.txt", "line1\ntheirs\nline3\n");
        fs::remove_file(p.join("gone-there.txt")).unwrap();
        fs::write(p.join("image.bin"), b"\x00\x01theirs").unwrap();
        write(p, "new.txt", "theirs new\n");
    });
    commit_on(&dir, "main", |p| {
        write(p, "both.txt", "line1\nours\nline3\n");
        fs::remove_file(p.join("gone-here.txt")).unwrap();
        write(p, "gone-there.txt", "line1\nours\nline3\n");
        fs::write(p.join("image.bin"), b"\x00\x01ours").unwrap();
        write(p, "new.txt", "ours new\n");
    });
    assert!(!git(dir.path(), &["merge", "feature"]).status.success());

    let state = git_merge_state_impl(p(&dir)).unwrap();
    assert_eq!(
        kinds(&state),
        vec![
            ("both.txt", "content"),
            ("gone-here.txt", "deleted-by-us"),
            ("gone-there.txt", "deleted-by-them"),
            ("image.bin", "binary"),
            ("new.txt", "both-added"),
        ]
    );
}

#[test]
fn git_status_labels_a_conflicted_file() {
    let dir = terminal_conflict();
    let rows = git_status_impl(p(&dir)).unwrap();
    let row = find_status(&rows, "a.txt");
    assert_eq!(row.status, "conflicted");
    assert_eq!(row.staged, None);
    assert_eq!(row.unstaged.as_deref(), Some("conflicted"));
}

// ---------- git_conflict_file ----------

#[test]
fn conflict_file_returns_diff3_text_with_branch_labels() {
    let dir = terminal_conflict();
    let file = git_conflict_file_impl(p(&dir), "a.txt").unwrap();
    assert_eq!(file.kind, "content");
    assert_eq!(file.base.as_deref(), Some(BASE));
    assert_eq!(file.ours.as_deref(), Some("line1\nours\nline3\n"));
    assert_eq!(file.theirs.as_deref(), Some("line1\ntheirs\nline3\n"));
    assert_eq!(file.ours_label, "main");
    assert_eq!(file.theirs_label, "feature");
    assert_eq!(
        file.merged.as_deref(),
        Some(
            "line1\n<<<<<<< main\nours\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> feature\nline3\n"
        )
    );
}

#[test]
fn conflict_file_does_not_touch_the_work_tree_or_the_index() {
    let dir = terminal_conflict();
    let before = fs::read_to_string(dir.path().join("a.txt")).unwrap();
    git_conflict_file_impl(p(&dir), "a.txt").unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        before
    );
    let state = git_merge_state_impl(p(&dir)).unwrap();
    assert_eq!(kinds(&state), vec![("a.txt", "content")]);
}

#[test]
fn conflict_file_for_a_delete_has_no_merged_text() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    commit_on(&dir, "feature", |p| {
        fs::remove_file(p.join("a.txt")).unwrap()
    });
    commit_on(&dir, "main", |p| write(p, "a.txt", "line1\nours\nline3\n"));
    assert!(!git(dir.path(), &["merge", "feature"]).status.success());

    let file = git_conflict_file_impl(p(&dir), "a.txt").unwrap();
    assert_eq!(file.kind, "deleted-by-them");
    assert_eq!(file.ours.as_deref(), Some("line1\nours\nline3\n"));
    assert_eq!(file.theirs, None);
    assert_eq!(file.base.as_deref(), Some(BASE));
    assert_eq!(file.merged, None);
}

#[test]
fn conflict_file_for_a_both_added_file_merges_without_a_base() {
    let dir = repo_with(&[]);
    commit_on(&dir, "feature", |p| write(p, "n.txt", "theirs\n"));
    commit_on(&dir, "main", |p| write(p, "n.txt", "ours\n"));
    assert!(!git(dir.path(), &["merge", "feature"]).status.success());

    let file = git_conflict_file_impl(p(&dir), "n.txt").unwrap();
    assert_eq!(file.kind, "both-added");
    assert_eq!(file.base, None);
    let merged = file.merged.unwrap();
    assert!(merged.contains("<<<<<<< main\nours\n"), "{merged}");
    assert!(merged.contains(">>>>>>> feature\n"), "{merged}");
}

#[test]
fn conflict_file_for_a_binary_file_has_no_text() {
    let dir = repo_with(&[("b.bin", b"\x00base")]);
    commit_on(&dir, "feature", |p| {
        fs::write(p.join("b.bin"), b"\x00theirs").unwrap()
    });
    commit_on(&dir, "main", |p| {
        fs::write(p.join("b.bin"), b"\x00ours").unwrap()
    });
    assert!(!git(dir.path(), &["merge", "feature"]).status.success());

    let file = git_conflict_file_impl(p(&dir), "b.bin").unwrap();
    assert_eq!(file.kind, "binary");
    assert_eq!(
        (file.base, file.ours, file.theirs, file.merged),
        (None, None, None, None)
    );
}

#[test]
fn conflict_file_refuses_a_path_without_a_conflict() {
    let dir = terminal_conflict();
    let err = git_conflict_file_impl(p(&dir), "other.txt").unwrap_err();
    assert!(
        err.contains("other.txt") && err.contains("no conflict"),
        "{err}"
    );
}

// ---------- git_resolve_conflict ----------

#[test]
fn resolve_writes_the_file_and_clears_the_conflict() {
    let dir = terminal_conflict();
    git_resolve_conflict_impl(p(&dir), "a.txt", Some("line1\nresolved\nline3\n")).unwrap();

    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "line1\nresolved\nline3\n"
    );
    let state = git_merge_state_impl(p(&dir)).unwrap();
    assert!(state.conflicts.is_empty());
    assert!(state.in_progress, "resolving a file must not end the merge");
    let rows = git_status_impl(p(&dir)).unwrap();
    let row = find_status(&rows, "a.txt");
    assert_eq!(row.staged.as_deref(), Some("modified"));
    assert_eq!(row.unstaged, None);
}

#[test]
fn resolve_with_null_deletes_the_file_from_disk_and_index() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    commit_on(&dir, "feature", |p| {
        fs::remove_file(p.join("a.txt")).unwrap()
    });
    commit_on(&dir, "main", |p| write(p, "a.txt", "line1\nours\nline3\n"));
    assert!(!git(dir.path(), &["merge", "feature"]).status.success());

    git_resolve_conflict_impl(p(&dir), "a.txt", None).unwrap();
    assert!(!dir.path().join("a.txt").exists());
    assert!(git_merge_state_impl(p(&dir)).unwrap().conflicts.is_empty());
    let rows = git_status_impl(p(&dir)).unwrap();
    assert_eq!(
        find_status(&rows, "a.txt").staged.as_deref(),
        Some("deleted")
    );
}

#[test]
fn resolve_refuses_paths_that_escape_the_repo_or_are_not_conflicted() {
    let dir = terminal_conflict();
    let outside = dir.path().parent().unwrap().join("escaped.txt");
    for bad in [
        "../escaped.txt",
        "sub/../../escaped.txt",
        outside.to_str().unwrap(),
        "",
        ".git/config",
    ] {
        let err = git_resolve_conflict_impl(p(&dir), bad, Some("x")).unwrap_err();
        assert!(!err.is_empty(), "{bad} must be refused");
    }
    assert!(!outside.exists());

    let err = git_resolve_conflict_impl(p(&dir), "other.txt", Some("x")).unwrap_err();
    assert!(err.contains("no conflict"), "{err}");
    assert_eq!(
        fs::read_to_string(dir.path().join("other.txt")).unwrap(),
        "untouched\n"
    );
}

// ---------- git_merge_conclude ----------

#[test]
fn conclude_refuses_while_a_conflict_is_left() {
    let dir = terminal_conflict();
    let err = git_merge_conclude_impl(p(&dir), "done").unwrap_err();
    assert!(err.contains("1 conflict"), "{err}");
    assert!(merge_head_exists(&dir));
}

#[test]
fn conclude_refuses_without_a_merge() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    let err = git_merge_conclude_impl(p(&dir), "done").unwrap_err();
    assert!(err.contains("no merge"), "{err}");
}

#[test]
fn conclude_commits_with_both_parents_and_clears_the_state() {
    let dir = terminal_conflict();
    let main = head_oid(&dir);
    let feature = git_ok(dir.path(), &["rev-parse", "feature"])
        .trim()
        .to_string();
    git_resolve_conflict_impl(p(&dir), "a.txt", Some("line1\nboth\nline3\n")).unwrap();

    let oid = git_merge_conclude_impl(p(&dir), "Merge branch 'feature'").unwrap();
    assert_eq!(oid, head_oid(&dir));
    let parents = git_ok(dir.path(), &["log", "-1", "--format=%P"]);
    assert_eq!(parents.trim(), format!("{main} {feature}"));
    assert_eq!(
        git_ok(dir.path(), &["log", "-1", "--format=%s"]).trim(),
        "Merge branch 'feature'"
    );
    assert!(!merge_head_exists(&dir));
    let state = git_merge_state_impl(p(&dir)).unwrap();
    assert!(!state.in_progress);
    assert_eq!(state.operation, "none");
    assert_eq!(git_ok(dir.path(), &["status", "--porcelain"]), "");
}

// ---------- git_merge_abort ----------

#[test]
fn abort_restores_merged_paths_and_keeps_unrelated_edits() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes()), ("clean.txt", BASE.as_bytes())]);
    commit_on(&dir, "feature", |p| {
        write(p, "a.txt", "line1\ntheirs\nline3\n");
        write(p, "clean.txt", "line1\nfrom feature\nline3\n");
        write(p, "added.txt", "new on feature\n");
    });
    commit_on(&dir, "main", |p| write(p, "a.txt", "line1\nours\nline3\n"));
    let main = head_oid(&dir);
    // Start the merge through git2, then touch a file the merge did not.
    let repo = Repository::open(dir.path()).unwrap();
    let feature = repo.find_reference("refs/heads/feature").unwrap();
    let annotated = repo.reference_to_annotated_commit(&feature).unwrap();
    repo.merge(&[&annotated], None, None).unwrap();
    write(dir.path(), "other.txt", "my unrelated edit\n");
    assert!(merge_head_exists(&dir));

    git_merge_abort_impl(p(&dir)).unwrap();

    assert_eq!(head_oid(&dir), main);
    assert!(!merge_head_exists(&dir));
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "line1\nours\nline3\n"
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("clean.txt")).unwrap(),
        BASE
    );
    assert!(!dir.path().join("added.txt").exists());
    assert_eq!(
        fs::read_to_string(dir.path().join("other.txt")).unwrap(),
        "my unrelated edit\n",
        "abort is reset --merge, not reset --hard"
    );
    assert_eq!(
        git_ok(dir.path(), &["status", "--porcelain"]),
        " M other.txt\n"
    );
    assert_eq!(git_merge_state_impl(p(&dir)).unwrap().operation, "none");
}

#[test]
fn abort_refuses_without_a_merge() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    let err = git_merge_abort_impl(p(&dir)).unwrap_err();
    assert!(err.contains("no merge"), "{err}");
}

// ---------- git_merge_branch ----------

#[test]
fn merge_branch_reports_up_to_date() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    let before = head_oid(&dir);
    let result = git_merge_branch_impl(p(&dir), "feature").unwrap();
    assert_eq!(result.outcome, "up-to-date");
    assert!(result.conflicts.is_empty());
    assert_eq!(head_oid(&dir), before);
}

#[test]
fn merge_branch_fast_forwards() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    commit_on(&dir, "feature", |p| {
        write(p, "a.txt", "line1\ntheirs\nline3\n")
    });
    let feature = git_ok(dir.path(), &["rev-parse", "feature"])
        .trim()
        .to_string();

    let result = git_merge_branch_impl(p(&dir), "feature").unwrap();
    assert_eq!(result.outcome, "fast-forward");
    assert_eq!(result.oid.as_deref(), Some(feature.as_str()));
    assert_eq!(head_oid(&dir), feature);
    assert_eq!(current_branch_name(p(&dir)), "main");
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "line1\ntheirs\nline3\n"
    );
    assert_eq!(git_ok(dir.path(), &["status", "--porcelain"]), "");
}

#[test]
fn merge_branch_commits_a_clean_merge() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    commit_on(&dir, "feature", |p| write(p, "b.txt", "theirs\n"));
    commit_on(&dir, "main", |p| write(p, "c.txt", "ours\n"));
    let main = head_oid(&dir);
    let feature = git_ok(dir.path(), &["rev-parse", "feature"])
        .trim()
        .to_string();

    let result = git_merge_branch_impl(p(&dir), "feature").unwrap();
    assert_eq!(result.outcome, "merged");
    assert_eq!(result.oid.as_deref(), Some(head_oid(&dir).as_str()));
    assert_eq!(
        git_ok(dir.path(), &["log", "-1", "--format=%P"]).trim(),
        format!("{main} {feature}")
    );
    assert_eq!(
        git_ok(dir.path(), &["log", "-1", "--format=%s"]).trim(),
        "Merge branch 'feature' into main"
    );
    assert!(dir.path().join("b.txt").exists());
    assert!(!merge_head_exists(&dir));
    assert_eq!(git_ok(dir.path(), &["status", "--porcelain"]), "");
}

#[test]
fn merge_branch_leaves_a_conflict_in_progress_with_diff3_markers() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    commit_on(&dir, "feature", |p| {
        write(p, "a.txt", "line1\ntheirs\nline3\n")
    });
    commit_on(&dir, "main", |p| write(p, "a.txt", "line1\nours\nline3\n"));
    let main = head_oid(&dir);

    let result = git_merge_branch_impl(p(&dir), "feature").unwrap();
    assert_eq!(result.outcome, "conflicts");
    assert_eq!(result.oid, None);
    assert_eq!(result.conflicts, vec!["a.txt".to_string()]);
    assert_eq!(head_oid(&dir), main);
    assert!(merge_head_exists(&dir));

    let on_disk = fs::read_to_string(dir.path().join("a.txt")).unwrap();
    assert!(on_disk.contains("<<<<<<< main\n"), "{on_disk}");
    assert!(on_disk.contains("||||||| "), "{on_disk}");
    assert!(on_disk.contains(">>>>>>> feature\n"), "{on_disk}");

    let state = git_merge_state_impl(p(&dir)).unwrap();
    assert_eq!(state.operation, "merge");
    assert_eq!(state.theirs_label.as_deref(), Some("feature"));
    // Real git sees the same merge the IDE started.
    let status = git_ok(dir.path(), &["status", "--porcelain"]);
    assert_eq!(status, "UU a.txt\n");
}

#[test]
fn merge_branch_refuses_tracked_changes_but_not_untracked_files() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    commit_on(&dir, "feature", |p| write(p, "b.txt", "theirs\n"));
    commit_on(&dir, "main", |p| write(p, "c.txt", "ours\n"));

    write(dir.path(), "a.txt", "dirty\n");
    let err = git_merge_branch_impl(p(&dir), "feature").unwrap_err();
    assert!(err.contains("uncommitted"), "{err}");
    assert!(!merge_head_exists(&dir));

    git_ok(dir.path(), &["add", "a.txt"]);
    let err = git_merge_branch_impl(p(&dir), "feature").unwrap_err();
    assert!(err.contains("uncommitted"), "{err}");

    git_ok(dir.path(), &["reset", "-q", "--hard"]);
    write(dir.path(), "scratch.txt", "untracked\n");
    let result = git_merge_branch_impl(p(&dir), "feature").unwrap();
    assert_eq!(result.outcome, "merged");
    assert!(dir.path().join("scratch.txt").exists());
}

#[test]
fn merge_branch_refuses_during_a_merge_and_for_an_unknown_branch() {
    let dir = terminal_conflict();
    let err = git_merge_branch_impl(p(&dir), "feature").unwrap_err();
    assert!(err.contains("already in progress"), "{err}");

    let clean = repo_with(&[("a.txt", BASE.as_bytes())]);
    let err = git_merge_branch_impl(p(&clean), "nope").unwrap_err();
    assert!(err.contains("nope"), "{err}");
}

// ---------- git_apply_patch ----------

fn twenty_lines(changed: &[(usize, &str)]) -> String {
    (1..=20)
        .map(|i| {
            changed
                .iter()
                .find(|(n, _)| *n == i)
                .map(|(_, s)| s.to_string())
                .unwrap_or_else(|| format!("line {i}"))
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

/// File header + the `index`-th `@@` hunk of a single-file patch.
fn one_hunk(patch: &str, index: usize) -> String {
    let mut header = String::new();
    let mut hunks: Vec<String> = Vec::new();
    for line in patch.split_inclusive('\n') {
        if line.starts_with("@@") {
            hunks.push(String::new());
        }
        match hunks.last_mut() {
            Some(h) => h.push_str(line),
            None => header.push_str(line),
        }
    }
    header + &hunks[index]
}

/// The test-side twin of the TS `reversePatch`, enough for a modify hunk.
/// Within each run of changes the removals must come first again: libgit2
/// refuses a `-` line after a `+` line that carries `\ No newline`.
fn reverse(patch: &str) -> String {
    let mut out = String::new();
    let (mut removed, mut added) = (String::new(), String::new());
    let mut last_was_added = false;
    let flush = |out: &mut String, removed: &mut String, added: &mut String| {
        out.push_str(removed);
        out.push_str(added);
        removed.clear();
        added.clear();
    };
    for line in patch.split_inclusive('\n') {
        // A modify hunk names the same path on both header lines.
        if line.starts_with("--- ") || line.starts_with("+++ ") {
            out.push_str(line);
        } else if let Some(rest) = line.strip_prefix("@@ -") {
            flush(&mut out, &mut removed, &mut added);
            let (ranges, tail) = rest.split_once(" @@").unwrap();
            let (old, new) = ranges.split_once(" +").unwrap();
            out.push_str(&format!("@@ -{new} +{old} @@{tail}"));
        } else if let Some(rest) = line.strip_prefix('+') {
            removed.push_str(&format!("-{rest}"));
            last_was_added = false;
        } else if let Some(rest) = line.strip_prefix('-') {
            added.push_str(&format!("+{rest}"));
            last_was_added = true;
        } else if line.starts_with('\\') {
            // The marker stays with the line it follows.
            if last_was_added {
                added.push_str(line);
            } else {
                removed.push_str(line);
            }
        } else {
            flush(&mut out, &mut removed, &mut added);
            out.push_str(line);
        }
    }
    flush(&mut out, &mut removed, &mut added);
    out
}

fn two_hunk_repo() -> (TempDir, String) {
    let dir = repo_with(&[("f.txt", twenty_lines(&[]).as_bytes())]);
    write(
        dir.path(),
        "f.txt",
        &twenty_lines(&[(2, "line 2 changed"), (18, "line 18 changed")]),
    );
    let patch = git_ok(dir.path(), &["diff", "--", "f.txt"]);
    assert_eq!(patch.matches("\n@@").count(), 2, "{patch}");
    (dir, patch)
}

#[test]
fn apply_patch_stages_one_hunk_of_two() {
    let (dir, patch) = two_hunk_repo();
    git_apply_patch_impl(p(&dir), &one_hunk(&patch, 0), "index", None).unwrap();

    let staged = git_ok(dir.path(), &["diff", "--cached", "--", "f.txt"]);
    assert!(staged.contains("+line 2 changed"), "{staged}");
    assert!(!staged.contains("line 18 changed"), "{staged}");
    let unstaged = git_ok(dir.path(), &["diff", "--", "f.txt"]);
    assert!(unstaged.contains("+line 18 changed"), "{unstaged}");
    assert!(!unstaged.contains("line 2 changed"), "{unstaged}");
}

#[test]
fn apply_patch_unstages_one_hunk_of_two() {
    let (dir, _) = two_hunk_repo();
    git_ok(dir.path(), &["add", "f.txt"]);
    let staged = git_ok(dir.path(), &["diff", "--cached", "--", "f.txt"]);

    git_apply_patch_impl(p(&dir), &reverse(&one_hunk(&staged, 1)), "index", None).unwrap();

    let still_staged = git_ok(dir.path(), &["diff", "--cached", "--", "f.txt"]);
    assert!(still_staged.contains("+line 2 changed"), "{still_staged}");
    assert!(!still_staged.contains("line 18 changed"), "{still_staged}");
    // The work tree keeps both edits — unstaging never touches it.
    assert_eq!(
        fs::read_to_string(dir.path().join("f.txt")).unwrap(),
        twenty_lines(&[(2, "line 2 changed"), (18, "line 18 changed")])
    );
}

#[test]
fn apply_patch_discards_one_hunk_of_two_from_the_work_tree() {
    let (dir, patch) = two_hunk_repo();
    git_apply_patch_impl(p(&dir), &reverse(&one_hunk(&patch, 0)), "workdir", None).unwrap();

    assert_eq!(
        fs::read_to_string(dir.path().join("f.txt")).unwrap(),
        twenty_lines(&[(18, "line 18 changed")])
    );
    assert_eq!(git_ok(dir.path(), &["diff", "--cached"]), "");
}

#[test]
fn apply_patch_refuses_a_stale_patch_and_names_the_file() {
    let (dir, patch) = two_hunk_repo();
    // The index moves on after the viewer rendered its diff: the hunk is
    // already staged, so staging it again has no preimage to match.
    git_ok(dir.path(), &["add", "f.txt"]);
    let err = git_apply_patch_impl(p(&dir), &one_hunk(&patch, 0), "index", None).unwrap_err();
    assert!(
        err.contains("f.txt") && err.contains("no longer applies"),
        "{err}"
    );
    git_ok(dir.path(), &["reset", "-q"]);

    // The work tree moves on after the viewer rendered its diff.
    write(dir.path(), "f.txt", &twenty_lines(&[(2, "something else")]));
    let err =
        git_apply_patch_impl(p(&dir), &reverse(&one_hunk(&patch, 1)), "workdir", None).unwrap_err();
    assert!(
        err.contains("f.txt") && err.contains("no longer applies"),
        "{err}"
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("f.txt")).unwrap(),
        twenty_lines(&[(2, "something else")])
    );
    assert_eq!(git_ok(dir.path(), &["diff", "--cached"]), "");
}

#[test]
fn apply_patch_refuses_an_unknown_target() {
    let (dir, patch) = two_hunk_repo();
    let err = git_apply_patch_impl(p(&dir), &patch, "both", None).unwrap_err();
    assert!(err.contains("both"), "{err}");
}

#[test]
fn a_hunk_from_a_file_without_a_trailing_newline_round_trips() {
    let original = twenty_lines(&[]);
    let original = original.trim_end_matches('\n');
    let dir = repo_with(&[("f.txt", original.as_bytes())]);
    let edited = twenty_lines(&[(2, "line 2 changed"), (20, "line 20 changed")]);
    let edited = edited.trim_end_matches('\n');
    write(dir.path(), "f.txt", edited);
    let patch = crate::git::diff::git_diff_impl(p(&dir), "f.txt", Some("unstaged")).unwrap();
    assert_eq!(patch.matches("\n@@").count(), 2, "{patch}");

    // Stage only the hunk at the end of the file: the index must keep the
    // missing newline, not gain one.
    git_apply_patch_impl(p(&dir), &one_hunk(&patch, 1), "index", None).unwrap();
    let staged = git_ok(dir.path(), &["show", ":f.txt"]);
    assert_eq!(
        staged,
        twenty_lines(&[(20, "line 20 changed")]).trim_end_matches('\n')
    );

    // Discard the same hunk from the work tree.
    git_apply_patch_impl(p(&dir), &reverse(&one_hunk(&patch, 1)), "workdir", None).unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("f.txt")).unwrap(),
        twenty_lines(&[(2, "line 2 changed")]).trim_end_matches('\n')
    );
}

// ---------- git_resolve_conflict_side ----------

fn index_mode(dir: &TempDir, path: &str) -> Option<u32> {
    let repo = Repository::open(dir.path()).unwrap();
    let index = repo.index().unwrap();
    index.get_path(Path::new(path), 0).map(|e| e.mode)
}

#[test]
fn resolve_side_takes_a_binary_side_byte_for_byte() {
    let dir = repo_with(&[("b.bin", b"\x00base")]);
    commit_on(&dir, "feature", |p| {
        fs::write(p.join("b.bin"), b"\x00theirs").unwrap()
    });
    commit_on(&dir, "main", |p| {
        fs::write(p.join("b.bin"), b"\x00ours").unwrap()
    });
    assert!(!git(dir.path(), &["merge", "feature"]).status.success());

    git_resolve_conflict_side_impl(p(&dir), "b.bin", "ours").unwrap();
    assert_eq!(fs::read(dir.path().join("b.bin")).unwrap(), b"\x00ours");
    assert!(git_merge_state_impl(p(&dir)).unwrap().conflicts.is_empty());
    assert_eq!(git_ok(dir.path(), &["status", "--porcelain"]), "");
}

#[test]
fn resolve_side_picking_a_deleted_side_removes_the_file() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    commit_on(&dir, "feature", |p| {
        fs::remove_file(p.join("a.txt")).unwrap()
    });
    commit_on(&dir, "main", |p| write(p, "a.txt", "line1\nours\nline3\n"));
    assert!(!git(dir.path(), &["merge", "feature"]).status.success());

    git_resolve_conflict_side_impl(p(&dir), "a.txt", "theirs").unwrap();
    assert!(!dir.path().join("a.txt").exists());
    assert_eq!(index_mode(&dir, "a.txt"), None);
    assert!(git_merge_state_impl(p(&dir)).unwrap().conflicts.is_empty());
    assert_eq!(git_ok(dir.path(), &["status", "--porcelain"]), "D  a.txt\n");
}

#[cfg(unix)]
#[test]
fn resolve_side_keeps_the_file_mode_of_the_chosen_side() {
    use std::os::unix::fs::PermissionsExt;
    let dir = repo_with(&[("run.sh", BASE.as_bytes())]);
    commit_on(&dir, "feature", |p| {
        write(p, "run.sh", "line1\ntheirs\nline3\n");
        fs::set_permissions(p.join("run.sh"), fs::Permissions::from_mode(0o755)).unwrap();
    });
    commit_on(&dir, "main", |p| write(p, "run.sh", "line1\nours\nline3\n"));
    assert!(!git(dir.path(), &["merge", "feature"]).status.success());

    git_resolve_conflict_side_impl(p(&dir), "run.sh", "theirs").unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("run.sh")).unwrap(),
        "line1\ntheirs\nline3\n"
    );
    let mode = fs::metadata(dir.path().join("run.sh"))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o111, 0o111, "executable bit must come with theirs");
    assert_eq!(index_mode(&dir, "run.sh"), Some(0o100755));
    assert_eq!(
        git_ok(dir.path(), &["status", "--porcelain"]),
        "M  run.sh\n"
    );
}

#[test]
fn resolve_side_refuses_bad_paths_sides_and_clean_files() {
    let dir = terminal_conflict();
    let err = git_resolve_conflict_side_impl(p(&dir), "../a.txt", "ours").unwrap_err();
    assert!(err.contains("not a path inside"), "{err}");
    let err = git_resolve_conflict_side_impl(p(&dir), "other.txt", "ours").unwrap_err();
    assert!(err.contains("no conflict"), "{err}");
    let err = git_resolve_conflict_side_impl(p(&dir), "a.txt", "base").unwrap_err();
    assert!(err.contains("base"), "{err}");
    assert_eq!(
        kinds(&git_merge_state_impl(p(&dir)).unwrap()),
        vec![("a.txt", "content")]
    );
}

// ---------- git_merge_base ----------

#[test]
fn merge_base_of_diverged_branches_is_the_fork_point() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    let fork = head_oid(&dir);
    commit_on(&dir, "feature", |p| write(p, "b.txt", "theirs\n"));
    commit_on(&dir, "main", |p| write(p, "c.txt", "ours\n"));

    assert_eq!(
        git_merge_base_impl(p(&dir), "main", "feature").unwrap(),
        fork
    );
    assert_eq!(
        git_merge_base_impl(p(&dir), "feature", "HEAD").unwrap(),
        fork
    );
}

#[test]
fn merge_base_of_an_ancestor_is_the_ancestor() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    let fork = head_oid(&dir);
    commit_on(&dir, "feature", |p| write(p, "b.txt", "theirs\n"));
    let feature = git_ok(dir.path(), &["rev-parse", "feature"])
        .trim()
        .to_string();

    assert_eq!(git_merge_base_impl(p(&dir), &fork, &feature).unwrap(), fork);
    assert_eq!(
        git_merge_base_impl(p(&dir), &fork[..7], "feature").unwrap(),
        fork
    );
}

#[test]
fn merge_base_refuses_unknown_revs_and_unrelated_histories() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    let err = git_merge_base_impl(p(&dir), "main", "nope").unwrap_err();
    assert!(err.contains("nope"), "{err}");

    git_ok(dir.path(), &["checkout", "-q", "--orphan", "island"]);
    git_ok(dir.path(), &["commit", "-qm", "unrelated"]);
    let err = git_merge_base_impl(p(&dir), "main", "island").unwrap_err();
    assert!(err.contains("no common ancestor"), "{err}");
}

#[test]
fn diff_ref_commands_accept_a_raw_merge_base_oid() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    commit_on(&dir, "main", |p| write(p, "a.txt", "line1\nours\nline3\n"));
    commit_on(&dir, "feature", |p| write(p, "b.txt", "theirs\n"));
    let base = git_merge_base_impl(p(&dir), "main", "feature").unwrap();

    let files = crate::git::diff::git_diff_ref_files_impl(p(&dir), &base).unwrap();
    assert!(files.iter().any(|f| f.path == "a.txt"), "{files:?}");
    let patch = crate::git::diff::git_diff_file_ref_impl(p(&dir), &base, "a.txt").unwrap();
    assert!(patch.contains("+ours"), "{patch}");
}

// ---------- QA round 1: symlinks, commit bypass, abort, bisect ----------

/// `link` changed to a different target on each side; targets live outside.
#[cfg(unix)]
fn symlink_conflict(outside: &Path) -> TempDir {
    use std::os::unix::fs::symlink;
    for name in ["a", "b", "c"] {
        fs::write(outside.join(name), format!("ORIGINAL OUTSIDE {name}\n")).unwrap();
    }
    let dir = repo_with(&[]);
    let relink = |p: &Path, target: &str| {
        let _ = fs::remove_file(p.join("link"));
        symlink(outside.join(target), p.join("link")).unwrap();
    };
    git_ok(dir.path(), &["checkout", "-q", "main"]);
    relink(dir.path(), "c");
    git_ok(dir.path(), &["add", "link"]);
    git_ok(dir.path(), &["commit", "-qm", "link"]);
    git_ok(dir.path(), &["branch", "-f", "feature"]);
    commit_on(&dir, "feature", |p| relink(p, "b"));
    commit_on(&dir, "main", |p| relink(p, "a"));
    assert!(!git(dir.path(), &["merge", "feature"]).status.success());
    dir
}

#[cfg(unix)]
#[test]
fn a_symlink_conflict_has_its_own_kind_and_no_merged_text() {
    let outside = TempDir::new().unwrap();
    let dir = symlink_conflict(outside.path());
    assert_eq!(
        kinds(&git_merge_state_impl(p(&dir)).unwrap()),
        vec![("link", "symlink")]
    );
    let file = git_conflict_file_impl(p(&dir), "link").unwrap();
    assert_eq!(file.kind, "symlink");
    assert_eq!(file.merged, None);
    for name in ["a", "b", "c"] {
        assert_eq!(
            fs::read_to_string(outside.path().join(name)).unwrap(),
            format!("ORIGINAL OUTSIDE {name}\n")
        );
    }
}

#[cfg(unix)]
#[test]
fn resolving_a_symlink_with_text_is_refused_and_writes_nothing_outside() {
    let outside = TempDir::new().unwrap();
    let dir = symlink_conflict(outside.path());
    let err = git_resolve_conflict_impl(p(&dir), "link", Some("resolved text\n")).unwrap_err();
    assert!(err.contains("symbolic link"), "{err}");
    let err = git_resolve_conflict_impl(p(&dir), "link", None).unwrap_err();
    assert!(err.contains("symbolic link"), "{err}");
    assert_eq!(
        fs::read_to_string(outside.path().join("a")).unwrap(),
        "ORIGINAL OUTSIDE a\n"
    );
    assert!(dir.path().join("link").is_symlink());
    assert_eq!(
        kinds(&git_merge_state_impl(p(&dir)).unwrap()),
        vec![("link", "symlink")]
    );
}

#[cfg(unix)]
#[test]
fn resolve_side_recreates_a_symlink_as_a_link() {
    let outside = TempDir::new().unwrap();
    let dir = symlink_conflict(outside.path());
    git_resolve_conflict_side_impl(p(&dir), "link", "theirs").unwrap();

    let link = dir.path().join("link");
    assert!(link.is_symlink());
    assert_eq!(fs::read_link(&link).unwrap(), outside.path().join("b"));
    for name in ["a", "b", "c"] {
        assert_eq!(
            fs::read_to_string(outside.path().join(name)).unwrap(),
            format!("ORIGINAL OUTSIDE {name}\n")
        );
    }
    assert_eq!(index_mode(&dir, "link"), Some(0o120000));
    assert!(git_merge_state_impl(p(&dir)).unwrap().conflicts.is_empty());
}

#[cfg(unix)]
#[test]
fn resolve_refuses_to_write_through_a_symlinked_folder() {
    let outside = TempDir::new().unwrap();
    fs::write(outside.path().join("f.txt"), "OUTSIDE\n").unwrap();
    let dir = init_test_repo();
    git_ok(dir.path(), &["symbolic-ref", "HEAD", "refs/heads/main"]);
    fs::create_dir(dir.path().join("dir")).unwrap();
    write(&dir.path().join("dir"), "f.txt", BASE);
    git_ok(dir.path(), &["add", "."]);
    git_ok(dir.path(), &["commit", "-qm", "base"]);
    git_ok(dir.path(), &["branch", "feature"]);
    commit_on(&dir, "feature", |p| {
        write(&p.join("dir"), "f.txt", "line1\ntheirs\nline3\n")
    });
    commit_on(&dir, "main", |p| {
        write(&p.join("dir"), "f.txt", "line1\nours\nline3\n")
    });
    assert!(!git(dir.path(), &["merge", "feature"]).status.success());
    // Someone swaps the folder for a link to elsewhere.
    fs::remove_dir_all(dir.path().join("dir")).unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("dir")).unwrap();

    for result in [
        git_resolve_conflict_impl(p(&dir), "dir/f.txt", Some("mine\n")),
        git_resolve_conflict_impl(p(&dir), "dir/f.txt", None),
        git_resolve_conflict_side_impl(p(&dir), "dir/f.txt", "ours"),
        git_resolve_conflict_side_impl(p(&dir), "dir/f.txt", "theirs"),
    ] {
        let err = result.unwrap_err();
        assert!(err.contains("symbolic link"), "{err}");
    }
    assert_eq!(
        fs::read_to_string(outside.path().join("f.txt")).unwrap(),
        "OUTSIDE\n"
    );
}

#[test]
fn a_plain_commit_is_refused_while_a_merge_is_in_progress() {
    let dir = terminal_conflict();
    git_resolve_conflict_impl(p(&dir), "a.txt", Some("line1\nboth\nline3\n")).unwrap();
    let err = crate::git::staging::git_commit_impl(p(&dir), "sneaky").unwrap_err();
    assert_eq!(err, "A merge is in progress. Commit it with Commit merge.");
    assert!(merge_head_exists(&dir));
}

#[test]
fn a_plain_commit_is_refused_during_a_cherry_pick() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    commit_on(&dir, "feature", |p| {
        write(p, "a.txt", "line1\ntheirs\nline3\n")
    });
    commit_on(&dir, "main", |p| write(p, "a.txt", "line1\nours\nline3\n"));
    assert!(!git(dir.path(), &["cherry-pick", "feature"])
        .status
        .success());
    git_ok(dir.path(), &["add", "a.txt"]);
    let err = crate::git::staging::git_commit_impl(p(&dir), "sneaky").unwrap_err();
    assert!(err.contains("cherry-pick is in progress"), "{err}");
}

#[test]
fn abort_refuses_when_a_resolved_file_was_edited_again() {
    let dir = terminal_conflict();
    git_resolve_conflict_impl(p(&dir), "a.txt", Some("RESOLVED\n")).unwrap();
    write(dir.path(), "a.txt", "RESOLVED + more unstaged work\n");

    let err = git_merge_abort_impl(p(&dir)).unwrap_err();
    assert_eq!(
        err,
        "a.txt has changes made after it was resolved; commit or undo them first"
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("a.txt")).unwrap(),
        "RESOLVED + more unstaged work\n"
    );
    assert!(merge_head_exists(&dir));
}

#[test]
fn bisect_is_not_an_operation_in_progress() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    git_ok(dir.path(), &["bisect", "start"]);
    let state = git_merge_state_impl(p(&dir)).unwrap();
    assert!(!state.in_progress);
    assert_eq!(state.operation, "none");
}

// ---------- QA round 2: untracked files in ref diffs, stale-stage guard ----------

#[test]
fn diff_against_a_ref_lists_and_shows_untracked_files() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    let base = head_oid(&dir);
    commit_on(&dir, "main", |p| write(p, "a.txt", "line1\nours\nline3\n"));
    fs::create_dir(dir.path().join("new")).unwrap();
    write(&dir.path().join("new"), "fresh.txt", "brand new\n");

    let files = crate::git::diff::git_diff_ref_files_impl(p(&dir), &base).unwrap();
    let listed: Vec<(&str, &str)> = files
        .iter()
        .map(|f| (f.path.as_str(), f.status.as_str()))
        .collect();
    assert!(listed.contains(&("a.txt", "modified")), "{listed:?}");
    assert!(listed.contains(&("new/fresh.txt", "added")), "{listed:?}");
    let patch = crate::git::diff::git_diff_file_ref_impl(p(&dir), &base, "new/fresh.txt").unwrap();
    assert!(patch.contains("+brand new"), "{patch}");
}

fn guard_for(dir: &TempDir, side: &str) -> ApplyPatchGuard {
    ApplyPatchGuard {
        file_path: "f.txt".to_string(),
        side: side.to_string(),
        diff: crate::git::diff::git_diff_impl(p(dir), "f.txt", Some(side)).unwrap(),
    }
}

#[test]
fn apply_patch_with_a_guard_refuses_once_the_shown_diff_is_stale() {
    let (dir, patch) = two_hunk_repo();
    let guard = guard_for(&dir, "unstaged");
    // The work tree moves on; the index does not, so the hunk would still
    // apply to it — only the guard notices the viewer is out of date.
    write(
        dir.path(),
        "f.txt",
        &twenty_lines(&[
            (2, "line 2 changed"),
            (18, "line 18 changed"),
            (10, "new edit"),
        ]),
    );

    let err =
        git_apply_patch_impl(p(&dir), &one_hunk(&patch, 0), "index", Some(&guard)).unwrap_err();
    assert_eq!(
        err,
        "f.txt changed since this diff was shown; it was reloaded"
    );
    assert_eq!(git_ok(dir.path(), &["diff", "--cached"]), "");
}

#[test]
fn apply_patch_with_a_current_guard_applies() {
    let (dir, patch) = two_hunk_repo();
    let guard = guard_for(&dir, "unstaged");
    git_apply_patch_impl(p(&dir), &one_hunk(&patch, 0), "index", Some(&guard)).unwrap();
    assert!(git_ok(dir.path(), &["diff", "--cached"]).contains("+line 2 changed"));

    let staged = guard_for(&dir, "staged");
    let cached = git_ok(dir.path(), &["diff", "--cached", "--", "f.txt"]);
    git_apply_patch_impl(
        p(&dir),
        &reverse(&one_hunk(&cached, 0)),
        "index",
        Some(&staged),
    )
    .unwrap();
    assert_eq!(git_ok(dir.path(), &["diff", "--cached"]), "");
}

#[test]
fn apply_patch_guard_refuses_an_unknown_side() {
    let (dir, patch) = two_hunk_repo();
    let mut guard = guard_for(&dir, "unstaged");
    guard.side = "combined".to_string();
    let err =
        git_apply_patch_impl(p(&dir), &one_hunk(&patch, 0), "index", Some(&guard)).unwrap_err();
    assert!(err.contains("combined"), "{err}");
}

/// Commits `content` as `name` on `branch` with `subject`, then returns to `main`.
fn commit_file(dir: &TempDir, branch: &str, name: &str, content: &str, subject: &str) -> String {
    git_ok(dir.path(), &["checkout", "-q", branch]);
    write(dir.path(), name, content);
    git_ok(dir.path(), &["add", "-A"]);
    git_ok(dir.path(), &["commit", "-qm", subject]);
    let oid = head_oid(dir);
    git_ok(dir.path(), &["checkout", "-q", "main"]);
    oid
}

/// `pool.txt` has five base lines. `feature` changes line 2 and later line 4;
/// `main` changes line 2 differently. `git merge feature` stopped on line 2.
fn origins_fixture() -> (TempDir, String, String, String) {
    let dir = repo_with(&[("pool.txt", b"a\npool=4\nc\nd\ne\n")]);
    let raise = commit_file(
        &dir,
        "feature",
        "pool.txt",
        "a\npool=8\nc\nd\ne\n",
        "Raise pool size",
    );
    let tail = commit_file(
        &dir,
        "feature",
        "pool.txt",
        "a\npool=8\nc\nD\ne\n",
        "Shout d",
    );
    let lower = commit_file(
        &dir,
        "main",
        "pool.txt",
        "a\npool=2\nc\nd\ne\n",
        "Lower pool size",
    );
    let out = git(dir.path(), &["merge", "feature"]);
    assert!(!out.status.success(), "the fixture must conflict");
    (dir, raise, tail, lower)
}

fn origin_lines(origins: &[LineOrigin]) -> Vec<(u32, &str)> {
    origins.iter().map(|o| (o.line, o.oid.as_str())).collect()
}

#[test]
fn conflict_origins_name_the_commit_each_side_changed_a_line_in() {
    let (dir, raise, tail, lower) = origins_fixture();
    let origins = git_conflict_origins_impl(p(&dir), "pool.txt").unwrap();

    assert_eq!(origin_lines(&origins.ours), vec![(2, lower.as_str())]);
    assert_eq!(
        origin_lines(&origins.theirs),
        vec![(2, raise.as_str()), (4, tail.as_str())]
    );
    let mut summaries: Vec<&str> = origins.commits.iter().map(|c| c.summary.as_str()).collect();
    summaries.sort_unstable();
    assert_eq!(
        summaries,
        vec!["Lower pool size", "Raise pool size", "Shout d"]
    );
    let raised = origins.commits.iter().find(|c| c.oid == raise).unwrap();
    assert_eq!(raised.short_oid, raise[..7]);
    assert!(!raised.author.is_empty());
    assert!(raised.time > 0);
}

#[test]
fn conflict_origins_omit_lines_unchanged_since_the_merge_base() {
    let (dir, ..) = origins_fixture();
    let origins = git_conflict_origins_impl(p(&dir), "pool.txt").unwrap();
    let base = git_ok(dir.path(), &["merge-base", "HEAD", "MERGE_HEAD"]);
    let all: Vec<u32> = origins.ours.iter().map(|o| o.line).collect();
    assert!(!all.contains(&1) && !all.contains(&3) && !all.contains(&5));
    assert!(origins.commits.iter().all(|c| c.oid != base.trim()));
}

#[test]
fn conflict_origins_are_empty_for_a_side_that_deleted_the_file() {
    let dir = repo_with(&[("gone.txt", BASE.as_bytes())]);
    commit_file(
        &dir,
        "feature",
        "gone.txt",
        "line1\nchanged\nline3\n",
        "Change gone",
    );
    git_ok(dir.path(), &["checkout", "-q", "main"]);
    git_ok(dir.path(), &["rm", "-q", "gone.txt"]);
    git_ok(dir.path(), &["commit", "-qm", "Remove gone"]);
    assert!(!git(dir.path(), &["merge", "feature"]).status.success());

    let origins = git_conflict_origins_impl(p(&dir), "gone.txt").unwrap();
    assert!(origins.ours.is_empty());
    assert_eq!(origins.theirs.len(), 1);
    assert_eq!(origins.theirs[0].line, 2);
}

#[test]
fn conflict_origins_refuse_without_a_merge() {
    let dir = repo_with(&[("a.txt", BASE.as_bytes())]);
    let err = git_conflict_origins_impl(p(&dir), "a.txt").unwrap_err();
    assert!(err.contains("no merge in progress"), "{err}");
}

#[test]
fn conflict_origins_refuse_a_path_that_escapes_the_repo() {
    let (dir, ..) = origins_fixture();
    assert!(git_conflict_origins_impl(p(&dir), "../outside.txt").is_err());
}
