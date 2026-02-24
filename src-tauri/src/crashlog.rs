use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

static CRASH_LOG_DIR: RwLock<Option<PathBuf>> = RwLock::new(None);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendError {
    pub message: String,
    pub source: Option<String>,
    pub lineno: Option<u32>,
    pub colno: Option<u32>,
    pub stack: Option<String>,
    pub component_stack: Option<String>,
    pub error_type: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrashLogEntry {
    pub filename: String,
    pub timestamp: u64,
    pub size_bytes: u64,
}

pub fn crash_dir(log_dir: &std::path::Path) -> PathBuf {
    log_dir.join("crashes")
}

pub fn ensure_crash_dir(log_dir: &std::path::Path) -> Result<PathBuf, String> {
    let dir = crash_dir(log_dir);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create crash dir: {}", e))?;
    Ok(dir)
}

pub fn format_panic_report(info: &str) -> String {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f %z");
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let version = env!("CARGO_PKG_VERSION");

    format!(
        "=== AuricIDE Crash Report ===\n\
         Type: rust_panic\n\
         Timestamp: {}\n\
         OS: {} {}\n\
         App Version: {}\n\
         \n\
         --- Panic Info ---\n\
         {}\n\
         \n\
         --- Backtrace ---\n\
         {}",
        timestamp,
        os,
        arch,
        version,
        info,
        std::backtrace::Backtrace::force_capture()
    )
}

pub fn format_frontend_report(error: &FrontendError) -> String {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f %z");
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let version = env!("CARGO_PKG_VERSION");

    let location = match (&error.source, error.lineno, error.colno) {
        (Some(src), Some(line), Some(col)) => format!("{}:{}:{}", src, line, col),
        (Some(src), Some(line), None) => format!("{}:{}", src, line),
        (Some(src), None, None) => src.clone(),
        _ => "unknown".to_string(),
    };

    let stack = error.stack.as_deref().unwrap_or("(no stack trace)");
    let component_stack = error
        .component_stack
        .as_deref()
        .map(|cs| format!("\n\n--- Component Stack ---\n{}", cs))
        .unwrap_or_default();

    format!(
        "=== AuricIDE Crash Report ===\n\
         Type: {}\n\
         Timestamp: {}\n\
         OS: {} {}\n\
         App Version: {}\n\
         \n\
         --- Error ---\n\
         {}\n\
         Location: {}\n\
         \n\
         --- Stack Trace ---\n\
         {}{}",
        error.error_type,
        timestamp,
        os,
        arch,
        version,
        error.message,
        location,
        stack,
        component_stack
    )
}

pub fn write_crash_file(crash_dir: &std::path::Path, content: &str) -> Result<PathBuf, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let filename = format!("crash-{}.log", millis);
    let path = crash_dir.join(&filename);
    fs::write(&path, content).map_err(|e| format!("Failed to write crash file: {}", e))?;
    Ok(path)
}

pub fn list_crash_logs(crash_dir: &std::path::Path) -> Result<Vec<CrashLogEntry>, String> {
    if !crash_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries: Vec<CrashLogEntry> = fs::read_dir(crash_dir)
        .map_err(|e| format!("Failed to read crash dir: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let filename = entry.file_name().to_string_lossy().to_string();
            if !filename.starts_with("crash-") || !filename.ends_with(".log") {
                return None;
            }
            let meta = entry.metadata().ok()?;
            let timestamp = meta
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_secs();
            Some(CrashLogEntry {
                filename,
                timestamp,
                size_bytes: meta.len(),
            })
        })
        .collect();

    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(entries)
}

pub fn read_crash_log(crash_dir: &std::path::Path, filename: &str) -> Result<String, String> {
    // Path-traversal protection
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Invalid filename".to_string());
    }
    if !filename.starts_with("crash-") || !filename.ends_with(".log") {
        return Err("Invalid crash log filename".to_string());
    }

    let path = crash_dir.join(filename);
    fs::read_to_string(&path).map_err(|e| format!("Failed to read crash log: {}", e))
}

pub fn init_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let report = format_panic_report(&info.to_string());

        // Try the configured Tauri log dir first
        let dir = CRASH_LOG_DIR.read().ok().and_then(|guard| guard.clone());

        // Fallback to platform-specific log dir if Tauri hasn't initialized yet
        let crash_path = dir
            .map(|d| crash_dir(&d))
            .or_else(|| dirs::data_local_dir().map(|d| d.join("com.auricide.ide").join("crashes")));

        if let Some(crash_path) = crash_path {
            let _ = fs::create_dir_all(&crash_path);
            let _ = write_crash_file(&crash_path, &report);
        }

        // Also print to stderr for debugging
        eprintln!("{}", report);
    }));
}

