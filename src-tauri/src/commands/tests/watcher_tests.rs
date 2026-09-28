use crate::commands::fs_utils::should_filter_watcher_path;

#[test]
fn test_watcher_filters_git_paths() {
    assert!(should_filter_watcher_path(
        "/home/user/project/.git/objects/abc123"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/.git/refs/heads/main"
    ));
    assert!(should_filter_watcher_path("/home/user/project/.git/index"));
}

#[test]
fn test_watcher_filters_node_modules() {
    assert!(should_filter_watcher_path(
        "/home/user/project/node_modules/react/index.js"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/node_modules/.pnpm/some-pkg/node_modules/dep"
    ));
}

#[test]
fn test_watcher_filters_target_dir() {
    assert!(should_filter_watcher_path(
        "/home/user/project/target/debug/build"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/target/release/libmyapp.rlib"
    ));
}

#[test]
fn test_watcher_filters_build_output() {
    // `pnpm dev` rewrites .next continuously. Left unfiltered these events
    // reset the tree-refresh debounce forever, so the explorer never
    // refreshes at all while the dev server runs.
    assert!(should_filter_watcher_path(
        "/home/user/project/.next/static/chunks/main.js"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/.turbo/daemon/log"
    ));
}

#[test]
fn test_watcher_filters_ds_store() {
    // Finder rewrites .DS_Store on every folder view, which would
    // otherwise make the explorer glow folders nobody actually touched.
    assert!(should_filter_watcher_path("/home/user/project/.DS_Store"));
    assert!(should_filter_watcher_path(
        "/home/user/project/src/.DS_Store"
    ));
}

#[test]
fn test_watcher_filters_windows_thumbs_db() {
    assert!(should_filter_watcher_path("/home/user/project/Thumbs.db"));
    assert!(should_filter_watcher_path(
        "/home/user/project/src/Thumbs.db"
    ));
}

#[test]
fn test_watcher_filters_python_caches() {
    assert!(should_filter_watcher_path(
        "/home/user/project/src/__pycache__/mod.cpython-312.pyc"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/.venv/lib/site-packages/pkg.py"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/venv/lib/site-packages/pkg.py"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/.pytest_cache/v/cache/lastfailed"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/.mypy_cache/3.12/module.data.json"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/.ruff_cache/0.5.0/cache"
    ));
}

#[test]
fn test_watcher_filters_test_and_build_output() {
    assert!(should_filter_watcher_path(
        "/home/user/project/coverage/lcov.info"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/playwright-report/index.html"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/test-results/report.json"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/out/index.html"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/dist/main.js"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/.cache/babel-loader/abc123"
    ));
}

#[test]
fn test_watcher_allows_normal_paths() {
    assert!(!should_filter_watcher_path(
        "/home/user/project/src/main.rs"
    ));
    assert!(!should_filter_watcher_path("/home/user/project/README.md"));
    assert!(!should_filter_watcher_path(
        "/home/user/project/src/app/page.tsx"
    ));
    assert!(!should_filter_watcher_path("/home/user/project/.gitignore"));
}

#[test]
fn test_watcher_filters_more_build_output() {
    // Each of these is rewritten wholesale by a build or dev server. Every
    // event that passes costs an IPC emit and wakes the tree refresh.
    for path in [
        "/home/user/project/build/index.js",
        "/home/user/project/app/build/intermediates/x.dex",
        "/home/user/project/.svelte-kit/generated/root.js",
        "/home/user/project/.gradle/8.5/checksums/lock",
        "/home/user/project/.nuxt/dist/server.mjs",
        "/home/user/project/.parcel-cache/data.mdb",
    ] {
        assert!(
            should_filter_watcher_path(path),
            "{path} should be filtered"
        );
    }
}

#[test]
fn test_watcher_keeps_the_project_db_but_filters_the_rest_of_auric() {
    // The database files are how the frontend learns an MCP agent wrote PM
    // data, so they must pass. Everything else under .auric/ (video import
    // frames, scratch state) is ours and not worth a tree refresh.
    for path in [
        "/home/user/project/.auric/project.db",
        "/home/user/project/.auric/project.db-wal",
        "/home/user/project/.auric/project.db-shm",
        "/home/user/project/.auric/project.db-journal",
    ] {
        assert!(!should_filter_watcher_path(path), "{path} must pass");
    }
    assert!(should_filter_watcher_path(
        "/home/user/project/.auric/video-imports/clip/frame-0001.png"
    ));
    assert!(should_filter_watcher_path(
        "/home/user/project/.auric/other.txt"
    ));
}

#[test]
fn test_watcher_keeps_the_build_output_folders_themselves() {
    // Only what is inside is filtered: the folder appearing is one event and
    // the explorer should show it.
    assert!(!should_filter_watcher_path("/home/user/project/build"));
    assert!(!should_filter_watcher_path(
        "/home/user/project/src/builder.ts"
    ));
}

mod batching {
    use crate::commands::watcher_commands::{finish_batch, FileEvent};

    fn raw(path: &str, kind: &str) -> (String, String) {
        (path.to_string(), kind.to_string())
    }

    #[test]
    fn exact_repeats_are_sent_once_in_first_seen_order() {
        let batch = finish_batch(
            vec![
                raw("/p/a.md", "Modify(Data(Content))"),
                raw("/p/b.md", "Create(File)"),
                raw("/p/a.md", "Modify(Data(Content))"),
            ],
            |_| true,
        );
        let paths: Vec<_> = batch.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, ["/p/a.md", "/p/b.md"]);
    }

    #[test]
    fn different_kinds_for_one_path_all_stay() {
        // Whether a kind is structural is decided in the frontend; merging
        // Create + Modify here would hide the Create.
        let batch = finish_batch(
            vec![
                raw("/p/new.md", "Create(File)"),
                raw("/p/new.md", "Modify(Data(Content))"),
            ],
            |_| true,
        );
        assert_eq!(batch.len(), 2);
    }

    #[test]
    fn existence_is_asked_once_per_path_and_carried_on_every_event() {
        let asked = std::cell::Cell::new(0);
        let batch = finish_batch(
            vec![raw("/p/tmp", "Create(File)"), raw("/p/tmp", "Remove(File)")],
            |_| {
                asked.set(asked.get() + 1);
                false
            },
        );
        assert_eq!(asked.get(), 1);
        assert_eq!(
            batch[1],
            FileEvent {
                path: "/p/tmp".into(),
                kind: "Remove(File)".into(),
                exists: false
            }
        );
        assert!(!batch[0].exists);
    }
}
