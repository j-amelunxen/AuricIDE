//! Newest file birth time per directory, carried forward from watcher events.
//!
//! The explorer dates a folder by the newest file anywhere beneath it, so a
//! folder holding something just-created can be marked as such. Deriving that
//! from the filesystem means walking the folder's entire subtree on every
//! directory read — thousands of `stat` calls to answer a question about a
//! handful of files.
//!
//! The watcher already sees every creation as it happens, so the answer is
//! maintained instead of recomputed: each file stamps its birth time onto every
//! ancestor directory up to the project root. A read then costs one lookup per
//! child instead of a walk.
//!
//! Deliberately **not** stored here: how old counts as "recent". This module
//! reports a timestamp, a fact about the filesystem; the window that turns it
//! into a glowing row is the frontend's policy and lives there alone, so the
//! two cannot drift apart.
//!
//! The trade this makes: a cached time only ever moves forward. Delete the one
//! young file in a folder and the folder keeps its timestamp until something
//! re-seeds it — it reads as recent for the remainder of the frontend's window.
//! Accepted deliberately; the cost of exactness here is the walk this replaces.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

/// Newest descendant-file birth time (unix ms) per directory, plus the roots
/// whose contents have been enumerated at least once.
#[derive(Default)]
pub struct RecentCreations {
    by_dir: Mutex<HashMap<String, i64>>,
    seeded_roots: Mutex<Vec<String>>,
    /// Roots whose seeding pass is under way: already collecting watcher
    /// notes, not yet complete enough to answer a read.
    seeding_roots: Mutex<Vec<String>>,
}

/// A directory path without its trailing slash — except at the filesystem
/// root, where the slash *is* the path and trimming it would leave an empty
/// prefix that matches everything.
fn normalize(path: &str) -> &str {
    match path.strip_suffix('/') {
        Some("") | None => path,
        Some(trimmed) => trimmed,
    }
}

/// True when `path` is `root` itself or sits underneath it.
fn is_within(path: &str, root: &str) -> bool {
    let root = normalize(root);
    if path == root {
        return true;
    }
    if root == "/" {
        return path.starts_with('/') && path.len() > 1;
    }
    path.len() > root.len() && path.starts_with(root) && path.as_bytes()[root.len()] == b'/'
}

/// Writes `created_at_ms` onto every directory from the file's parent up to
/// `root`, keeping the newest value where one is already recorded.
fn stamp_ancestors(
    map: &mut HashMap<String, i64>,
    file_path: &str,
    root: &str,
    created_at_ms: i64,
) {
    if !is_within(file_path, root) {
        return;
    }
    let root = normalize(root);
    let Some(parent) = Path::new(file_path).parent() else {
        return;
    };
    for dir in parent.ancestors() {
        let Some(dir) = dir.to_str() else { return };
        map.entry(dir.to_string())
            .and_modify(|t| {
                if created_at_ms > *t {
                    *t = created_at_ms;
                }
            })
            .or_insert(created_at_ms);
        if dir == root {
            return;
        }
    }
}

impl RecentCreations {
    /// Claims a seeding pass for `root`, clearing what was known about it.
    ///
    /// The claim is decided under a single acquisition on purpose: two callers
    /// racing to seed the same root would otherwise both conclude the pass was
    /// theirs to open, and the second clear would drop the notes the first had
    /// already collected. Returns whether this call was the one that opened it.
    fn open_pass(&self, root: &str) -> bool {
        let opened = {
            let mut seeding = self.seeding_roots.lock().unwrap();
            if seeding.iter().any(|r| r == root) {
                false
            } else {
                seeding.push(root.to_string());
                true
            }
        };
        if opened {
            self.by_dir
                .lock()
                .unwrap()
                .retain(|dir, _| !is_within(dir, root));
            self.seeded_roots.lock().unwrap().retain(|r| r != root);
        }
        opened
    }

