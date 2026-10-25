use git2::Patch;
use std::fs;
use std::path::Path;

pub(crate) const MAX_COMPARE_BYTES: u64 = 5 * 1024 * 1024;
/// Same window git itself scans for a NUL byte to call a file binary.
const BINARY_SNIFF_BYTES: usize = 8000;

fn display_name(path: &str) -> &str {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
}

fn read_comparable(path: &str) -> Result<Vec<u8>, String> {
    let name = display_name(path);
    let metadata = fs::metadata(path).map_err(|_| format!("{name} could not be read."))?;
    if !metadata.is_file() {
        return Err(format!("{name} is not a file and cannot be compared."));
    }
    if metadata.len() > MAX_COMPARE_BYTES {
        return Err(format!(
            "{name} is larger than 5 MB and cannot be compared."
        ));
    }
    let bytes = fs::read(path).map_err(|_| format!("{name} could not be read."))?;
    if bytes.iter().take(BINARY_SNIFF_BYTES).any(|&byte| byte == 0) {
        return Err(format!(
            "{name} looks like a binary file and cannot be compared."
        ));
    }
    Ok(bytes)
}

/// Unified diff of two files on disk, in the format `parseDiff` reads. Empty when identical.
pub fn diff_files_impl(left: &str, right: &str) -> Result<String, String> {
    let left_bytes = read_comparable(left)?;
    let right_bytes = read_comparable(right)?;
    if left_bytes == right_bytes {
        return Ok(String::new());
    }
    let mut patch = Patch::from_buffers(
        &left_bytes,
        Some(Path::new(display_name(left))),
        &right_bytes,
        Some(Path::new(display_name(right))),
        None,
    )
    .map_err(|e| format!("Failed to compare the files: {e}"))?;
    let buf = patch
        .to_buf()
        .map_err(|e| format!("Failed to compare the files: {e}"))?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}
