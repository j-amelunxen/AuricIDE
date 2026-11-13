//! Files the Rust side owns: one way to write them, one lock, one read that
//! makes each store say what happens to a file it cannot use.
//!
//! The dev and the installed build share `app_data_dir` (same `identifier`),
//! so two processes may write the same store at once. Every write therefore
//! goes through a temp file of its own in the same folder and a rename: a
//! reader sees the old file or the new one, and two writers never truncate
//! each other's temp file. Stores that read, change and write back hold a
//! [`FileLock`] across the whole change when both builds may change them.
//!
//! This module imports nothing from the crate's features.

use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch; 0 for a clock set before it.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |at| at.as_millis() as u64)
}

/// Who may read the written file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// 0600 from the moment the temp file exists. Tightening afterwards would
    /// leave a secret world-readable for the length of the write.
    Private,
    /// Whatever the process umask gives a new file.
    Default,
}

/// Pretty JSON at 0600: the format every Rust-owned store in `app_data_dir`
/// is written in unless it says otherwise.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    write_json_as(path, value, Mode::Private)
}

pub fn write_json_as<T: Serialize>(path: &Path, value: &T, mode: Mode) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    write_atomic(path, &payload, mode)
}

pub fn write_atomic(path: &Path, payload: &[u8], mode: Mode) -> Result<(), String> {
    write_atomic_inspect(path, payload, mode, |_| ())
}

/// As [`write_atomic`], and hands the written temp file to `inspect` before
/// the rename, so a caller can take facts (its stamp) no other writer can
/// have changed yet.
pub fn write_atomic_inspect<R>(
    path: &Path,
    payload: &[u8],
    mode: Mode,
    inspect: impl FnOnce(&File) -> R,
) -> Result<R, String> {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    #[cfg(test)]
    test_support::refuse_if_blocked(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("{} has no file name", path.display()))?
        .to_string_lossy();
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!("{file_name}.{}-{sequence}.tmp", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    if mode == Mode::Private {
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let written = file
        .write_all(payload)
        .and_then(|_| file.sync_all())
        .map(|_| inspect(&file));
    drop(file);
    let inspected = match written {
        Ok(inspected) => inspected,
        Err(error) => {
            let _ = std::fs::remove_file(&temporary);
            return Err(error.to_string());
        }
    };
    std::fs::rename(&temporary, path).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        error.to_string()
    })?;
    Ok(inspected)
}

/// An advisory lock on a file of its own. The lock lives beside the store,
/// not on it, so the rename of the store cannot take the locked file away
/// from under a waiting process. Dropping the guard releases it.
pub struct FileLock {
    _file: File,
}

impl FileLock {
    /// Blocks until `<dir>/<name>` is held exclusively; creates both if absent.
    pub fn acquire(dir: &Path, name: &str) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        Self::acquire_file(&dir.join(name))
    }

    /// Blocks until `path` is held exclusively; creates it at 0600 if absent.
    pub fn acquire_file(path: &Path) -> std::io::Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .mode(0o600)
            .open(path)?;
        loop {
            // SAFETY: the descriptor belongs to `file`, which outlives the call.
            if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
                return Ok(Self { _file: file });
            }
            let error = std::io::Error::last_os_error();
            if error.kind() != ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }
}

/// What a read found.
#[derive(Debug, PartialEq)]
pub enum Read<T> {
    Missing,
    Valid(T),
    Unreadable(String),
}

/// What a store does with a file that exists but cannot be used. Every store
/// names one, so the choice is visible where the store reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unreadable {
    /// An error: nothing is read, and a store that refuses writes nothing either.
    Refuse,
    /// Renamed to `<name>.unreadable-<ms>` and read as absent, so the next
    /// write starts fresh without destroying what the file held.
    MoveAside,
    /// Read as absent and left where it is. The next write replaces it; only
    /// for files whose loss costs nothing a person decided.
    Empty,
}

