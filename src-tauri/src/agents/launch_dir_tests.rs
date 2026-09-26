//! Sub-goal 09, directory rule: the native spawn-time check against the
//! launch request row. Real git repositories and worktrees (git2 + the IDE's
//! own `git_worktree_add_impl`), a real inbox schema.

use super::{check_agent_notification_directory, check_launch_directory};
use crate::git::worktrees::git_worktree_add_impl;
use git2::{Repository, Signature};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

fn inbox() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    crate::notifications::run_migrations(&conn).unwrap();
    conn
}

/// Writes a row the way `request_agent_launch` does.
fn request(conn: &Connection, uid: &str, folder: Option<&str>, use_worktree: bool) {
    insert(conn, uid, "request_agent_launch", folder, use_worktree);
}

fn insert(conn: &Connection, uid: &str, origin: &str, folder: Option<&str>, use_worktree: bool) {
    let mut action = serde_json::json!({
        "id": "start", "label": "Start agent", "kind": "spawn-agent",
        "task": "work", "goalId": "g1",
    });
    if let Some(folder) = folder {
        action["repoPath"] = serde_json::Value::String(folder.to_string());
    }
    if use_worktree {
        action["useWorktree"] = serde_json::Value::Bool(true);
    }
    conn.execute(
        "INSERT INTO notifications
           (uid, project_path, source, origin, title, actions, dedupe_key, ref_kind, ref_id)
         VALUES (?1, '/repo/project', 'agent', ?2, 'Agent requested', ?3, ?4, 'goal', 'g1')",
        rusqlite::params![
            uid,
            origin,
            serde_json::json!([action]).to_string(),
            format!("agent-launch:{uid}")
        ],
    )
    .unwrap();
}

/// A canonical scratch root: on macOS `tempdir()` sits behind `/var -> /private/var`.
fn sandbox() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    (dir, root)
}

/// A repository with one commit, so worktrees can branch from HEAD.
fn repo_at(path: &Path) -> PathBuf {
    std::fs::create_dir_all(path).unwrap();
    let repo = Repository::init(path).unwrap();
    std::fs::write(path.join("README.md"), "hello").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new("README.md")).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = Signature::now("t", "t@example.com").unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
        .unwrap();
    path.canonicalize().unwrap()
}

fn s(path: &Path) -> &str {
    path.to_str().unwrap()
}

#[test]
fn starts_in_the_requesting_agent_folder() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let conn = inbox();
    request(&conn, "r1", Some(s(&folder)), false);

    assert_eq!(
        check_launch_directory(&conn, "r1", Some(s(&folder))),
        Ok(())
    );
}

#[test]
fn refuses_a_foreign_folder() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let foreign = root.join("elsewhere");
    std::fs::create_dir(&foreign).unwrap();
    let conn = inbox();
    request(&conn, "r1", Some(s(&folder)), false);

    let error = check_launch_directory(&conn, "r1", Some(s(&foreign))).unwrap_err();
    assert!(error.contains("only start in"), "{error}");
}

#[test]
fn refuses_a_stored_folder_spelled_with_dot_dot() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let dotted = format!("{}/../AuricIDE", s(&folder));
    let conn = inbox();
    request(&conn, "r1", Some(&dotted), false);

    let error = check_launch_directory(&conn, "r1", Some(s(&folder))).unwrap_err();
    assert!(error.contains("not canonical"), "{error}");
}

#[test]
fn refuses_a_stored_symlink_to_the_folder() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let link = root.join("link");
    std::os::unix::fs::symlink(&folder, &link).unwrap();
    let conn = inbox();
    request(&conn, "r1", Some(s(&link)), false);

    let error = check_launch_directory(&conn, "r1", Some(s(&folder))).unwrap_err();
    assert!(error.contains("not canonical"), "{error}");
}

#[test]
fn refuses_a_relative_or_missing_stored_folder() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let conn = inbox();
    request(&conn, "rel", Some("AuricIDE"), false);
    request(&conn, "gone", Some(s(&root.join("missing"))), false);

    let relative = check_launch_directory(&conn, "rel", Some(s(&folder))).unwrap_err();
    assert!(relative.contains("not absolute"), "{relative}");
    let missing = check_launch_directory(&conn, "gone", Some(s(&folder))).unwrap_err();
    assert!(missing.contains("cannot be resolved"), "{missing}");
}

#[test]
fn starts_in_a_fresh_ide_worktree_of_the_same_repository() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let worktree = git_worktree_add_impl(s(&folder), "helper").unwrap();
    let conn = inbox();
    request(&conn, "r1", Some(s(&folder)), true);

    assert_eq!(
        check_launch_directory(&conn, "r1", Some(&worktree.path)),
        Ok(())
    );
}

