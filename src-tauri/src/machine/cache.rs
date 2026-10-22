//! What a tool answered to its version probe, remembered per binary.
//!
//! The key is the absolute path *and* the file's modification time: the same
//! binary gives the same answer, while a reinstall or upgrade changes the
//! mtime and the next check probes again. Nothing else expires an entry.

use super::version::Version;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VersionProbe {
    Version(Version),
    /// The tool ran but printed something we cannot read.
    Unreadable,
}

#[derive(Default)]
pub struct VersionCache {
    entries: Mutex<HashMap<(PathBuf, SystemTime), VersionProbe>>,
}

impl VersionCache {
    pub fn get(&self, path: &Path, mtime: SystemTime) -> Option<VersionProbe> {
        let entries = self.entries.lock().ok()?;
        entries.get(&(path.to_path_buf(), mtime)).copied()
    }

    /// An unreadable answer is not kept: a one-off failure would otherwise
    /// stand until the binary is reinstalled.
    pub fn put(&self, path: &Path, mtime: SystemTime, probe: VersionProbe) {
        if probe == VersionProbe::Unreadable {
            return;
        }
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert((path.to_path_buf(), mtime), probe);
        }
    }
}

pub fn modified_at(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok()?.modified().ok()
}

/// The process-wide cache the declared table probes through.
pub fn versions() -> &'static VersionCache {
    static VERSIONS: OnceLock<VersionCache> = OnceLock::new();
    VERSIONS.get_or_init(VersionCache::default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn at(seconds: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(seconds)
    }

    #[test]
    fn the_same_binary_gives_the_remembered_answer() {
        let cache = VersionCache::default();
        let path = Path::new("/bin/okf");
        cache.put(path, at(10), VersionProbe::Version((0, 7, 0)));
        assert_eq!(
            cache.get(path, at(10)),
            Some(VersionProbe::Version((0, 7, 0)))
        );
    }

    #[test]
    fn a_changed_modification_time_is_a_different_binary() {
        let cache = VersionCache::default();
        let path = Path::new("/bin/okf");
        cache.put(path, at(10), VersionProbe::Version((0, 7, 0)));
        assert_eq!(cache.get(path, at(11)), None);
    }

    #[test]
    fn another_path_is_another_binary() {
        let cache = VersionCache::default();
        cache.put(
            Path::new("/a/okf"),
            at(10),
            VersionProbe::Version((1, 0, 0)),
        );
        assert_eq!(cache.get(Path::new("/b/okf"), at(10)), None);
    }

    #[test]
    fn an_unreadable_answer_is_asked_again_next_time() {
        let cache = VersionCache::default();
        let path = Path::new("/bin/okf");
        cache.put(path, at(10), VersionProbe::Unreadable);
        assert_eq!(cache.get(path, at(10)), None);
    }

    #[test]
    fn modified_at_is_none_for_a_file_that_is_not_there() {
        assert_eq!(modified_at(Path::new("/definitely/not/here")), None);
    }

    #[test]
    fn modified_at_reads_a_real_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("tool");
        std::fs::write(&file, "x").unwrap();
        assert!(modified_at(&file).is_some());
    }
}