/// Reads JSON. With `version`, the file's top-level `version` must equal it
/// before the rest is decoded. The reasons are sentences a refusal can quote.
pub fn read_json<T: DeserializeOwned>(path: &Path, version: Option<u64>) -> Read<T> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Read::Missing,
        Err(error) => return Read::Unreadable(error.to_string()),
    };
    let value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(error) => return Read::Unreadable(format!("it is not valid JSON ({error})")),
    };
    if let Some(expected) = version {
        if value.get("version").and_then(serde_json::Value::as_u64) != Some(expected) {
            return Read::Unreadable(format!("this build reads version {expected} only"));
        }
    }
    match serde_json::from_value(value) {
        Ok(parsed) => Read::Valid(parsed),
        Err(error) => Read::Unreadable(format!("an entry is malformed ({error})")),
    }
}

/// [`read_json`] with the store's policy applied: `Ok(None)` is "start from
/// nothing", `Err` a refusal (or a file that could not be moved aside, which
/// must not be overwritten either).
pub fn load<T: DeserializeOwned>(
    path: &Path,
    version: Option<u64>,
    policy: Unreadable,
) -> Result<Option<T>, String> {
    match read_json(path, version) {
        Read::Missing => Ok(None),
        Read::Valid(value) => Ok(Some(value)),
        Read::Unreadable(reason) => match policy {
            Unreadable::Refuse => Err(reason),
            Unreadable::Empty => Ok(None),
            Unreadable::MoveAside => {
                let aside = move_aside(path, now_ms()).map_err(|error| {
                    format!("{reason}; and it could not be moved aside: {error}")
                })?;
                eprintln!(
                    "{} could not be read ({reason}); kept it as {} and started an empty one",
                    path.display(),
                    aside.display()
                );
                Ok(None)
            }
        },
    }
}

/// `<file>.json` → `<file>.json.unreadable-<now>`.
pub fn move_aside(path: &Path, now: u64) -> Result<PathBuf, String> {
    let aside = path.with_extension(format!("json.unreadable-{now}"));
    std::fs::rename(path, &aside).map_err(|error| error.to_string())?;
    Ok(aside)
}

/// Copies a file that would not parse to `<stem>.corrupt-<UTC time>.json.bak`
/// next to it, for the stores that then start empty and overwrite it later.
pub fn keep_corrupt_copy(path: &Path, stem: &str) {
    if path.exists() {
        let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
        let backup = path.with_file_name(format!("{stem}.corrupt-{timestamp}.json.bak"));
        if let Err(error) = std::fs::copy(path, &backup) {
            // The store overwrites the file next; say so while it can still be saved by hand.
            eprintln!(
                "Could not keep a copy of unreadable {} at {}: {error}",
                path.display(),
                backup.display()
            );
        }
    }
}

#[cfg(test)]
pub mod test_support {
    use std::cell::RefCell;
    use std::path::{Path, PathBuf};

    thread_local! {
        static BLOCKED: RefCell<Vec<PathBuf>> = const { RefCell::new(Vec::new()) };
    }

    /// Makes every write to `path` on this thread fail until the guard drops,
    /// for tests of what a store does when it cannot save.
    pub fn block_writes(path: &Path) -> WriteBlock {
        BLOCKED.with(|blocked| blocked.borrow_mut().push(path.to_path_buf()));
        WriteBlock(path.to_path_buf())
    }

    pub struct WriteBlock(PathBuf);

    impl Drop for WriteBlock {
        fn drop(&mut self) {
            BLOCKED.with(|blocked| blocked.borrow_mut().retain(|path| path != &self.0));
        }
    }

