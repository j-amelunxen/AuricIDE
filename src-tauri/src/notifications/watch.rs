//! Tells this instance when the inbox changed underneath it.

use rusqlite::Connection;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// The shortest gap between two announcements. A single insert touches the db,
/// the WAL and the shm file, so without this the UI would drain three times
/// for one notification. Events inside the gap are folded into one trailing
/// announcement, never dropped (see `coalesce`): a grant written by a second
/// instance right after another write must still reach the listeners.
const WATCH_DEBOUNCE_MS: u64 = 300;

/// How often the commit counter is read. One `PRAGMA data_version` on an idle
/// connection is a read of the shm header, nothing that shows up in a profile.
const DATA_VERSION_POLL_MS: u64 = 500;

/// Keeps the inbox watch alive. Dropping it stops both signals.
pub struct InboxWatch {
    _files: notify::RecommendedWatcher,
    stop: Arc<AtomicBool>,
}

impl Drop for InboxWatch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Watches the inbox and announces changes as `notifications-changed`.
///
/// This is the channel for everything written by another process — the MCP
/// server, or a second app instance. The app's own dispatches update the store
/// directly and do not wait for this; a drain triggered by our own write is a
/// harmless no-op, since the client only asks for rows past its cursor.
///
/// Two signals feed one announcement:
///
/// - **File events** on the containing directory, not the file: SQLite in WAL
///   mode writes the payload to `notifications.db-wal`. They are quick, but
///   macOS reports a write to the WAL only once the writer closes the file,
///   and every writer here — a second instance, the MCP server — holds its
///   connection open for its whole life. On their own they would announce a
///   grant from another instance whenever that instance quits.
/// - **`PRAGMA data_version`** on a connection of our own. SQLite bumps it for
///   every commit made by any other connection, in any process, whatever the
///   filesystem reports. This is the signal that cannot be missed.
pub fn watch_inbox<F>(db_path: &Path, on_change: F) -> Result<InboxWatch, String>
where
    F: Fn() + Send + 'static,
{
    watch_inbox_with(db_path, on_change, || ())
}

/// `watch_inbox`, with a hook that runs once the file watcher is installed:
/// the moment a commit must not fall between the two signals.
fn watch_inbox_with<F>(
    db_path: &Path,
    on_change: F,
    files_installed: impl FnOnce(),
) -> Result<InboxWatch, String>
where
    F: Fn() + Send + 'static,
{
    // The commit counter's starting point comes first, before anything else
    // is set up: every commit after it is then a change the poller sees,
    // including one that lands while the file watcher is being installed
    // (reviews r1 and r2).
    let probe = Connection::open(db_path)
        .map_err(|e| format!("Failed to open notifications db for watching: {}", e))?;
    let baseline = data_version(&probe);
    let announce = super::coalesce::coalesce(Duration::from_millis(WATCH_DEBOUNCE_MS), on_change);
    let files = watch_files(db_path, announce.clone())?;
    files_installed();
    let stop = Arc::new(AtomicBool::new(false));
    poll_data_version(probe, baseline, announce, Arc::clone(&stop));
    Ok(InboxWatch {
        _files: files,
        stop,
    })
}

/// Announces every change of the commit counter after `baseline`, until
/// `stop` is set.
fn poll_data_version(
    probe: Connection,
    baseline: Option<i64>,
    announce: std::sync::mpsc::SyncSender<()>,
    stop: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        let mut seen = baseline;
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(DATA_VERSION_POLL_MS));
            let now = data_version(&probe);
            if now != seen {
                seen = now;
                if !super::coalesce::notify(&announce) {
                    return;
                }
            }
        }
    });
}

/// `None` when the read failed: a locked or vanished file is not a change, and
/// the next successful read compares against it, so the change after it is
/// still announced.
fn data_version(conn: &Connection) -> Option<i64> {
    conn.query_row("PRAGMA data_version", [], |row| row.get(0))
        .ok()
}

fn watch_files(
    db_path: &Path,
    announce: std::sync::mpsc::SyncSender<()>,
) -> Result<notify::RecommendedWatcher, String> {
    use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};

    let dir = db_path
        .parent()
        .ok_or_else(|| "Notifications db has no parent directory".to_string())?
        .to_path_buf();
    let stem = db_path
        .file_name()
        .ok_or_else(|| "Notifications db has no file name".to_string())?
        .to_string_lossy()
        .to_string();

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            let touches_inbox = event.paths.iter().any(|p| {
                p.file_name()
                    .map(|name| name.to_string_lossy().starts_with(&stem))
                    .unwrap_or(false)
            });
            if touches_inbox {
                super::coalesce::notify(&announce);
            }
        },
        Config::default().with_poll_interval(Duration::from_millis(500)),
    )
    .map_err(|e| format!("Failed to create notifications watcher: {}", e))?;

    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch notifications db: {}", e))?;

    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Review r1 of goal 10: a commit that lands after the watch took its
    /// starting point but before the first poll must still be announced. The
    /// writer keeps its connection open, so no file event comes to the rescue.
    #[test]
    fn a_commit_right_after_the_baseline_is_announced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notifications.db");
        let writer = crate::notifications::init_db(&path).unwrap();
        let probe = Connection::open(&path).unwrap();
        let baseline = data_version(&probe);

        writer
            .execute_batch("CREATE TABLE IF NOT EXISTS t (x); INSERT INTO t VALUES (1);")
            .unwrap();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let stop = Arc::new(AtomicBool::new(false));
        poll_data_version(probe, baseline, tx, Arc::clone(&stop));

        let announced = rx.recv_timeout(Duration::from_millis(DATA_VERSION_POLL_MS * 4));
        stop.store(true, Ordering::Relaxed);
        assert!(
            announced.is_ok(),
            "the commit after the baseline was never announced"
        );
        assert!(rx
            .recv_timeout(Duration::from_millis(DATA_VERSION_POLL_MS * 2))
            .is_err());
    }

    /// Review r2: a commit landing after the file watcher is installed must be
    /// announced too. Taken after it, the baseline would already contain that
    /// commit, and the writer's open connection keeps the file events back.
    #[test]
    fn a_commit_while_the_watch_starts_is_announced() {
        use std::sync::Mutex;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notifications.db");
        let writer = crate::notifications::init_db(&path).unwrap();
        writer.execute_batch("CREATE TABLE t (x);").unwrap();
        let calls = Arc::new(Mutex::new(0usize));
        let sink = Arc::clone(&calls);
        let _watch = watch_inbox_with(
            &path,
            move || *sink.lock().unwrap() += 1,
            || writer.execute_batch("INSERT INTO t VALUES (1);").unwrap(),
        )
        .unwrap();

        std::thread::sleep(Duration::from_millis(DATA_VERSION_POLL_MS * 4));
        assert_eq!(*calls.lock().unwrap(), 1);
    }
}
