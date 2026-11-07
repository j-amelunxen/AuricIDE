//! An advisory lock on a file of its own, shared by the stores that are read,
//! changed and renamed into place by more than one process (the dev and the
//! installed build share `app_data_dir`). The lock lives in its own file, so the
//! rename of the store cannot take the locked file away from under a waiting
//! process. Dropping the guard closes the file and releases the lock.

use std::fs::{File, OpenOptions};
use std::io::ErrorKind;
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

pub struct FileLock {
    _file: File,
}

impl FileLock {
    /// Blocks until `<dir>/<name>` is held exclusively; creates both if absent.
    pub fn acquire(dir: &Path, name: &str) -> std::io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .mode(0o600)
            .open(dir.join(name))?;
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
