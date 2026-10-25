use crate::git::file_compare::{diff_files_impl, MAX_COMPARE_BYTES};
use std::fs;
use tempfile::TempDir;

fn write(dir: &TempDir, name: &str, contents: &[u8]) -> String {
    let path = dir.path().join(name);
    fs::write(&path, contents).unwrap();
    path.to_str().unwrap().to_string()
}

#[test]
fn differing_files_give_a_unified_patch() {
    let dir = TempDir::new().unwrap();
    let left = write(&dir, "a.txt", b"one\ntwo\nthree\n");
    let right = write(&dir, "b.txt", b"one\n2\nthree\n");

    let patch = diff_files_impl(&left, &right).unwrap();

    assert!(patch.contains("--- a/a.txt"), "{patch}");
    assert!(patch.contains("+++ b/b.txt"), "{patch}");
    assert!(patch.contains("-two\n"), "{patch}");
    assert!(patch.contains("+2\n"), "{patch}");
}

#[test]
fn identical_files_give_an_empty_patch() {
    let dir = TempDir::new().unwrap();
    let left = write(&dir, "a.txt", b"same\n");
    let right = write(&dir, "b.txt", b"same\n");

    assert_eq!(diff_files_impl(&left, &right).unwrap(), "");
}

#[test]
fn a_binary_file_is_refused_by_name() {
    let dir = TempDir::new().unwrap();
    let left = write(&dir, "a.txt", b"text\n");
    let right = write(&dir, "logo.png", b"\x89PNG\0\0data");

    let error = diff_files_impl(&left, &right).unwrap_err();

    assert_eq!(
        error,
        "logo.png looks like a binary file and cannot be compared."
    );
}

#[test]
fn a_file_over_the_size_limit_is_refused_by_name() {
    let dir = TempDir::new().unwrap();
    let left = write(&dir, "small.txt", b"x\n");
    let right = write(
        &dir,
        "huge.txt",
        &vec![b'x'; MAX_COMPARE_BYTES as usize + 1],
    );

    let error = diff_files_impl(&left, &right).unwrap_err();

    assert_eq!(
        error,
        "huge.txt is larger than 5 MB and cannot be compared."
    );
}

#[test]
fn a_missing_file_is_refused_by_name() {
    let dir = TempDir::new().unwrap();
    let left = write(&dir, "a.txt", b"x\n");
    let right = dir.path().join("gone.txt").to_str().unwrap().to_string();

    let error = diff_files_impl(&left, &right).unwrap_err();

    assert_eq!(error, "gone.txt could not be read.");
}

#[test]
fn a_folder_is_refused_by_name() {
    let dir = TempDir::new().unwrap();
    let left = write(&dir, "a.txt", b"x\n");
    fs::create_dir(dir.path().join("sub")).unwrap();
    let right = dir.path().join("sub").to_str().unwrap().to_string();

    let error = diff_files_impl(&left, &right).unwrap_err();

    assert_eq!(error, "sub is not a file and cannot be compared.");
}
