use super::types::{RecentProject, StarredProject, LEGACY_KEY, LEGACY_STARRED_KEY};
use rusqlite::{Connection, OpenFlags};
use std::path::Path;
use walkdir::WalkDir;

pub fn import_legacy_webkit_profiles() -> Vec<RecentProject> {
    #[cfg(target_os = "macos")]
    {
        let Some(home) = dirs::home_dir() else {
            return Vec::new();
        };
        let roots = ["auric-ide", "com.auricide.ide", "com.auricide.app"];
        let mut imported = Vec::new();
        for app_id in roots {
            let root = home.join("Library/WebKit").join(app_id).join("WebsiteData");
            if !root.exists() {
                continue;
            }
            for entry in WalkDir::new(root)
                .follow_links(false)
                .into_iter()
                .filter_map(Result::ok)
            {
                if entry.file_name() == "localstorage.sqlite3" {
                    imported.extend(read_legacy_sqlite(entry.path()));
                }
            }
        }
        super::store::merge_projects(imported)
    }
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

pub fn import_legacy_starred_profiles() -> Vec<StarredProject> {
    #[cfg(target_os = "macos")]
    {
        let Some(home) = dirs::home_dir() else {
            return Vec::new();
        };
        let roots = ["auric-ide", "com.auricide.ide", "com.auricide.app"];
        let mut imported = Vec::new();
        for app_id in roots {
            let root = home.join("Library/WebKit").join(app_id).join("WebsiteData");
            if !root.exists() {
                continue;
            }
            for entry in WalkDir::new(root)
                .follow_links(false)
                .into_iter()
                .filter_map(Result::ok)
            {
                if entry.file_name() == "localstorage.sqlite3" {
                    imported.extend(read_legacy_starred_sqlite(entry.path()));
                }
            }
        }
        super::store::merge_starred_projects(imported)
    }
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

pub fn read_legacy_sqlite(path: &Path) -> Vec<RecentProject> {
    let Ok(connection) = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    let Ok(value) = connection.query_row(
        "SELECT value FROM ItemTable WHERE key = ?1",
        [LEGACY_KEY],
        |row| row.get::<_, Vec<u8>>(0),
    ) else {
        return Vec::new();
    };
    let decoded = decode_webkit_value(&value);
    serde_json::from_str::<Vec<RecentProject>>(&decoded).unwrap_or_default()
}

pub fn read_legacy_starred_sqlite(path: &Path) -> Vec<StarredProject> {
    let Ok(connection) = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    let Ok(value) = connection.query_row(
        "SELECT value FROM ItemTable WHERE key = ?1",
        [LEGACY_STARRED_KEY],
        |row| row.get::<_, Vec<u8>>(0),
    ) else {
        return Vec::new();
    };
    let decoded = decode_webkit_value(&value);
    serde_json::from_str::<Vec<StarredProject>>(&decoded).unwrap_or_default()
}

/// WebKit stores a `localStorage` value as UTF-16 when it wrote it that way and
/// as plain UTF-8 otherwise, with no flag to say which. Shared with
/// [`crate::webview_prefs`], which reads the same tables.
pub fn decode_webkit_value(value: &[u8]) -> String {
    if value.starts_with(&[0xff, 0xfe]) || value.iter().skip(1).step_by(2).all(|byte| *byte == 0) {
        let offset = if value.starts_with(&[0xff, 0xfe]) {
            2
        } else {
            0
        };
        let units: Vec<u16> = value[offset..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(value).into_owned()
    }
}
