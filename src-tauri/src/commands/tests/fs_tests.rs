use crate::commands::fs_commands::move_path;
use crate::commands::fs_utils::{
    birth_time_of_file, ensure_scratch_dir, is_atomic_write_temp, read_directory_dated_by,
    read_directory_impl, should_filter_watcher_path, walk_files_with_birth_time, write_file_impl,
    FileEntry,
};
use crate::recent_creations;
use std::collections::HashMap;
use std::fs;
use tempfile::TempDir;

fn folder_dates(entries: &[FileEntry]) -> Vec<(String, Option<i64>)> {
    entries
        .iter()
        .filter(|e| e.is_directory)
        .map(|e| (e.name.clone(), e.newest_file_created_at))
        .collect()
}

#[test]
fn scratch_dir_is_created_under_the_base_and_is_idempotent() {
    let base = TempDir::new().unwrap();
    let dir = ensure_scratch_dir(base.path().to_path_buf()).unwrap();
    assert!(dir.is_dir());
    assert!(dir.ends_with("scratches"));
    let again = ensure_scratch_dir(base.path().to_path_buf()).unwrap();
    assert_eq!(dir, again);
}

#[test]
fn atomic_write_temp_files_are_hidden_from_the_watcher() {
    assert!(is_atomic_write_temp("/project/.note.md.tmp-4321-0"));
    assert!(should_filter_watcher_path("/project/.note.md.tmp-4321-7"));
}

#[test]
fn ordinary_files_are_not_mistaken_for_write_temp_files() {
    assert!(!is_atomic_write_temp("/project/note.md"));
    assert!(!is_atomic_write_temp("/project/.gitignore"));
    assert!(!is_atomic_write_temp("/project/.notes.tmp-draft"));
    assert!(!is_atomic_write_temp("/project/note.md.tmp-1-2"));
    assert!(!is_atomic_write_temp("/project/.note.md.tmp-1"));
}

#[test]
fn the_temp_file_a_write_creates_is_one_the_watcher_hides() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("subdir");
    fs::create_dir(&path).unwrap();
    let _ = write_file_impl(path.to_str().unwrap(), "nope");

    let leftovers: Vec<String> = fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().path().to_string_lossy().to_string())
        .filter(|p| !p.ends_with("subdir"))
        .collect();
    for leftover in &leftovers {
        assert!(
            is_atomic_write_temp(leftover),
            "unfiltered leftover: {leftover}"
        );
    }
}

#[test]
fn read_directory_impl_reports_file_birth_time() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("fresh.md"), "hi").unwrap();
    let entries = read_directory_impl(dir.path().to_str().unwrap()).unwrap();
    let file = entries.iter().find(|e| e.name == "fresh.md").unwrap();
    assert!(!file.is_directory);
    let created = file.created_at.expect("birth time");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    assert!(
        now - created < 60_000,
        "created_at should be recent: {created} vs {now}"
    );
}

#[test]
fn read_directory_impl_omits_birth_time_on_directories() {
    let dir = TempDir::new().unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    let entries = read_directory_impl(dir.path().to_str().unwrap()).unwrap();
    let sub = entries.iter().find(|e| e.name == "sub").unwrap();
    assert!(sub.is_directory);
    assert!(sub.created_at.is_none());
}

#[test]
fn read_directory_impl_reports_file_modified_time() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("touched.md"), "hi").unwrap();
    let entries = read_directory_impl(dir.path().to_str().unwrap()).unwrap();
    let file = entries.iter().find(|e| e.name == "touched.md").unwrap();
    assert!(!file.is_directory);
    let modified = file.modified_at.expect("modified time");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    assert!(
        now - modified < 60_000,
        "modified_at should be recent: {modified} vs {now}"
    );
}

#[test]
fn read_directory_impl_omits_modified_time_on_directories() {
    let dir = TempDir::new().unwrap();
    fs::create_dir(dir.path().join("sub")).unwrap();
    let entries = read_directory_impl(dir.path().to_str().unwrap()).unwrap();
    let sub = entries.iter().find(|e| e.name == "sub").unwrap();
    assert!(sub.is_directory);
    assert!(sub.modified_at.is_none());
}

#[test]
fn read_directory_impl_reports_newest_descendant_file_on_folders() {
    let dir = TempDir::new().unwrap();
    let nested = dir.path().join("src").join("lib");
    fs::create_dir_all(&nested).unwrap();
    fs::write(nested.join("fresh.md"), "hi").unwrap();
    let entries = read_directory_impl(dir.path().to_str().unwrap()).unwrap();
    let src = entries.iter().find(|e| e.name == "src").unwrap();
    assert!(src.is_directory);
    let newest = src.newest_file_created_at.expect("descendant birth time");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    assert!(
        now - newest < 60_000,
        "newest_file_created_at should be recent: {newest} vs {now}"
    );
}

