//! The preferences the webview keeps in `localStorage`, mirrored to a file in
//! the app data directory.
//!
//! WebKit scopes `localStorage` twice over: once by the data store it picks for
//! the process (`~/Library/WebKit/auric-ide` for the bare dev binary,
//! `~/Library/WebKit/<identifier>` for the bundled app) and once by the page
//! origin (`http://localhost:41873` in dev, `tauri://localhost` in the bundle).
//! Neither axis is ours to align, so a theme picked in the dev app was invisible
//! to the bundled one and back. Everything the backend owns already agreed —
//! `app_data_dir()` resolves from the identifier in the config, the same string
//! in both builds — so this module gives the webview's own store the same
//! footing: one JSON file next to `recent-projects.json`, read at startup and
//! written on every change.
//!
//! The file is the source of truth. A key present in it wins over whatever the
//! local origin happens to hold; a key only the origin has is adopted into the
//! file, which is what carries an existing dev profile over to the first launch
//! of the bundle. Every read-modify-write goes through the file rather than an
//! in-memory copy, because the two builds can run at the same time and each
//! process would otherwise write back a map that predates the other's change.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Bump only for a breaking change; additive fields ride on `#[serde(default)]`.
const STORE_VERSION: u32 = 1;

/// Caps exist so one runaway writer cannot turn a preferences file into
/// something the next launch has to parse before it can show a window.
const MAX_KEYS: usize = 500;
const MAX_KEY_BYTES: usize = 512;
const MAX_VALUE_BYTES: usize = 512 * 1024;

/// Where the mirror lives, given the app data directory.
pub fn prefs_path_in(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("webview-prefs.json")
}

#[derive(Debug, Deserialize, Serialize)]
struct WebviewPrefsFile {
    version: u32,
    #[serde(default)]
    entries: BTreeMap<String, String>,
}

/// The path plus a lock that keeps two commands in *this* process from
/// interleaving their read-modify-write. Across processes the atomic rename
/// still leaves a last-writer-wins window, which for a preference is the same
/// outcome the user would get from changing it twice.
pub struct WebviewPrefsState {
    path: PathBuf,
    lock: Mutex<()>,
}

impl WebviewPrefsState {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }
}

/// True when the pair is small enough to be worth mirroring.
fn is_storable(key: &str, value: &str) -> bool {
    !key.is_empty() && key.len() <= MAX_KEY_BYTES && value.len() <= MAX_VALUE_BYTES
}

/// Reads the mirror. A missing file is an empty one. A corrupt file is kept
/// aside under a timestamped name and then treated as empty — losing the
/// preferences hurts, but refusing to boot over them hurts more.
pub fn read_prefs(path: &Path) -> BTreeMap<String, String> {
    if !path.exists() {
        return BTreeMap::new();
    }
    let parsed = fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<WebviewPrefsFile>(&contents).ok());
    match parsed {
        Some(file) => file.entries,
        None => {
            preserve_corrupt_prefs(path);
            BTreeMap::new()
        }
    }
}

fn preserve_corrupt_prefs(path: &Path) {
    let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ");
    let backup = path.with_file_name(format!("webview-prefs.corrupt-{timestamp}.json.bak"));
    let _ = fs::copy(path, backup);
}

/// Writes the mirror through a temp file and a rename, so a launch that lands
/// mid-write reads either the old file or the new one.
pub fn write_prefs_atomic(path: &Path, entries: &BTreeMap<String, String>) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Webview prefs store has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    let payload = serde_json::to_vec_pretty(&WebviewPrefsFile {
        version: STORE_VERSION,
        entries: entries.clone(),
    })
    .map_err(|error| error.to_string())?;
    let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
    file.write_all(&payload)
        .and_then(|_| file.sync_all())
        .map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())?;
    Ok(())
}

/// The startup reconciliation: the stored value wins wherever both sides have
/// the key, and a key only the webview has is adopted so an existing profile
/// carries over the first time the other build runs.
pub fn merge_prefs(
    stored: BTreeMap<String, String>,
    local: BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut merged = stored;
    for (key, value) in local {
        if !is_storable(&key, &value) {
            continue;
        }
        merged.entry(key).or_insert(value);
    }
    while merged.len() > MAX_KEYS {
        let last = merged.keys().next_back().cloned();
        match last {
            Some(key) => {
                merged.remove(&key);
            }
            None => break,
        }
    }
    merged
}

