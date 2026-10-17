use super::*;
use crate::supervisor_link::policy::{DEFAULT_MAX_ASSET_BYTES, MAX_ASSET_BYTES};
use crate::supervisor_link::test_support::Project;
use serde_json::{json, Value};

const FIXTURES: &str = include_str!("../../../src/lib/agents/supervisorLink.fixtures.json");

fn code(result: Result<Asset, DocumentError>) -> &'static str {
    result.unwrap_err().code.as_str()
}

fn read(p: &Project, path: &str, rev: Option<&str>) -> Result<Asset, DocumentError> {
    get(&p.policy(), p.path(), path, rev)
}

#[test]
fn constants_match_the_fixtures() {
    let fixtures: Value = serde_json::from_str(FIXTURES).unwrap();
    let assets = &fixtures["assets"];
    assert_eq!(
        assets["defaultMaxAssetBytes"],
        json!(DEFAULT_MAX_ASSET_BYTES)
    );
    assert_eq!(assets["maxAssetBytes"], json!(MAX_ASSET_BYTES));
    assert_eq!(assets["encoding"], "base64");
}

#[test]
fn an_asset_comes_back_as_base64_with_its_sha256_and_size() {
    let p = Project::new();
    let bytes: Vec<u8> = (0u8..=255).collect();
    std::fs::create_dir_all(p.root.join("docs/assets/models")).unwrap();
    std::fs::write(p.root.join("docs/assets/models/cube.bin"), &bytes).unwrap();

    let asset = read(&p, "docs/assets/models/cube.bin", None).unwrap();
    assert_eq!(asset.document_type, "diagram");
    assert_eq!(asset.size, 256);
    assert_eq!(STANDARD.decode(&asset.data).unwrap(), bytes);
    assert_eq!(
        asset.sha256,
        "40aff2e9d2d8922e47afd4648e6967497158785fbd1da870e7110266bf944880"
    );
    assert_eq!(asset.hash, blob_hash(&bytes).unwrap());
    assert_eq!(asset.rev, None);
    assert_eq!(asset.merged, None);
}

