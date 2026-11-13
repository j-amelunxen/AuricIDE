//! `<app_data_dir>/external-agents.json`. Read before every change rather than
//! cached, because the dev and the installed build share the folder, and held
//! under a file lock from that read to the rename, so neither two connections
//! nor two builds can lose each other's entry.

use super::model::{ExternalError, ExternalFile, STORE_FILE_NAME, STORE_VERSION};
use crate::json_store::{self, write_json, FileLock, Unreadable};
use std::path::{Path, PathBuf};

const LOCK_FILE_NAME: &str = "external-agents.lock";

pub fn store_path_in(app_data: &Path) -> PathBuf {
    app_data.join(STORE_FILE_NAME)
}

/// Absent is a store with nothing in it. Anything else that cannot be read is
/// refused rather than treated as empty, or the next write would replace it.
pub fn read(app_data: &Path) -> Result<ExternalFile, ExternalError> {
    json_store::load(
        &store_path_in(app_data),
        Some(u64::from(STORE_VERSION)),
        Unreadable::Refuse,
    )
    .map(Option::unwrap_or_default)
    .map_err(ExternalError::Unreadable)
}

/// One whole change: lock, read, `change`, write, unlock. `change` answers its
/// result and whether it touched anything; a refusal writes nothing.
pub fn update<T>(
    app_data: &Path,
    now: u64,
    change: impl FnOnce(&mut ExternalFile) -> Result<(T, bool), ExternalError>,
) -> Result<T, ExternalError> {
    let _lock = FileLock::acquire(app_data, LOCK_FILE_NAME)
        .map_err(|error| ExternalError::Storage(error.to_string()))?;
    let mut file = read(app_data)?;
    let (result, touched) = change(&mut file)?;
    let pruned = file.prune(now);
    if touched || pruned {
        write_json(&store_path_in(app_data), &file).map_err(ExternalError::Storage)?;
    }
    Ok(result)
}
