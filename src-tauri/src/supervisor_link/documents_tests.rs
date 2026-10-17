use super::*;
use crate::supervisor_link::test_support::{diagram_type, Project};
use serde_json::json;
use std::path::Path;

const FIXTURES: &str = include_str!("../../../src/lib/agents/supervisorLink.fixtures.json");

fn fixtures() -> Value {
    serde_json::from_str(FIXTURES).unwrap()
}

fn code(result: Result<impl std::fmt::Debug, DocumentError>) -> &'static str {
    result.unwrap_err().code.as_str()
}

fn get_wt(p: &Project, id: &str) -> Result<Document, DocumentError> {
    get(&p.policy(), p.path(), "diagram", id, None)
}

#[test]
fn constants_match_the_fixtures() {
    let fixtures = fixtures();
    assert_eq!(fixtures["maxDocumentBytes"], json!(MAX_DOCUMENT_BYTES));
    assert_eq!(fixtures["search"]["maxLimit"], json!(SEARCH_MAX_LIMIT));
    assert_eq!(fixtures["search"]["maxDepth"], json!(SEARCH_MAX_DEPTH));
    assert_eq!(
        fixtures["search"]["maxFilesPerProject"],
        json!(SEARCH_MAX_FILES_PER_PROJECT)
    );
    assert_eq!(
        fixtures["proposalBranchPrefix"],
        json!(PROPOSAL_BRANCH_PREFIX)
    );
}

#[test]
fn document_ids_follow_the_fixtures() {
    let fixtures = fixtures();
    let document_type = diagram_type();
    for id in fixtures["documentIds"]["valid"].as_array().unwrap() {
        let id = id.as_str().unwrap();
        assert!(validate_id(&document_type, id).is_ok(), "{id}");
    }
    for id in fixtures["documentIds"]["invalid"].as_array().unwrap() {
        let id = id.as_str().unwrap();
        assert!(validate_id(&document_type, id).is_err(), "{id}");
    }
}

#[test]
fn references_resolve_as_the_fixtures_say() {
    let document_type = diagram_type();
    for case in fixtures()["resolve"].as_array().unwrap() {
        let from = case["from"].as_str().unwrap();
        let reference = case["ref"].as_str().unwrap();
        match reference_candidates(&document_type, from, reference) {
            Ok(candidates) => assert_eq!(
                json!(candidates),
                case["candidates"],
                "{from} -> {reference}"
            ),
            Err(error) => assert_eq!(
                json!(error.code.as_str()),
                case["error"],
                "{from} -> {reference}"
            ),
        }
    }
}

#[test]
fn projects_list_existing_folders_with_their_types_and_kinds() {
    let repo_project = Project::new();
    repo_project.init_repo();
    let plain = Project::new();
    let mut policy = repo_project.policy();
    policy
        .projects
        .insert(plain.path().into(), Default::default());
    policy
        .projects
        .insert("/does/not/exist/anywhere".into(), Default::default());
    let listed = visible_projects(&policy);
    assert_eq!(listed.len(), 2);
    let with_repo = listed
        .iter()
        .find(|p| p.path == repo_project.path())
        .unwrap();
    assert!(with_repo.is_git_repo);
    assert_eq!(with_repo.document_types[0].name, "diagram");
    assert_eq!(
        with_repo.document_types[0].schema.as_deref(),
        Some("docs/diagram.schema.json")
    );
    assert_eq!(with_repo.job_kinds, vec!["diagram.draw"]);
    let without = listed.iter().find(|p| p.path == plain.path()).unwrap();
    assert!(!without.is_git_repo);
    assert!(without.document_types.is_empty());
}

fn search_fixture() -> Project {
    let p = Project::new();
    p.write(
        "docs/architecture/system.diagram.json",
        r#"{"meta":{"title":"The system","subtitle":"Services and queues"}}"#,
    );
    p.write(
        "docs/architecture/modules/auth.diagram.json",
        r#"{"nodes":[]}"#,
    );
    p.write("docs/broken.diagram.json", "not json");
    p.write("docs/array.diagram.json", "[]");
    p.write("docs/notes.md", "# not a document");
    p.write("src/elsewhere.diagram.json", "{}");
    p
}