#[test]
fn only_paths_an_asset_glob_names_are_read() {
    let p = Project::new();
    p.write("docs/system.diagram.json", r#"{"v":1}"#);
    p.write("docs/assets/notes.txt", "not an asset");
    assert_eq!(
        code(read(&p, "docs/system.diagram.json", None)),
        "invalid_params"
    );
    assert_eq!(
        code(read(&p, "docs/assets/notes.txt", None)),
        "invalid_params"
    );
    assert_eq!(
        code(read(&p, "docs/assets/gone.bin", None)),
        "document_not_found"
    );
}

#[test]
fn a_path_that_climbs_out_or_is_absolute_is_refused() {
    let p = Project::new();
    for path in [
        "../outside.bin",
        "docs/assets/../../outside.bin",
        "/etc/hosts.bin",
        "docs/assets/./a.bin",
        "docs/assets/.hidden.bin",
        "docs\\assets\\a.bin",
        "",
    ] {
        assert_eq!(code(read(&p, path, None)), "invalid_params", "{path}");
    }
}

#[test]
fn a_symlink_out_of_the_project_reads_as_not_found() {
    let p = Project::new();
    let outside = tempfile::tempdir().unwrap();
    let secret = outside.path().join("secret.bin");
    std::fs::write(&secret, "secret").unwrap();
    std::fs::create_dir_all(p.root.join("docs/assets")).unwrap();
    std::os::unix::fs::symlink(&secret, p.root.join("docs/assets/link.bin")).unwrap();
    assert_eq!(
        code(read(&p, "docs/assets/link.bin", None)),
        "document_not_found"
    );
}

#[test]
fn a_symlink_to_a_file_no_asset_glob_names_reads_as_not_found() {
    let p = Project::new();
    p.write("private/key.bin", "inside the project, but no asset");
    p.write("docs/assets/real.bin", "an asset");
    std::os::unix::fs::symlink(
        p.root.join("private/key.bin"),
        p.root.join("docs/assets/alias.bin"),
    )
    .unwrap();
    std::os::unix::fs::symlink(
        p.root.join("docs/assets/real.bin"),
        p.root.join("docs/assets/same.bin"),
    )
    .unwrap();
    assert_eq!(
        code(read(&p, "docs/assets/alias.bin", None)),
        "document_not_found"
    );
    // A link to another asset is fine: both names are visible anyway.
    assert_eq!(read(&p, "docs/assets/same.bin", None).unwrap().size, 8);
}

#[test]
fn an_asset_over_the_cap_is_refused_before_it_is_read() {
    let p = Project::new();
    p.write("docs/assets/big.bin", "12345");
    let mut policy = p.policy();
    for config in policy.projects.values_mut() {
        config.document_types[0].max_asset_bytes = Some(4);
    }
    let refused = get(&policy, p.path(), "docs/assets/big.bin", None).unwrap_err();
    assert_eq!(refused.code.as_str(), "document_invalid");
    assert!(
        refused.message.contains("more than 4"),
        "{}",
        refused.message
    );
    for config in policy.projects.values_mut() {
        config.document_types[0].max_asset_bytes = Some(5);
    }
    assert_eq!(
        get(&policy, p.path(), "docs/assets/big.bin", None)
            .unwrap()
            .size,
        5
    );
}

#[test]
fn an_asset_is_read_at_a_rev_and_says_whether_it_is_merged() {
    let p = Project::new();
    let repo = p.init_repo();
    p.write("docs/assets/a.bin", "first");
    let first = p.commit_all(&repo, "first");
    let head = repo.find_commit(first).unwrap();
    repo.branch("auric/job-1", &head, false).unwrap();
    p.write("docs/assets/a.bin", "second");
    let second = p.commit_all(&repo, "second");
    p.write("docs/assets/a.bin", "working tree");

    let at_first = read(&p, "docs/assets/a.bin", Some(&first.to_string())).unwrap();
    assert_eq!(STANDARD.decode(&at_first.data).unwrap(), b"first");
    assert_eq!(at_first.rev.as_deref(), Some(first.to_string().as_str()));
    assert_eq!(at_first.merged, Some(true));
    let by_branch = read(&p, "docs/assets/a.bin", Some("auric/job-1")).unwrap();
    assert_eq!(by_branch.rev.as_deref(), Some(first.to_string().as_str()));
    let at_head = read(&p, "docs/assets/a.bin", Some(&second.to_string())).unwrap();
    assert_eq!(STANDARD.decode(&at_head.data).unwrap(), b"second");

    // A commit HEAD does not hold is a preview.
    repo.set_head("refs/heads/auric/job-1").unwrap();
    let ahead = read(&p, "docs/assets/a.bin", Some(&second.to_string())).unwrap();
    assert_eq!(ahead.merged, Some(false));

    assert_eq!(
        code(read(&p, "docs/assets/a.bin", Some("HEAD~1"))),
        "invalid_params"
    );
    assert_eq!(
        code(read(&p, "docs/assets/none.bin", Some(&first.to_string()))),
        "document_not_found"
    );
}

#[test]
fn a_symlink_committed_at_a_rev_is_not_an_asset() {
    let p = Project::new();
    let repo = p.init_repo();
    p.write("private/key.bin", "secret");
    std::fs::create_dir_all(p.root.join("docs/assets")).unwrap();
    std::os::unix::fs::symlink("../../private/key.bin", p.root.join("docs/assets/l.bin")).unwrap();
    let commit = p.commit_all(&repo, "a link");
    assert_eq!(
        code(read(&p, "docs/assets/l.bin", Some(&commit.to_string()))),
        "document_not_found"
    );
}

#[test]
fn an_asset_over_the_cap_at_a_rev_is_refused() {
    let p = Project::new();
    let repo = p.init_repo();
    p.write("docs/assets/big.bin", "12345");
    let commit = p.commit_all(&repo, "big");
    let mut policy = p.policy();
    for config in policy.projects.values_mut() {
        config.document_types[0].max_asset_bytes = Some(4);
    }
    let refused = get(
        &policy,
        p.path(),
        "docs/assets/big.bin",
        Some(&commit.to_string()),
    )
    .unwrap_err();
    assert_eq!(refused.code.as_str(), "document_invalid");
}

#[test]
fn a_project_the_link_does_not_share_shows_no_assets() {
    let p = Project::new();
    let other = Project::new();
    other.write("docs/assets/a.bin", "x");
    assert_eq!(
        code(get(&p.policy(), other.path(), "docs/assets/a.bin", None)),
        "document_not_visible"
    );
}