    pub(super) fn refuse_if_blocked(path: &Path) -> Result<(), String> {
        BLOCKED.with(|blocked| {
            if blocked.borrow().iter().any(|held| held == path) {
                Err(format!(
                    "writes to {} are blocked by the test",
                    path.display()
                ))
            } else {
                Ok(())
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[derive(Debug, PartialEq, Serialize, serde::Deserialize)]
    struct Stored {
        version: u64,
        items: Vec<String>,
    }

    fn stored(items: &[&str]) -> Stored {
        Stored {
            version: 1,
            items: items.iter().map(|item| item.to_string()).collect(),
        }
    }

    fn leftovers(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect()
    }

    #[test]
    fn a_private_write_lands_at_0600_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("store.json");
        write_json(&path, &stored(&["a"])).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert_eq!(
            read_json::<Stored>(&path, Some(1)),
            Read::Valid(stored(&["a"]))
        );
        assert!(leftovers(path.parent().unwrap()).is_empty());
    }

    #[test]
    fn writers_on_many_threads_never_publish_a_torn_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.json");
        std::thread::scope(|scope| {
            for n in 0..8 {
                let path = &path;
                scope.spawn(move || {
                    for _ in 0..20 {
                        let items = vec![format!("{n}"); 200];
                        write_json(path, &Stored { version: 1, items }).unwrap();
                    }
                });
            }
        });
        assert!(matches!(
            read_json::<Stored>(&path, Some(1)),
            Read::Valid(_)
        ));
        assert!(leftovers(dir.path()).is_empty());
    }

    #[test]
    fn a_failed_rename_removes_its_temp_file_and_keeps_the_old_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.json");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("inside"), "x").unwrap();
        assert!(write_json(&path, &stored(&["a"])).is_err());
        assert!(leftovers(dir.path()).is_empty());
    }

    #[test]
    fn reads_tell_missing_valid_and_unreadable_apart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.json");
        assert_eq!(read_json::<Stored>(&path, Some(1)), Read::Missing);
        std::fs::write(&path, "{").unwrap();
        assert!(matches!(
            read_json::<Stored>(&path, Some(1)),
            Read::Unreadable(reason) if reason.starts_with("it is not valid JSON")
        ));
        std::fs::write(&path, r#"{"version":2,"items":[]}"#).unwrap();
        assert_eq!(
            read_json::<Stored>(&path, Some(1)),
            Read::Unreadable("this build reads version 1 only".into())
        );
        std::fs::write(&path, r#"{"version":1,"items":3}"#).unwrap();
        assert!(matches!(
            read_json::<Stored>(&path, Some(1)),
            Read::Unreadable(reason) if reason.starts_with("an entry is malformed")
        ));
    }

    #[test]
    fn each_policy_does_what_it_says_with_an_unreadable_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.json");
        std::fs::write(&path, "garbage").unwrap();

        assert!(load::<Stored>(&path, Some(1), Unreadable::Refuse).is_err());
        assert_eq!(load::<Stored>(&path, Some(1), Unreadable::Empty), Ok(None));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "garbage");

        assert_eq!(
            load::<Stored>(&path, Some(1), Unreadable::MoveAside),
            Ok(None)
        );
        assert!(!path.exists());
        let aside: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(aside.len(), 1);
        assert!(aside[0].starts_with("store.json.unreadable-"), "{aside:?}");
        assert_eq!(
            std::fs::read_to_string(dir.path().join(&aside[0])).unwrap(),
            "garbage"
        );
    }

    #[test]
    fn a_blocked_path_refuses_writes_until_the_guard_drops() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.json");
        let block = test_support::block_writes(&path);
        assert!(write_json(&path, &stored(&[])).is_err());
        drop(block);
        write_json(&path, &stored(&[])).unwrap();
    }

    #[test]
    fn a_held_lock_makes_a_second_holder_wait() {
        let dir = tempfile::tempdir().unwrap();
        let first = FileLock::acquire(dir.path(), "store.lock").unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        let dir_path = dir.path().to_path_buf();
        let waiter = std::thread::spawn(move || {
            let _second = FileLock::acquire(&dir_path, "store.lock").unwrap();
            sender.send(()).unwrap();
        });
        assert!(receiver
            .recv_timeout(std::time::Duration::from_millis(100))
            .is_err());
        drop(first);
        receiver
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        waiter.join().unwrap();
    }
}
