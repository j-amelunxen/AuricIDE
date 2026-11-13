use super::types::{RecentProject, StarredProject};

pub fn import_legacy_webkit_profiles() -> Vec<RecentProject> {
    super::store::merge_projects(webkit_values(super::types::LEGACY_KEY))
}

pub fn import_legacy_starred_profiles() -> Vec<StarredProject> {
    super::store::merge_starred_projects(webkit_values(super::types::LEGACY_STARRED_KEY))
}

/// Every list stored under `key` in the WebKit `localStorage` of the builds
/// that kept recent and starred projects there. Only macOS builds did.
#[cfg(target_os = "macos")]
fn webkit_values<T: serde::de::DeserializeOwned>(key: &str) -> Vec<T> {
    use walkdir::WalkDir;
    let mut imported = Vec::new();
    for root in crate::webview_prefs::webkit_roots() {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if entry.file_name() == "localstorage.sqlite3" {
                imported.extend(read_webkit_value::<T>(entry.path(), key));
            }
        }
    }
    imported
}

#[cfg(not(target_os = "macos"))]
fn webkit_values<T>(_key: &str) -> Vec<T> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn read_webkit_value<T: serde::de::DeserializeOwned>(path: &std::path::Path, key: &str) -> Vec<T> {
    use rusqlite::{Connection, OpenFlags};
    let Ok(connection) = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    let Ok(value) =
        connection.query_row("SELECT value FROM ItemTable WHERE key = ?1", [key], |row| {
            row.get::<_, Vec<u8>>(0)
        })
    else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<T>>(&decode_webkit_value(&value)).unwrap_or_default()
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