    /// Opens a seeding pass: drops what was known about `root`, starts keeping
    /// watcher notes for it, and makes reads fall back to walking until
    /// `seed_root` closes the pass.
    ///
    /// The two steps exist because the watcher goes live before the seeding
    /// walk finishes. A file created in that gap, in a directory the walk has
    /// already passed, is seen by neither half — unless the notes taken during
    /// the pass survive into the result.
    pub fn begin_seeding(&self, root: &str) {
        self.open_pass(normalize(root));
    }

    /// Closes the seeding pass for `root`: folds `files` in alongside anything
    /// the watcher reported meanwhile, and makes the root answerable.
    ///
    /// Called without a preceding `begin_seeding` it opens the pass itself, so
    /// a lone call still means "this is now everything known about `root`".
    pub fn seed_root(&self, root: &str, files: &[(String, i64)]) {
        let root = normalize(root).to_string();
        self.open_pass(&root);

        let mut fresh: HashMap<String, i64> = HashMap::with_capacity(files.len() / 4 + 1);
        for (path, created_at_ms) in files {
            stamp_ancestors(&mut fresh, path, &root, *created_at_ms);
        }

        let mut map = self.by_dir.lock().unwrap();
        for (dir, created_at_ms) in fresh {
            map.entry(dir)
                .and_modify(|t| {
                    if created_at_ms > *t {
                        *t = created_at_ms;
                    }
                })
                .or_insert(created_at_ms);
        }
        drop(map);

        self.seeding_roots.lock().unwrap().retain(|r| r != &root);
        let mut roots = self.seeded_roots.lock().unwrap();
        if !roots.iter().any(|r| r == &root) {
            roots.push(root);
        }
    }