/// Only a worktree the IDE made for this request: one that existed before the
/// request was written is somebody else's folder.
#[test]
fn refuses_a_worktree_that_existed_before_the_request() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let old = git_worktree_add_impl(s(&folder), "old").unwrap();
    let conn = inbox();
    request(&conn, "r1", Some(s(&folder)), true);
    conn.execute(
        "UPDATE notifications SET created_at = datetime('now', '+1 hour') WHERE uid = 'r1'",
        [],
    )
    .unwrap();

    let error = check_launch_directory(&conn, "r1", Some(&old.path)).unwrap_err();
    assert!(error.contains("before"), "{error}");
}

#[test]
fn a_requester_inside_a_worktree_may_ask_for_another_worktree_of_its_repository() {
    let (_guard, root) = sandbox();
    let main = repo_at(&root.join("AuricIDE"));
    let requester = git_worktree_add_impl(s(&main), "requester").unwrap();
    let requester_path = Path::new(&requester.path).canonicalize().unwrap();
    let fresh = git_worktree_add_impl(s(&requester_path), "helper").unwrap();
    let conn = inbox();
    request(&conn, "r1", Some(s(&requester_path)), true);

    assert_eq!(
        check_launch_directory(&conn, "r1", Some(&fresh.path)),
        Ok(())
    );
}

#[test]
fn refuses_a_worktree_of_another_repository_with_the_same_folder_name() {
    let (_guard, root) = sandbox();
    let ours = repo_at(&root.join("x").join("AuricIDE"));
    let theirs = repo_at(&root.join("y").join("AuricIDE"));
    let foreign_worktree = git_worktree_add_impl(s(&theirs), "helper").unwrap();
    let conn = inbox();
    request(&conn, "r1", Some(s(&ours)), true);

    let error = check_launch_directory(&conn, "r1", Some(&foreign_worktree.path)).unwrap_err();
    assert!(error.contains("another repository"), "{error}");
}

#[test]
fn refuses_a_worktree_when_the_request_did_not_ask_for_one() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let worktree = git_worktree_add_impl(s(&folder), "helper").unwrap();
    let conn = inbox();
    request(&conn, "r1", Some(s(&folder)), false);

    let error = check_launch_directory(&conn, "r1", Some(&worktree.path)).unwrap_err();
    assert!(error.contains("only start in"), "{error}");
}

#[test]
fn refuses_the_checkout_itself_when_a_worktree_was_asked_for() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let conn = inbox();
    request(&conn, "r1", Some(s(&folder)), true);

    let error = check_launch_directory(&conn, "r1", Some(s(&folder))).unwrap_err();
    assert!(error.contains("not a git worktree"), "{error}");
}

#[test]
fn refuses_a_plain_git_worktree_outside_the_ide_worktree_folder() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let repo = Repository::open(&folder).unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    let branch = repo.branch("auric/handmade", &head, false).unwrap();
    let reference = branch.into_reference();
    let mut options = git2::WorktreeAddOptions::new();
    options.reference(Some(&reference));
    let elsewhere = root.join("handmade");
    repo.worktree("handmade", &elsewhere, Some(&options))
        .unwrap();
    let conn = inbox();
    request(&conn, "r1", Some(s(&folder)), true);

    let error = check_launch_directory(&conn, "r1", Some(s(&elsewhere))).unwrap_err();
    assert!(error.contains("not an IDE worktree"), "{error}");
}

#[test]
fn refuses_a_row_that_is_not_a_launch_request() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let conn = inbox();
    insert(&conn, "notify", "my-agent", Some(s(&folder)), false);

    for uid in ["notify", "never-written"] {
        let error = check_launch_directory(&conn, uid, Some(s(&folder))).unwrap_err();
        assert!(
            error.contains("not an agent launch request"),
            "{uid}: {error}"
        );
    }
}

#[test]
fn refuses_a_request_without_a_stored_folder() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let conn = inbox();
    request(&conn, "r1", None, false);

    let error = check_launch_directory(&conn, "r1", Some(s(&folder))).unwrap_err();
    assert!(error.contains("stored no folder"), "{error}");
}

#[test]
fn refuses_a_launch_request_spawn_without_a_working_directory() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let conn = inbox();
    request(&conn, "r1", Some(s(&folder)), false);

    let error = check_launch_directory(&conn, "r1", None).unwrap_err();
    assert!(error.contains("needs a working directory"), "{error}");
}