#[test]
fn search_names_from_the_field_or_the_file_and_skips_what_is_no_document() {
    let p = search_fixture();
    let hits = search(&p.policy(), None, None, None, 50).unwrap();
    let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "docs/architecture/modules/auth.diagram.json",
            "docs/architecture/system.diagram.json"
        ]
    );
    assert_eq!(hits[0].name, "auth");
    assert_eq!(hits[0].description, None);
    assert_eq!(hits[0].document_type, "diagram");
    assert_eq!(hits[1].name, "The system");
    assert_eq!(hits[1].description.as_deref(), Some("Services and queues"));
}

#[test]
fn search_uses_the_index_and_matches_every_word() {
    let p = search_fixture();
    p.write(
        "docs/diagrams.index.json",
        r#"{"documents":[
            {"id":"docs/architecture/modules/auth","name":"Login","tags":["security"]},
            {"id":"docs/architecture/system.diagram.json","description":"Indexed"}
        ]}"#,
    );
    let hits = search(&p.policy(), None, None, None, 50).unwrap();
    assert_eq!(hits[0].name, "Login", "the short id finds its entry");
    assert_eq!(hits[0].tags, vec!["security"]);
    assert_eq!(hits[1].description.as_deref(), Some("Indexed"));

    let found = search(&p.policy(), Some("SECURITY login"), None, None, 50).unwrap();
    assert_eq!(found.len(), 1);
    assert!(search(&p.policy(), Some("security system"), None, None, 50)
        .unwrap()
        .is_empty());
    assert!(search(&p.policy(), None, None, Some("other"), 50)
        .unwrap()
        .is_empty());
    assert_eq!(search(&p.policy(), None, None, None, 1).unwrap().len(), 1);
}

#[test]
fn a_project_outside_the_policy_is_not_visible() {
    let shown = search_fixture();
    let hidden = search_fixture();
    let policy = shown.policy();
    assert_eq!(
        code(get(
            &policy,
            hidden.path(),
            "diagram",
            "docs/architecture/system.diagram.json",
            None
        )),
        "document_not_visible"
    );
    assert_eq!(
        code(search(&policy, None, Some(hidden.path()), None, 50)),
        "document_not_visible"
    );
    assert!(search(&policy, None, None, None, 50)
        .unwrap()
        .iter()
        .all(|h| h.project == shown.path()));
    assert!(search(&LinkPolicy::default(), None, None, None, 50)
        .unwrap()
        .is_empty());
}