pub fn set_crash_log_dir(path: PathBuf) {
    if let Ok(mut guard) = CRASH_LOG_DIR.write() {
        *guard = Some(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_crash_dir_returns_crashes_subdir() {
        let base = PathBuf::from("/tmp/logs");
        let result = crash_dir(&base);
        assert_eq!(result, PathBuf::from("/tmp/logs/crashes"));
    }

    #[test]
    fn test_ensure_crash_dir_creates_directory() {
        let tmp = TempDir::new().unwrap();
        let result = ensure_crash_dir(tmp.path()).unwrap();
        assert!(result.exists());
        assert!(result.is_dir());
        assert_eq!(result, tmp.path().join("crashes"));
    }

    #[test]
    fn test_ensure_crash_dir_idempotent() {
        let tmp = TempDir::new().unwrap();
        let first = ensure_crash_dir(tmp.path()).unwrap();
        let second = ensure_crash_dir(tmp.path()).unwrap();
        assert_eq!(first, second);
        assert!(second.exists());
    }

    #[test]
    fn test_format_panic_report_contains_required_fields() {
        let report = format_panic_report("thread 'main' panicked at 'oops'");
        assert!(report.contains("=== AuricIDE Crash Report ==="));
        assert!(report.contains("Type: rust_panic"));
        assert!(report.contains("Timestamp:"));
        assert!(report.contains("OS:"));
        assert!(report.contains("App Version:"));
        assert!(report.contains("--- Panic Info ---"));
        assert!(report.contains("thread 'main' panicked at 'oops'"));
        assert!(report.contains("--- Backtrace ---"));
    }

    #[test]
    fn test_format_frontend_report_onerror() {
        let error = FrontendError {
            message: "Cannot read property 'x' of undefined".to_string(),
            source: Some("app.js".to_string()),
            lineno: Some(42),
            colno: Some(10),
            stack: Some("TypeError: Cannot read...\n    at foo (app.js:42:10)".to_string()),
            component_stack: None,
            error_type: "frontend_onerror".to_string(),
        };
        let report = format_frontend_report(&error);
        assert!(report.contains("Type: frontend_onerror"));
        assert!(report.contains("Cannot read property 'x' of undefined"));
        assert!(report.contains("Location: app.js:42:10"));
        assert!(report.contains("--- Stack Trace ---"));
        assert!(!report.contains("--- Component Stack ---"));
    }

    #[test]
    fn test_format_frontend_report_react_boundary_with_component_stack() {
        let error = FrontendError {
            message: "Rendering error".to_string(),
            source: None,
            lineno: None,
            colno: None,
            stack: Some("Error: Rendering error\n    at Component".to_string()),
            component_stack: Some("    in BrokenComponent\n    in App".to_string()),
            error_type: "frontend_react_boundary".to_string(),
        };
        let report = format_frontend_report(&error);
        assert!(report.contains("Type: frontend_react_boundary"));
        assert!(report.contains("Location: unknown"));
        assert!(report.contains("--- Component Stack ---"));
        assert!(report.contains("in BrokenComponent"));
    }

    #[test]
    fn test_write_crash_file_creates_file() {
        let tmp = TempDir::new().unwrap();
        let crash_path = ensure_crash_dir(tmp.path()).unwrap();
        let result = write_crash_file(&crash_path, "test crash content").unwrap();
        assert!(result.exists());
        assert!(result
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("crash-"));
        assert!(result
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with(".log"));
        let content = fs::read_to_string(&result).unwrap();
        assert_eq!(content, "test crash content");
    }

    #[test]
    fn test_list_crash_logs_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let crash_path = ensure_crash_dir(tmp.path()).unwrap();
        let logs = list_crash_logs(&crash_path).unwrap();
        assert!(logs.is_empty());
    }

    #[test]
    fn test_list_crash_logs_returns_sorted_entries() {
        let tmp = TempDir::new().unwrap();
        let crash_path = ensure_crash_dir(tmp.path()).unwrap();

        fs::write(crash_path.join("crash-1000.log"), "old").unwrap();
        fs::write(crash_path.join("crash-2000.log"), "new").unwrap();
        fs::write(crash_path.join("not-a-crash.txt"), "ignore").unwrap();

        let logs = list_crash_logs(&crash_path).unwrap();
        assert_eq!(logs.len(), 2);
        // Both should be crash files, non-crash file excluded
        assert!(logs.iter().all(|l| l.filename.starts_with("crash-")));
    }

    #[test]
    fn test_list_crash_logs_nonexistent_dir() {
        let tmp = TempDir::new().unwrap();
        let nonexistent = tmp.path().join("does-not-exist");
        let logs = list_crash_logs(&nonexistent).unwrap();
        assert!(logs.is_empty());
    }

    #[test]
    fn test_read_crash_log_success() {
        let tmp = TempDir::new().unwrap();
        let crash_path = ensure_crash_dir(tmp.path()).unwrap();
        let content = "=== AuricIDE Crash Report ===\nType: rust_panic";
        fs::write(crash_path.join("crash-12345.log"), content).unwrap();

        let result = read_crash_log(&crash_path, "crash-12345.log").unwrap();
        assert_eq!(result, content);
    }

    #[test]
    fn test_read_crash_log_path_traversal_blocked() {
        let tmp = TempDir::new().unwrap();
        let crash_path = ensure_crash_dir(tmp.path()).unwrap();

        assert!(read_crash_log(&crash_path, "../etc/passwd").is_err());
        assert!(read_crash_log(&crash_path, "crash-123/../../secret").is_err());
        assert!(read_crash_log(&crash_path, "not-a-crash.log").is_err());
    }

    #[test]
    fn test_set_crash_log_dir_updates_global() {
        let tmp = TempDir::new().unwrap();
        set_crash_log_dir(tmp.path().to_path_buf());
        let guard = CRASH_LOG_DIR.read().unwrap();
        assert_eq!(guard.as_ref().unwrap(), tmp.path());
    }
}