// ---------------------------------------------------------------------------
// Sub-goal 09, blocker 2 of review r3: every other agent-written Start button
// (notify, an agent's schedule) follows the same rule. The MCP server stamps
// the requesting agent's folder and `placement: "requester"`; the spawn
// refuses anything else.

/// Writes an agent notification with one spawn-agent action `run`.
fn agent_button(conn: &Connection, uid: &str, source: &str, action: serde_json::Value) {
    conn.execute(
        "INSERT INTO notifications (uid, project_path, source, origin, title, actions)
         VALUES (?1, '/repo/project', ?2, 'some-agent', 'Start?', ?3)",
        rusqlite::params![uid, source, serde_json::json!([action]).to_string()],
    )
    .unwrap();
}

fn stamped(folder: &str) -> serde_json::Value {
    serde_json::json!({
        "id": "run", "label": "Start agent", "kind": "spawn-agent", "task": "work",
        "repoPath": folder, "placement": "requester",
    })
}

#[test]
fn an_agent_button_starts_in_its_stamped_folder() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let conn = inbox();
    agent_button(&conn, "n1", "agent", stamped(s(&folder)));

    assert_eq!(
        check_agent_notification_directory(&conn, "n1", "run", Some(s(&folder))),
        Ok(())
    );
}

#[test]
fn an_agent_button_never_starts_in_another_folder() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let foreign = repo_at(&root.join("other"));
    let conn = inbox();
    agent_button(&conn, "n1", "agent", stamped(s(&folder)));

    let error =
        check_agent_notification_directory(&conn, "n1", "run", Some(s(&foreign))).unwrap_err();
    assert!(error.contains("only start in"), "{error}");
}

/// The case from the review: notify with a free repoPath, written before the
/// rule or by anything that is not the checking MCP server.
#[test]
fn an_agent_button_without_the_checked_stamp_starts_nowhere() {
    let (_guard, root) = sandbox();
    let foreign = repo_at(&root.join("other"));
    let conn = inbox();
    agent_button(
        &conn,
        "n1",
        "agent",
        serde_json::json!({
            "id": "run", "label": "Start agent", "kind": "spawn-agent", "task": "work",
            "repoPath": s(&foreign),
        }),
    );

    let error =
        check_agent_notification_directory(&conn, "n1", "run", Some(s(&foreign))).unwrap_err();
    assert!(error.contains("checked folder"), "{error}");
}

#[test]
fn an_agent_button_refuses_a_stamped_symlink_or_dot_dot_folder() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let link = root.join("link");
    std::os::unix::fs::symlink(&folder, &link).unwrap();
    let dotted = format!("{}/../AuricIDE", s(&folder));
    let conn = inbox();
    agent_button(&conn, "n1", "agent", stamped(s(&link)));
    agent_button(&conn, "n2", "agent", stamped(&dotted));

    for uid in ["n1", "n2"] {
        let error =
            check_agent_notification_directory(&conn, uid, "run", Some(s(&folder))).unwrap_err();
        assert!(error.contains("not canonical"), "{uid}: {error}");
    }
}

#[test]
fn an_agent_button_refuses_a_worktree() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let mut action = stamped(s(&folder));
    action["useWorktree"] = serde_json::Value::Bool(true);
    let conn = inbox();
    agent_button(&conn, "n1", "agent", action);

    let error =
        check_agent_notification_directory(&conn, "n1", "run", Some(s(&folder))).unwrap_err();
    assert!(error.contains("worktree"), "{error}");
}

#[test]
fn an_agent_button_check_needs_an_agent_row_and_a_spawn_action() {
    let (_guard, root) = sandbox();
    let folder = repo_at(&root.join("AuricIDE"));
    let conn = inbox();
    agent_button(&conn, "user-row", "ui", stamped(s(&folder)));
    agent_button(&conn, "n1", "agent", stamped(s(&folder)));

    for (uid, action, needle) in [
        ("user-row", "run", "not written by an agent"),
        ("missing", "run", "not written by an agent"),
        ("n1", "other", "no spawn-agent action"),
    ] {
        let error =
            check_agent_notification_directory(&conn, uid, action, Some(s(&folder))).unwrap_err();
        assert!(error.contains(needle), "{uid}/{action}: {error}");
    }
    let error = check_agent_notification_directory(&conn, "n1", "run", None).unwrap_err();
    assert!(error.contains("working directory"), "{error}");
}

