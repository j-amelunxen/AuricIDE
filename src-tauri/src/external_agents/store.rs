//! `<app_data_dir>/external-agents.json`. Read before every change rather than
//! cached, because the dev and the installed build share the folder, and held
//! under a file lock from that read to the rename, so neither two connections
//! nor two builds can lose each other's entry.

use super::model::{ExternalError, ExternalFile, STORE_FILE_NAME, STORE_VERSION};
use crate::supervisor::write_json_atomic;
use std::fs::{File, OpenOptions};
use std::io::ErrorKind;
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

const LOCK_FILE_NAME: &str = "external-agents.lock";

pub fn store_path_in(app_data: &Path) -> PathBuf {
    app_data.join(STORE_FILE_NAME)
}

/// Absent is a store with nothing in it. Anything else that cannot be read is
/// refused rather than treated as empty, or the next write would replace it.
pub fn read(app_data: &Path) -> Result<ExternalFile, ExternalError> {
    let unreadable = |reason: String| ExternalError::Unreadable(reason);
    let text = match std::fs::read_to_string(store_path_in(app_data)) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(ExternalFile::default()),
        Err(error) => return Err(unreadable(error.to_string())),
    };
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| unreadable(format!("it is not valid JSON ({error})")))?;
    let version = value.get("version").and_then(serde_json::Value::as_u64);
    if version != Some(u64::from(STORE_VERSION)) {
        return Err(unreadable(format!(
            "this build reads version {STORE_VERSION} only"
        )));
    }
    serde_json::from_value(value)
        .map_err(|error| unreadable(format!("an entry is malformed ({error})")))
}

/// An advisory lock on a file of its own, so the rename of the store cannot
/// take the locked file away from under a waiting process. Closing the file
/// releases it.
struct FileLock {
    _file: File,
}

impl FileLock {
    fn acquire(app_data: &Path) -> Result<Self, ExternalError> {
        let storage = |error: std::io::Error| ExternalError::Storage(error.to_string());
        std::fs::create_dir_all(app_data).map_err(storage)?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .mode(0o600)
            .open(app_data.join(LOCK_FILE_NAME))
            .map_err(storage)?;
        loop {
            // SAFETY: the descriptor belongs to `file`, which outlives the call.
            if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
                return Ok(Self { _file: file });
            }
            let error = std::io::Error::last_os_error();
            if error.kind() != ErrorKind::Interrupted {
                return Err(storage(error));
            }
        }
    }
}

/// One whole change: lock, read, `change`, write, unlock. `change` answers its
/// result and whether it touched anything; a refusal writes nothing.
pub fn update<T>(
    app_data: &Path,
    now: u64,
    change: impl FnOnce(&mut ExternalFile) -> Result<(T, bool), ExternalError>,
) -> Result<T, ExternalError> {
    let _lock = FileLock::acquire(app_data)?;
    let mut file = read(app_data)?;
    let (result, touched) = change(&mut file)?;
    let pruned = file.prune(now);
    if touched || pruned {
        write_json_atomic(&store_path_in(app_data), &file).map_err(ExternalError::Storage)?;
    }
    Ok(result)
}
