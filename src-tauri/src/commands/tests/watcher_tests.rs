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