/// Review r4 blocker: until r4 the schedule runner fired every reminder as
/// `system`, including those of schedules an agent created through MCP
/// (`mcp-` id). This writes the row exactly as that runner did: the
/// `NotificationInput` of the pre-r4 `run_due_impl`, the real dedupe key, the
/// agent's own payload actions, no folder stamp.
fn legacy_mcp_reminder(conn: &mut Connection, uid: &str, repo_path: Option<&str>) {
    let mut action = serde_json::json!({
        "id": "run", "label": "Start agent", "kind": "spawn-agent",
        "task": "Continue the work", "permissionMode": "bypassPermissions",
    });
    if let Some(folder) = repo_path {
        action["repoPath"] = serde_json::Value::String(folder.to_string());
    }
    let occurrence = chrono::DateTime::parse_from_rfc3339("2026-09-20T08:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    let input = crate::notifications::NotificationInput {
        uid: Some(uid.to_string()),
        project_path: Some("/repo/project".to_string()),
        project_name: Some("project".to_string()),
        source: "system".to_string(),
        origin: Some("Agent follow-up".to_string()),
        kind: Some("info".to_string()),
        severity: Some("info".to_string()),
        title: "Agent follow-up".to_string(),
        body: None,
        actions: Some(serde_json::json!([action])),
        dedupe_key: Some(crate::schedules::schedule_dedupe_key(
            &format!("mcp-1727000000000-4242-{uid}"),
            occurrence,
        )),
        ref_kind: None,
        ref_id: None,
        expires_at: None,
    };
    crate::notifications::dispatch_impl(conn, &input).unwrap();
}

/// An inbox that was last opened by a build before the migration: the rows are
/// there, the migration has not run yet.
fn reopen_after_upgrade(conn: &Connection) {
    conn.execute(
        "DELETE FROM _migrations WHERE id = ?1",
        [crate::notifications::LEGACY_MCP_REMINDER_MIGRATION],
    )
    .unwrap();
    crate::notifications::run_migrations(conn).unwrap();
}

fn source_of(conn: &Connection, uid: &str) -> String {
    conn.query_row(
        "SELECT source FROM notifications WHERE uid = ?1",
        [uid],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn a_pre_r4_reminder_of_an_agent_schedule_becomes_agent_written_on_upgrade() {
    let mut conn = inbox();
    legacy_mcp_reminder(&mut conn, "legacy-1", None);
    let mut person = crate::notifications::NotificationInput {
        uid: Some("weekly".to_string()),
        source: "system".to_string(),
        title: "Weekly changelog".to_string(),
        dedupe_key: Some("schedule:1b2c3d:2026-09-20 08:00:00".to_string()),
        project_path: None,
        project_name: None,
        origin: None,
        kind: None,
        severity: None,
        body: None,
        actions: None,
        ref_kind: None,
        ref_id: None,
        expires_at: None,
    };
    crate::notifications::dispatch_impl(&mut conn, &person).unwrap();
    person.uid = Some("typed".to_string());
    person.source = "ui".to_string();
    person.dedupe_key = Some("schedule:mcp-looks-alike:2026-09-20 08:00:00".to_string());
    crate::notifications::dispatch_impl(&mut conn, &person).unwrap();

    reopen_after_upgrade(&conn);

    assert_eq!(source_of(&conn, "legacy-1"), "agent");
    assert_eq!(source_of(&conn, "weekly"), "system");
    assert_eq!(source_of(&conn, "typed"), "ui");
}

#[test]
fn a_pre_r4_reminder_of_an_agent_schedule_starts_nowhere_after_the_upgrade() {
    let (_guard, root) = sandbox();
    let open_project = repo_at(&root.join("open"));
    let elsewhere = repo_at(&root.join("elsewhere"));
    let mut conn = inbox();
    legacy_mcp_reminder(&mut conn, "legacy-1", None);
    legacy_mcp_reminder(&mut conn, "legacy-2", Some(s(&elsewhere)));

    reopen_after_upgrade(&conn);

    for (uid, cwd) in [("legacy-1", &open_project), ("legacy-2", &elsewhere)] {
        let error =
            check_agent_notification_directory(&conn, uid, "run", Some(s(cwd))).unwrap_err();
        assert!(error.contains("checked folder"), "{uid}: {error}");
    }
}

/// Dev and installed build share the inbox. An older build that is still
/// running can fire such a reminder as `system` after the migration; the
/// native check refuses it all the same.
#[test]
fn a_reminder_an_older_build_fires_as_system_after_the_upgrade_starts_nowhere() {
    let (_guard, root) = sandbox();
    let elsewhere = repo_at(&root.join("elsewhere"));
    let mut conn = inbox();
    legacy_mcp_reminder(&mut conn, "late", Some(s(&elsewhere)));

    let error =
        check_agent_notification_directory(&conn, "late", "run", Some(s(&elsewhere))).unwrap_err();
    assert!(error.contains("not written by an agent"), "{error}");
}