#[test]
fn the_maintained_dates_replace_the_walk_rather_than_supplement_it() {
    let dir = TempDir::new().unwrap();
    let nested = dir.path().join("src");
    fs::create_dir_all(&nested).unwrap();
    fs::write(nested.join("a.ts"), "x").unwrap();

    let sentinel = 4_102_444_800_000;
    let entries = read_directory_dated_by(dir.path().to_str().unwrap(), |_| {
        HashMap::from([("src".to_string(), sentinel)])
    })
    .unwrap();

    let src = entries.iter().find(|e| e.name == "src").unwrap();
    assert_eq!(src.newest_file_created_at, Some(sentinel));
}

#[test]
fn the_cache_dates_folders_exactly_as_the_walk_would() {
    let dir = TempDir::new().unwrap();
    fs::create_dir_all(dir.path().join("src").join("lib")).unwrap();
    fs::write(dir.path().join("src").join("lib").join("a.ts"), "x").unwrap();
    fs::create_dir_all(dir.path().join("empty")).unwrap();
    fs::write(dir.path().join("top.md"), "x").unwrap();

    let root = dir.path().to_str().unwrap();
    let cache = recent_creations::RecentCreations::default();
    cache.seed_root(root, &walk_files_with_birth_time(dir.path()));

    let walked = read_directory_impl(root).unwrap();
    let cached = read_directory_dated_by(root, |d| {
        cache
            .newest_by_child(&d.to_string_lossy())
            .expect("root was seeded")
    })
    .unwrap();

    assert_eq!(folder_dates(&walked), folder_dates(&cached));
    assert!(
        folder_dates(&walked)
            .iter()
            .any(|(n, d)| n == "src" && d.is_some()),
        "the fixture must actually exercise a dated folder"
    );
}

#[test]
fn a_file_created_after_seeding_dates_its_folder_without_another_walk() {
    let dir = TempDir::new().unwrap();
    fs::create_dir_all(dir.path().join("src")).unwrap();
    let root = dir.path().to_str().unwrap();

    let cache = recent_creations::RecentCreations::default();
    cache.seed_root(root, &walk_files_with_birth_time(dir.path()));

    let fresh = dir.path().join("src").join("late.ts");
    fs::write(&fresh, "x").unwrap();
    let created = birth_time_of_file(&fresh).expect("birth time");
    cache.note_file(&fresh.to_string_lossy(), created);

    let entries = read_directory_dated_by(root, |d| {
        cache.newest_by_child(&d.to_string_lossy()).unwrap()
    })
    .unwrap();
    let src = entries.iter().find(|e| e.name == "src").unwrap();
    assert_eq!(src.newest_file_created_at, Some(created));
}

#[test]
fn the_seeding_walk_prunes_what_the_directory_walk_prunes() {
    let dir = TempDir::new().unwrap();
    fs::create_dir_all(dir.path().join(".next")).unwrap();
    fs::write(dir.path().join(".next").join("chunk.js"), "x").unwrap();
    fs::create_dir_all(dir.path().join("node_modules")).unwrap();
    fs::write(dir.path().join("node_modules").join("dep.js"), "x").unwrap();
    fs::create_dir_all(dir.path().join("src")).unwrap();
    fs::write(dir.path().join("src").join("a.ts"), "x").unwrap();

    let files = walk_files_with_birth_time(dir.path());
    assert!(files.iter().any(|(p, _)| p.ends_with("/src/a.ts")));
    assert!(!files.iter().any(|(p, _)| p.contains("/.next/")));
    assert!(!files.iter().any(|(p, _)| p.contains("/node_modules/")));
}

#[cfg(unix)]
#[test]
fn the_cache_and_the_walk_agree_about_symlinked_directories() {
    let dir = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    fs::create_dir_all(outside.path().join("deep")).unwrap();
    fs::write(outside.path().join("deep").join("hidden.ts"), "x").unwrap();

    fs::create_dir_all(dir.path().join("src")).unwrap();
    fs::write(dir.path().join("src").join("a.ts"), "x").unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("linked")).unwrap();

    let files = walk_files_with_birth_time(dir.path());
    assert!(
        !files.iter().any(|(p, _)| p.contains("hidden.ts")),
        "the seeding walk must not descend into a symlink"
    );

    let root = dir.path().to_str().unwrap();
    let cache = recent_creations::RecentCreations::default();
    cache.seed_root(root, &files);

    let walked = read_directory_impl(root).unwrap();
    let cached = read_directory_dated_by(root, |d| {
        cache
            .newest_by_child(&d.to_string_lossy())
            .expect("root was seeded")
    })
    .unwrap();
    assert_eq!(folder_dates(&walked), folder_dates(&cached));
}

#[test]
fn birth_time_is_read_for_files_only() {
    let dir = TempDir::new().unwrap();
    let file = dir.path().join("a.ts");
    fs::write(&file, "x").unwrap();

    assert!(birth_time_of_file(&file).is_some());
    assert!(birth_time_of_file(dir.path()).is_none());
    assert!(birth_time_of_file(&dir.path().join("missing.ts")).is_none());
}

