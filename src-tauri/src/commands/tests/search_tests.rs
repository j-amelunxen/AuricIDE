use crate::commands::fs_utils::search_in_files_impl;
use std::fs;
use tempfile::TempDir;

fn search_dir(files: &[(&str, &str)]) -> TempDir {
    let dir = TempDir::new().unwrap();
    for (name, content) in files {
        let path = dir.path().join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }
    dir
}

#[test]
fn search_finds_a_match_with_one_based_line_and_column() {
    let dir = search_dir(&[("note.md", "first line\nsecond needle line\n")]);
    let results = search_in_files_impl(dir.path().to_str().unwrap(), "needle", true, 500).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].line, 2);
    assert_eq!(results[0].column, 8);
    assert_eq!(results[0].line_text, "second needle line");
}

#[test]
fn search_collects_matches_across_multiple_files() {
    let dir = search_dir(&[("a.md", "hit here"), ("b.md", "and hit here too")]);
    let results = search_in_files_impl(dir.path().to_str().unwrap(), "hit", true, 500).unwrap();
    let paths: Vec<&str> = results.iter().map(|r| r.path.as_str()).collect();
    assert_eq!(results.len(), 2);
    assert!(paths.iter().any(|p| p.ends_with("a.md")));
    assert!(paths.iter().any(|p| p.ends_with("b.md")));
}

#[test]
fn search_is_case_insensitive_by_default() {
    let dir = search_dir(&[("a.md", "Needle here")]);
    let results = search_in_files_impl(dir.path().to_str().unwrap(), "needle", false, 500).unwrap();
    assert_eq!(results.len(), 1);
}

#[test]
fn search_case_sensitive_excludes_different_casing() {
    let dir = search_dir(&[("a.md", "Needle here")]);
    let results = search_in_files_impl(dir.path().to_str().unwrap(), "needle", true, 500).unwrap();
    assert!(results.is_empty());
}

#[test]
fn search_skips_git_and_node_modules_directories() {
    let dir = search_dir(&[
        (".git/config", "needle"),
        ("node_modules/pkg/index.js", "needle"),
        ("src/real.md", "needle"),
    ]);
    let results = search_in_files_impl(dir.path().to_str().unwrap(), "needle", true, 500).unwrap();
    assert_eq!(results.len(), 1);
    assert!(results[0].path.ends_with("real.md"));
}

#[test]
fn search_returns_empty_for_an_empty_query() {
    let dir = search_dir(&[("a.md", "anything")]);
    let results = search_in_files_impl(dir.path().to_str().unwrap(), "", true, 500).unwrap();
    assert!(results.is_empty());
}

#[test]
fn search_stops_at_max_results() {
    let files: Vec<(String, String)> = (0..10)
        .map(|i| (format!("f{i}.md"), "needle".to_string()))
        .collect();
    let file_refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(n, c)| (n.as_str(), c.as_str()))
        .collect();
    let dir = search_dir(&file_refs);
    let results = search_in_files_impl(dir.path().to_str().unwrap(), "needle", true, 3).unwrap();
    assert_eq!(results.len(), 3);
}

#[test]
fn search_errors_on_a_root_that_is_not_a_directory() {
    let dir = TempDir::new().unwrap();
    let missing = dir.path().join("nope");
    let err = search_in_files_impl(missing.to_str().unwrap(), "needle", true, 500).unwrap_err();
    assert!(err.contains("Invalid root path"));
}