/// Reads every pair out of one of WebKit's `localstorage.sqlite3` files.
/// Anything unreadable — a file that is not a database, a schema from another
/// WebKit version, a store held open elsewhere — comes back empty, because this
/// is a convenience at first launch and never the only way in.
fn read_webkit_store(path: &Path) -> BTreeMap<String, String> {
    let Ok(connection) = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return BTreeMap::new();
    };
    let Ok(mut statement) = connection.prepare("SELECT key, value FROM ItemTable") else {
        return BTreeMap::new();
    };
    let Ok(rows) = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
    }) else {
        return BTreeMap::new();
    };
    let mut entries = BTreeMap::new();
    for (key, value) in rows.flatten() {
        let decoded = crate::recent_projects::decode_webkit_value(&value);
        if is_storable(&key, &decoded) {
            entries.insert(key, decoded);
        }
    }
    entries
}

/// The WebKit data stores this app has ever written under. The bare dev binary
/// lands under its process name, the bundled app under its identifier, and
/// `com.auricide.app` is an identifier an earlier build used.
fn webkit_roots() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    ["auric-ide", "com.auricide.ide", "com.auricide.app"]
        .iter()
        .map(|app_id| home.join("Library/WebKit").join(app_id).join("WebsiteData"))
        .collect()
}

/// Fills the shared file the first time from whichever webview store was
/// written to most recently.
///
/// Which build the user launches first after this lands must not decide whose
/// preferences survive. The last store touched is the one they were actually
/// working in, so that is the one that seeds the file both builds then follow.
fn seed_from_webkit_stores(roots: &[PathBuf]) -> BTreeMap<String, String> {
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for root in roots {
        if !root.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if entry.file_name() != "localstorage.sqlite3" {
                continue;
            }
            let Some(modified) = entry.metadata().ok().and_then(|meta| meta.modified().ok()) else {
                continue;
            };
            let is_newer = match &newest {
                Some((previous, _)) => modified > *previous,
                None => true,
            };
            if is_newer {
                newest = Some((modified, entry.path().to_path_buf()));
            }
        }
    }
    match newest {
        Some((_, path)) => read_webkit_store(&path),
        None => BTreeMap::new(),
    }
}

#[tauri::command]
pub fn webview_prefs_sync(
    local: BTreeMap<String, String>,
    state: tauri::State<'_, WebviewPrefsState>,
) -> Result<BTreeMap<String, String>, String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "Webview prefs lock poisoned".to_string())?;
    let stored = if state.path.exists() {
        read_prefs(&state.path)
    } else {
        seed_from_webkit_stores(&webkit_roots())
    };
    let merged = merge_prefs(stored, local);
    write_prefs_atomic(&state.path, &merged)?;
    Ok(merged)
}

#[tauri::command]
pub fn webview_prefs_set(
    key: String,
    value: String,
    state: tauri::State<'_, WebviewPrefsState>,
) -> Result<(), String> {
    if !is_storable(&key, &value) {
        return Err(format!(
            "Preference {key:?} is not storable: keys are capped at {MAX_KEY_BYTES} bytes, values at {MAX_VALUE_BYTES}"
        ));
    }
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "Webview prefs lock poisoned".to_string())?;
    let mut entries = read_prefs(&state.path);
    if entries.get(&key).is_some_and(|stored| stored == &value) {
        return Ok(());
    }
    if entries.len() >= MAX_KEYS && !entries.contains_key(&key) {
        return Err(format!("Webview prefs store is full at {MAX_KEYS} keys"));
    }
    entries.insert(key, value);
    write_prefs_atomic(&state.path, &entries)
}