#[test]
fn read_directory_impl_ignores_build_output_when_dating_folders() {
    let dir = TempDir::new().unwrap();
    let build = dir.path().join(".next").join("static");
    fs::create_dir_all(&build).unwrap();
    fs::write(build.join("chunk.js"), "x").unwrap();
    let entries = read_directory_impl(dir.path().to_str().unwrap()).unwrap();
    let next = entries.iter().find(|e| e.name == ".next").unwrap();
    assert!(next.is_directory);
    assert!(next.newest_file_created_at.is_none());
}

#[test]
fn write_file_impl_writes_content() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("note.md");
    write_file_impl(path.to_str().unwrap(), "hello").unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
}

#[test]
fn write_file_impl_replaces_existing_content() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("note.md");
    fs::write(&path, "old and much longer content").unwrap();
    write_file_impl(path.to_str().unwrap(), "new").unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "new");
}

#[test]
fn write_file_impl_leaves_no_temp_files_behind() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("note.md");
    write_file_impl(path.to_str().unwrap(), "hello").unwrap();
    let entries: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    assert_eq!(entries, vec!["note.md".to_string()]);
}

#[test]
fn write_file_impl_keeps_the_old_content_when_the_write_fails() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("subdir");
    fs::create_dir(&path).unwrap();
    let result = write_file_impl(path.to_str().unwrap(), "nope");
    assert!(result.is_err());
    assert!(path.is_dir());
}

#[test]
fn write_file_impl_reports_a_missing_directory() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("nope").join("note.md");
    let err = write_file_impl(path.to_str().unwrap(), "hello").unwrap_err();
    assert!(
        err.contains("Failed to write file"),
        "unexpected error: {err}"
    );
}

#[test]
fn write_file_impl_cleans_up_after_a_failed_write() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("subdir");
    fs::create_dir(&path).unwrap();
    let _ = write_file_impl(path.to_str().unwrap(), "nope");
    let leftovers: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .filter(|name| name != "subdir")
        .collect();
    assert!(leftovers.is_empty(), "left behind: {leftovers:?}");
}

#[test]
fn write_file_impl_preserves_unix_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("script.sh");
    fs::write(&path, "#!/bin/sh\n").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

    write_file_impl(path.to_str().unwrap(), "#!/bin/sh\necho hi\n").unwrap();

    let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o755, "the executable bit must survive a save");
}

#[test]
fn write_file_impl_writes_through_a_symlink() {
    use std::os::unix::fs::symlink;
    let dir = TempDir::new().unwrap();
    let target = dir.path().join("real.md");
    let link = dir.path().join("link.md");
    fs::write(&target, "old").unwrap();
    symlink(&target, &link).unwrap();

    write_file_impl(link.to_str().unwrap(), "new").unwrap();

    assert_eq!(fs::read_to_string(&target).unwrap(), "new");
    assert!(fs::symlink_metadata(&link)
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn test_move_path_moves_file_between_dirs() {
    let dir = TempDir::new().unwrap();
    let sub = dir.path().join("sub");
    fs::create_dir(&sub).unwrap();
    let src = dir.path().join("note.md");
    fs::write(&src, "hello").unwrap();
    let dest = sub.join("note.md");

    move_path(
        src.to_str().unwrap().to_string(),
        dest.to_str().unwrap().to_string(),
    )
    .unwrap();

    assert!(!src.exists());
    assert!(dest.exists());
    assert_eq!(fs::read_to_string(&dest).unwrap(), "hello");
}

#[test]
fn test_move_path_moves_directory() {
    let dir = TempDir::new().unwrap();
    let src = dir.path().join("folder");
    fs::create_dir(&src).unwrap();
    fs::write(src.join("a.txt"), "x").unwrap();
    let target_parent = dir.path().join("dest");
    fs::create_dir(&target_parent).unwrap();
    let dest = target_parent.join("folder");

    move_path(
        src.to_str().unwrap().to_string(),
        dest.to_str().unwrap().to_string(),
    )
    .unwrap();

    assert!(!src.exists());
    assert!(dest.join("a.txt").exists());
}

#[test]
fn test_move_path_refuses_to_overwrite_existing() {
    let dir = TempDir::new().unwrap();
    let src = dir.path().join("a.txt");
    fs::write(&src, "one").unwrap();
    let sub = dir.path().join("sub");
    fs::create_dir(&sub).unwrap();
    let dest = sub.join("a.txt");
    fs::write(&dest, "two").unwrap();

    let err = move_path(
        src.to_str().unwrap().to_string(),
        dest.to_str().unwrap().to_string(),
    )
    .unwrap_err();

    assert!(err.contains("already exists"));
    assert_eq!(fs::read_to_string(&src).unwrap(), "one");
    assert_eq!(fs::read_to_string(&dest).unwrap(), "two");
}

#[test]
fn test_move_path_rejects_folder_into_own_subtree() {
    let dir = TempDir::new().unwrap();
    let folder = dir.path().join("folder");
    let child = folder.join("child");
    fs::create_dir_all(&child).unwrap();
    let dest = child.join("folder");

    let err = move_path(
        folder.to_str().unwrap().to_string(),
        dest.to_str().unwrap().to_string(),
    )
    .unwrap_err();

    assert!(err.contains("into itself"));
    assert!(folder.exists());
}