    /// Records one file's birth time. Files under no root at all are ignored —
    /// there is no maintained answer for them to keep current.
    pub fn note_file(&self, file_path: &str, created_at_ms: i64) {
        let root = {
            let seeded = self.seeded_roots.lock().unwrap();
            let found = seeded.iter().find(|r| is_within(file_path, r)).cloned();
            drop(seeded);
            match found {
                Some(root) => Some(root),
                None => self
                    .seeding_roots
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|r| is_within(file_path, r))
                    .cloned(),
            }
        };
        let Some(root) = root else { return };
        let mut map = self.by_dir.lock().unwrap();
        stamp_ancestors(&mut map, file_path, &root, created_at_ms);
    }

    /// Newest descendant-file birth time for each immediate child directory of
    /// `dir`, keyed by child name.
    ///
    /// `None` means this directory is not under a seeded root, so nothing is
    /// known about it and the caller must fall back to walking. An empty map is
    /// a real answer: seeded, and nothing beneath it has a birth time.
    pub fn newest_by_child(&self, dir: &str) -> Option<HashMap<String, i64>> {
        let dir = normalize(dir);
        let roots = self.seeded_roots.lock().unwrap();
        if !roots.iter().any(|r| is_within(dir, r)) {
            return None;
        }
        drop(roots);

        // "/" already ends in the separator; every other directory needs one added.
        let prefix_len = if dir == "/" { 1 } else { dir.len() + 1 };
        let map = self.by_dir.lock().unwrap();
        let mut out = HashMap::new();
        for (path, created_at_ms) in map.iter() {
            if !is_within(path, dir) || path.len() <= dir.len() {
                continue;
            }
            let rest = &path[prefix_len..];
            // Only immediate children: anything deeper is already folded into
            // the child's own entry.
            if rest.contains('/') {
                continue;
            }
            out.insert(rest.to_string(), *created_at_ms);
        }
        Some(out)
    }

    /// Drops a root and everything recorded beneath it — the project closed.
    pub fn forget_root(&self, root: &str) {
        let root = normalize(root);
        self.seeded_roots
            .lock()
            .unwrap()
            .retain(|r| !is_within(r, root));
        self.seeding_roots
            .lock()
            .unwrap()
            .retain(|r| !is_within(r, root));
        self.by_dir
            .lock()
            .unwrap()
            .retain(|dir, _| !is_within(dir, root));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: i64 = 1_700_000_000_000;

    #[test]
    fn an_unseeded_directory_reports_nothing_so_the_caller_still_walks() {
        let cache = RecentCreations::default();
        assert!(cache.newest_by_child("/p/src").is_none());
    }

    #[test]
    fn a_seeded_root_with_no_files_answers_empty_rather_than_unknown() {
        let cache = RecentCreations::default();
        cache.seed_root("/p", &[]);
        assert_eq!(cache.newest_by_child("/p"), Some(HashMap::new()));
    }

    #[test]
    fn a_file_dates_every_directory_above_it() {
        let cache = RecentCreations::default();
        cache.seed_root("/p", &[("/p/src/lib/a.ts".to_string(), T)]);

        assert_eq!(cache.newest_by_child("/p").unwrap().get("src"), Some(&T));
        assert_eq!(
            cache.newest_by_child("/p/src").unwrap().get("lib"),
            Some(&T)
        );
    }

    #[test]
    fn only_immediate_children_are_reported() {
        let cache = RecentCreations::default();
        cache.seed_root("/p", &[("/p/src/lib/a.ts".to_string(), T)]);

        let root = cache.newest_by_child("/p").unwrap();
        assert_eq!(root.len(), 1);
        assert!(root.contains_key("src"));
        assert!(!root.contains_key("lib"));
    }

    #[test]
    fn the_newest_file_wins_and_an_older_one_cannot_pull_it_back() {
        let cache = RecentCreations::default();
        cache.seed_root("/p", &[("/p/src/old.ts".to_string(), T - 90_000)]);
        cache.note_file("/p/src/new.ts", T);
        cache.note_file("/p/src/older.ts", T - 500_000);

        assert_eq!(cache.newest_by_child("/p").unwrap().get("src"), Some(&T));
    }

    #[test]
    fn a_file_noted_after_seeding_reaches_the_root() {
        let cache = RecentCreations::default();
        cache.seed_root("/p", &[]);
        cache.note_file("/p/src/lib/fresh.ts", T);

        assert_eq!(cache.newest_by_child("/p").unwrap().get("src"), Some(&T));
        assert_eq!(
            cache.newest_by_child("/p/src/lib"),
            Some(HashMap::new()),
            "a directory holding only files has no child directories to date"
        );
    }

    #[test]
    fn a_file_outside_every_seeded_root_is_ignored() {
        let cache = RecentCreations::default();
        cache.seed_root("/p", &[]);
        cache.note_file("/elsewhere/other.ts", T);

        assert_eq!(cache.newest_by_child("/p"), Some(HashMap::new()));
        assert!(cache.newest_by_child("/elsewhere").is_none());
    }

    #[test]
    fn a_sibling_root_prefix_is_not_mistaken_for_containment() {
        // "/p2" starts with "/p" as a string but is a different project.
        let cache = RecentCreations::default();
        cache.seed_root("/p", &[]);
        cache.note_file("/p2/src/a.ts", T);

        assert_eq!(cache.newest_by_child("/p"), Some(HashMap::new()));
        assert!(cache.newest_by_child("/p2").is_none());
    }

    #[test]
    fn a_file_reported_while_the_seeding_walk_runs_is_not_lost() {
        // The watcher goes live before the walk finishes. A file created in
        // that gap, in a directory the walk has already passed, is seen by
        // neither half unless notes taken during the pass are kept.
        let cache = RecentCreations::default();
        cache.begin_seeding("/p");
        cache.note_file("/p/src/during.ts", T);
        cache.seed_root("/p", &[("/p/other/before.ts".to_string(), T - 1_000)]);

        let root = cache.newest_by_child("/p").unwrap();
        assert_eq!(root.get("src"), Some(&T));
        assert_eq!(root.get("other"), Some(&(T - 1_000)));
    }

    #[test]
    fn reads_fall_back_to_walking_while_a_seeding_pass_is_in_flight() {
        let cache = RecentCreations::default();
        cache.seed_root("/p", &[("/p/a/x.ts".to_string(), T)]);
        cache.begin_seeding("/p");
        assert!(
            cache.newest_by_child("/p").is_none(),
            "a half-filled root must not answer, or a folder reads as empty"
        );
        cache.seed_root("/p", &[("/p/a/x.ts".to_string(), T)]);
        assert!(cache.newest_by_child("/p").is_some());
    }

    #[test]
    fn a_second_claim_on_an_open_pass_does_not_discard_its_notes() {
        let cache = RecentCreations::default();
        cache.begin_seeding("/p");
        cache.note_file("/p/src/a.ts", T);
        // A racing caller must find the pass already open and leave it alone.
        cache.begin_seeding("/p");
        cache.seed_root("/p", &[]);

        assert_eq!(cache.newest_by_child("/p").unwrap().get("src"), Some(&T));
    }

    #[test]
    fn concurrent_readers_and_writers_neither_deadlock_nor_poison() {
        use std::sync::Arc;
        use std::thread;

        let cache = Arc::new(RecentCreations::default());
        cache.seed_root("/p", &[]);

        let handles: Vec<_> = (0..4)
            .map(|t| {
                let cache = Arc::clone(&cache);
                thread::spawn(move || {
                    for i in 0..250i64 {
                        cache.note_file(&format!("/p/d{t}/f{i}.ts"), T + i);
                        cache.newest_by_child("/p");
                        cache.newest_by_child(&format!("/p/d{t}"));
                        if i % 50 == 0 {
                            cache.seed_root("/p", &[(format!("/p/d{t}/seed.ts"), T)]);
                        }
                    }
                })
            })
            .collect();

        for handle in handles {
            handle
                .join()
                .expect("no thread may panic on a poisoned lock");
        }
        assert!(cache.newest_by_child("/p").is_some());
    }

    #[test]
    fn reseeding_a_root_forgets_what_it_previously_held() {
        let cache = RecentCreations::default();
        cache.seed_root("/p", &[("/p/gone/a.ts".to_string(), T)]);
        cache.seed_root("/p", &[("/p/kept/b.ts".to_string(), T)]);

        let root = cache.newest_by_child("/p").unwrap();
        assert!(!root.contains_key("gone"));
        assert_eq!(root.get("kept"), Some(&T));
    }

    #[test]
    fn reseeding_one_root_leaves_another_alone() {
        let cache = RecentCreations::default();
        cache.seed_root("/a", &[("/a/x/f.ts".to_string(), T)]);
        cache.seed_root("/b", &[("/b/y/f.ts".to_string(), T)]);
        cache.seed_root("/a", &[]);

        assert_eq!(cache.newest_by_child("/a"), Some(HashMap::new()));
        assert_eq!(cache.newest_by_child("/b").unwrap().get("y"), Some(&T));
    }

    #[test]
    fn forgetting_a_root_makes_it_unknown_again() {
        let cache = RecentCreations::default();
        cache.seed_root("/p", &[("/p/src/a.ts".to_string(), T)]);
        cache.forget_root("/p");

        assert!(cache.newest_by_child("/p").is_none());
        assert!(cache.newest_by_child("/p/src").is_none());
    }

    #[test]
    fn the_filesystem_root_is_a_usable_root_rather_than_an_empty_prefix() {
        // "/" is the one path where trimming a trailing slash leaves nothing,
        // and an empty prefix matches everything.
        let cache = RecentCreations::default();
        cache.seed_root("/", &[("/p/a.ts".to_string(), T)]);

        let top = cache.newest_by_child("/").unwrap();
        assert_eq!(top.get("p"), Some(&T));
        assert!(
            !top.contains_key(""),
            "the child key must be a name, not an empty string"
        );
    }

    #[test]
    fn a_trailing_slash_on_the_root_does_not_create_a_second_root() {
        let cache = RecentCreations::default();
        cache.seed_root("/p/", &[("/p/src/a.ts".to_string(), T)]);

        assert_eq!(cache.newest_by_child("/p").unwrap().get("src"), Some(&T));
    }
}