#[tauri::command]
pub fn webview_prefs_remove(
    key: String,
    state: tauri::State<'_, WebviewPrefsState>,
) -> Result<(), String> {
    let _guard = state
        .lock
        .lock()
        .map_err(|_| "Webview prefs lock poisoned".to_string())?;
    let mut entries = read_prefs(&state.path);
    if entries.remove(&key).is_none() {
        return Ok(());
    }
    write_prefs_atomic(&state.path, &entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn test_prefs_path_sits_next_to_the_other_stores() {
        let path = prefs_path_in(Path::new("/tmp/appdata"));
        assert_eq!(path, PathBuf::from("/tmp/appdata/webview-prefs.json"));
    }

    #[test]
    fn test_read_prefs_returns_empty_for_a_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_prefs(&dir.path().join("webview-prefs.json")).is_empty());
    }

    #[test]
    fn test_write_then_read_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("webview-prefs.json");
        let entries = map(&[
            ("auric.theme", "aurora"),
            ("auric-show-attribution", "true"),
        ]);
        write_prefs_atomic(&path, &entries).unwrap();
        assert_eq!(read_prefs(&path), entries);
    }

    /// A half-written or hand-edited file must not stop the app from starting,
    /// and the bytes are kept so the loss is recoverable.
    #[test]
    fn test_corrupt_file_is_quarantined_and_read_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("webview-prefs.json");
        fs::write(&path, "{ not json").unwrap();

        assert!(read_prefs(&path).is_empty());

        let quarantined: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.starts_with("webview-prefs.corrupt-"))
            .collect();
        assert_eq!(quarantined.len(), 1, "expected one quarantined copy");
    }

    #[test]
    fn test_merge_lets_the_stored_value_win() {
        let merged = merge_prefs(
            map(&[("auric.theme", "aurora")]),
            map(&[("auric.theme", "ember")]),
        );
        assert_eq!(merged.get("auric.theme").unwrap(), "aurora");
    }

    /// The first launch of the other build has an empty file and a full local
    /// origin — that profile has to travel, or the user "loses" their settings.
    #[test]
    fn test_merge_adopts_keys_only_the_webview_has() {
        let merged = merge_prefs(BTreeMap::new(), map(&[("auric.theme", "ember")]));
        assert_eq!(merged.get("auric.theme").unwrap(), "ember");
    }

    #[test]
    fn test_merge_drops_oversized_local_values() {
        let huge = "x".repeat(MAX_VALUE_BYTES + 1);
        let merged = merge_prefs(BTreeMap::new(), map(&[("big", huge.as_str()), ("ok", "1")]));
        assert!(!merged.contains_key("big"));
        assert_eq!(merged.get("ok").unwrap(), "1");
    }

    #[test]
    fn test_merge_caps_the_number_of_keys() {
        let local: BTreeMap<String, String> = (0..MAX_KEYS + 25)
            .map(|index| (format!("key-{index:04}"), "v".to_string()))
            .collect();
        assert_eq!(merge_prefs(BTreeMap::new(), local).len(), MAX_KEYS);
    }

    /// Builds a file shaped like the one WebKit keeps, values included as the
    /// UTF-16 blobs it actually writes.
    fn write_webkit_store(path: &Path, entries: &[(&str, &str)]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let connection = rusqlite::Connection::open(path).unwrap();
        connection
            .execute("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB NOT NULL ON CONFLICT FAIL)", [])
            .unwrap();
        for (key, value) in entries {
            let utf16: Vec<u8> = value
                .encode_utf16()
                .flat_map(|unit| unit.to_le_bytes())
                .collect();
            connection
                .execute(
                    "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
                    rusqlite::params![key, utf16],
                )
                .unwrap();
        }
    }

    #[test]
    fn test_reads_every_entry_out_of_a_webkit_store() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("LocalStorage/localstorage.sqlite3");
        write_webkit_store(
            &store,
            &[("auric.theme", "amber"), ("auric.accent", "amber")],
        );

        let entries = read_webkit_store(&store);

        assert_eq!(entries.get("auric.theme").unwrap(), "amber");
        assert_eq!(entries.get("auric.accent").unwrap(), "amber");
    }

    #[test]
    fn test_reading_a_file_that_is_not_a_webkit_store_yields_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("localstorage.sqlite3");
        fs::write(&path, "not a database").unwrap();

        assert!(read_webkit_store(&path).is_empty());
    }

    /// Whichever build the user reached for last holds the values worth
    /// keeping. Without this the first launch after the update would decide it
    /// — start the installed app before the dev one and a months-old theme
    /// would win.
    #[test]
    fn test_newest_store_wins_across_the_webkit_roots() {
        let dir = tempfile::tempdir().unwrap();
        let older = dir.path().join("old/LocalStorage/localstorage.sqlite3");
        let newer = dir.path().join("new/LocalStorage/localstorage.sqlite3");
        write_webkit_store(&older, &[("auric.theme", "stale")]);
        write_webkit_store(&newer, &[("auric.theme", "current")]);
        let long_ago =
            std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000);
        fs::File::options()
            .write(true)
            .open(&older)
            .unwrap()
            .set_modified(long_ago)
            .unwrap();

        let seeded = seed_from_webkit_stores(&[dir.path().join("old"), dir.path().join("new")]);

        assert_eq!(seeded.get("auric.theme").unwrap(), "current");
    }

    #[test]
    fn test_seeding_finds_nothing_when_no_store_exists() {
        let dir = tempfile::tempdir().unwrap();
        assert!(seed_from_webkit_stores(&[dir.path().join("absent")]).is_empty());
    }
}