#[test]
fn get_reads_the_working_tree_or_a_revision() {
    let p = Project::new();
    let repo = p.init_repo();
    let id = "docs/system.diagram.json";
    p.write(id, r#"{"v":1}"#);
    let first = p.commit_all(&repo, "first");
    p.write(id, r#"{"v":2}"#);

    let worktree = get_wt(&p, id).unwrap();
    assert_eq!(worktree.document, json!({"v": 2}));
    assert_eq!(worktree.rev, None);
    assert_eq!(worktree.merged, None);
    assert_eq!(
        worktree.hash,
        Oid::hash_object(ObjectType::Blob, br#"{"v":2}"#)
            .unwrap()
            .to_string()
    );

    let at_head = get(&p.policy(), p.path(), "diagram", id, Some("HEAD")).unwrap();
    assert_eq!(at_head.document, json!({"v": 1}));
    assert_eq!(at_head.rev, Some(first.to_string()));
    assert_eq!(at_head.merged, Some(true));

    assert_eq!(
        code(get_wt(&p, "docs/missing.diagram.json")),
        "document_not_found"
    );
    assert_eq!(
        code(get(
            &p.policy(),
            p.path(),
            "diagram",
            id,
            Some("no-such-branch")
        )),
        "document_not_found"
    );
    assert_eq!(code(get_wt(&p, "docs/../x.diagram.json")), "invalid_params");
    assert_eq!(code(get_wt(&p, "docs/plan.json")), "invalid_params");
    assert_eq!(
        code(get(&p.policy(), p.path(), "nope", id, None)),
        "invalid_params"
    );
    assert_eq!(
        code(get(&p.policy(), "relative/path", "diagram", id, None)),
        "invalid_params"
    );

    let via = resolve(
        &p.policy(),
        p.path(),
        "diagram",
        "docs/other.diagram.json",
        "system",
        None,
    )
    .unwrap();
    assert_eq!(via.id, id);
    assert_eq!(
        code(resolve(
            &p.policy(),
            p.path(),
            "diagram",
            id,
            "nothing",
            None
        )),
        "document_not_found"
    );
}

#[test]
fn get_refuses_what_is_not_a_document() {
    let p = Project::new();
    p.write("docs/array.diagram.json", "[1]");
    p.write("docs/text.diagram.json", "nope");
    p.write(
        "docs/big.diagram.json",
        &format!(r#"{{"x":"{}"}}"#, "a".repeat(MAX_DOCUMENT_BYTES)),
    );
    for id in [
        "docs/array.diagram.json",
        "docs/text.diagram.json",
        "docs/big.diagram.json",
    ] {
        assert_eq!(code(get_wt(&p, id)), "document_invalid", "{id}");
    }
}

#[cfg(unix)]
#[test]
fn a_symlink_out_of_the_project_is_not_followed() {
    let p = Project::new();
    let outside = Project::new();
    outside.write("secret.diagram.json", r#"{"secret":true}"#);
    outside.write("folder/leak.diagram.json", r#"{"secret":true}"#);
    std::fs::create_dir_all(p.root.join("docs")).unwrap();
    std::os::unix::fs::symlink(
        outside.root.join("secret.diagram.json"),
        p.root.join("docs/secret.diagram.json"),
    )
    .unwrap();
    std::os::unix::fs::symlink(outside.root.join("folder"), p.root.join("docs/folder")).unwrap();
    p.write("docs/real.diagram.json", "{}");
    std::os::unix::fs::symlink(
        p.root.join("docs/real.diagram.json"),
        p.root.join("docs/alias.diagram.json"),
    )
    .unwrap();

    assert_eq!(
        code(get_wt(&p, "docs/secret.diagram.json")),
        "document_not_found"
    );
    assert_eq!(
        code(get_wt(&p, "docs/folder/leak.diagram.json")),
        "document_not_found"
    );
    assert!(get_wt(&p, "docs/alias.diagram.json").is_ok());
    let ids: Vec<String> = search(&p.policy(), None, None, None, 50)
        .unwrap()
        .into_iter()
        .map(|h| h.id)
        .collect();
    assert_eq!(
        ids,
        vec!["docs/alias.diagram.json", "docs/real.diagram.json"]
    );
}

struct Snapshot {
    head: String,
    head_ref: Option<String>,
    index: Vec<(String, Oid)>,
    status: Vec<(String, git2::Status)>,
}

fn snapshot(repo: &Repository) -> Snapshot {
    let index = repo.index().unwrap();
    let mut statuses = git2::StatusOptions::new();
    statuses.include_untracked(true);
    Snapshot {
        head: repo.head().unwrap().target().unwrap().to_string(),
        head_ref: repo.head().unwrap().name().map(str::to_string),
        index: index
            .iter()
            .map(|e| (String::from_utf8(e.path.clone()).unwrap(), e.id))
            .collect(),
        status: repo
            .statuses(Some(&mut statuses))
            .unwrap()
            .iter()
            .map(|s| (s.path().unwrap().to_string(), s.status()))
            .collect(),
    }
}

fn blob_at(repo: &Repository, commit: &str, path: &str) -> String {
    let commit = repo.find_commit(Oid::from_str(commit).unwrap()).unwrap();
    let entry = commit.tree().unwrap().get_path(Path::new(path)).unwrap();
    let blob = repo.find_blob(entry.id()).unwrap();
    String::from_utf8(blob.content().to_vec()).unwrap()
}

fn proposal<'a>(
    p: &'a Project,
    id: &'a str,
    document: &'a Value,
    base: Option<&'a str>,
) -> ProposeRequest<'a> {
    ProposeRequest {
        project: p.path(),
        type_name: "diagram",
        id,
        document,
        base_hash: base,
        message: Some("Add the auth module"),
    }
}

#[test]
fn propose_creates_a_branch_for_a_new_document_and_touches_nothing_else() {
    let p = Project::new();
    let repo = p.init_repo();
    p.write("docs/system.diagram.json", r#"{"v":1}"#);
    let base = p.commit_all(&repo, "first");
    // An uncommitted edit the human is in the middle of.
    p.write("docs/system.diagram.json", r#"{"v":"draft"}"#);
    let before = snapshot(&repo);

    let content = json!({"meta": {"title": "Auth"}});
    let id = "docs/modules/auth.diagram.json";
    let made = propose(&p.policy(), &proposal(&p, id, &content, None)).unwrap();

    let after = snapshot(&repo);
    assert_eq!(before.head, after.head);
    assert_eq!(before.head_ref, after.head_ref);
    assert_eq!(before.index, after.index);
    assert_eq!(before.status, after.status);
    assert!(!p.root.join("docs/modules").exists());
    assert!(made.created);
    assert_eq!(made.base, base.to_string());
    assert_eq!(made.document_type, "diagram");
    assert!(
        made.branch.starts_with("auric/proposal/auth-"),
        "{}",
        made.branch
    );
    let commit = repo
        .find_commit(Oid::from_str(&made.commit).unwrap())
        .unwrap();
    assert_eq!(commit.parent_id(0).unwrap(), base);
    assert_eq!(
        commit.message().unwrap(),
        "diagram: propose docs/modules/auth.diagram.json\n\nAdd the auth module\n"
    );
    assert_eq!(
        blob_at(&repo, &made.commit, id),
        format!("{}\n", serde_json::to_string_pretty(&content).unwrap())
    );

    // The preview of the unmerged branch says so.
    let preview = get(&p.policy(), p.path(), "diagram", id, Some(&made.branch)).unwrap();
    assert_eq!(preview.merged, Some(false));
    assert_eq!(preview.rev.as_deref(), Some(made.commit.as_str()));
}

#[test]
fn propose_updates_with_the_right_base_and_conflicts_otherwise() {
    let p = Project::new();
    let repo = p.init_repo();
    let id = "docs/system.diagram.json";
    p.write(id, r#"{"v":1}"#);
    p.commit_all(&repo, "first");
    let base = get(&p.policy(), p.path(), "diagram", id, Some("HEAD"))
        .unwrap()
        .hash;
    let content = json!({"v": 2});

    let updated = propose(&p.policy(), &proposal(&p, id, &content, Some(&base))).unwrap();
    assert!(!updated.created);
    assert_eq!(
        code(propose(&p.policy(), &proposal(&p, id, &content, None))),
        "document_conflict"
    );
    assert_eq!(
        code(propose(
            &p.policy(),
            &proposal(&p, id, &content, Some("0000"))
        )),
        "document_conflict"
    );
    assert_eq!(
        code(propose(
            &p.policy(),
            &proposal(&p, id, &json!([1]), Some(&base))
        )),
        "document_invalid"
    );
}

#[test]
fn propose_needs_a_repository_with_a_commit() {
    let p = Project::new();
    let content = json!({});
    let id = "docs/a.diagram.json";
    assert_eq!(
        code(propose(&p.policy(), &proposal(&p, id, &content, None))),
        "not_a_git_repo"
    );
    p.init_repo();
    assert_eq!(
        code(propose(&p.policy(), &proposal(&p, id, &content, None))),
        "not_a_git_repo"
    );
}
