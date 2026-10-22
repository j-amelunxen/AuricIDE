//! Finding an executable by absolute path, without trusting the process PATH.
//!
//! An app launched from `/Applications` inherits launchd's PATH, which has no
//! Homebrew in it, so lookups walk the *login shell's* PATH instead.

use std::path::{Path, PathBuf};

/// Find an executable by walking a PATH value, without asking a shell. The
/// existence test is injected so the decision can be tested without a disk.
pub fn resolve_in_path(
    name: &str,
    path_var: &str,
    is_executable: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    // An explicit path is already an answer, right or wrong.
    if name.contains(std::path::MAIN_SEPARATOR) {
        let candidate = PathBuf::from(name);
        return is_executable(&candidate).then_some(candidate);
    }
    path_var
        .split(':')
        .filter(|entry| !entry.is_empty())
        .map(|entry| Path::new(entry).join(name))
        .find(|candidate| is_executable(candidate))
}

/// Where an executable was found, and whether PATH alone would have found it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub path: PathBuf,
    pub outside_path: bool,
}

/// PATH first, then the tool's extra folders in order. A folder is looked at
/// only after PATH came up empty, so a binary on PATH always wins.
pub fn resolve_with_extra_dirs(
    name: &str,
    path_var: &str,
    extra_dirs: &[PathBuf],
    is_executable: &dyn Fn(&Path) -> bool,
) -> Option<Resolved> {
    if let Some(path) = resolve_in_path(name, path_var, is_executable) {
        return Some(Resolved {
            path,
            outside_path: false,
        });
    }
    extra_dirs
        .iter()
        .map(|dir| dir.join(name))
        .find(|candidate| is_executable(candidate))
        .map(|path| Resolved {
            path,
            outside_path: true,
        })
}

/// `~/go/bin` → `<home>/go/bin`. Anything else is taken as written.
pub fn expand_home(folder: &str, home: Option<&Path>) -> PathBuf {
    match (folder.strip_prefix("~/"), home) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(folder),
    }
}

/// A file that may be run: a plain `is_file` finds a download that never got
/// its execute bit, and the later probe then fails instead of saying missing.
pub fn on_disk(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    const ANY_EXECUTE_BIT: u32 = 0o111;
    path.metadata()
        .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & ANY_EXECUTE_BIT != 0)
}

/// The PATH the user's shell would give us, which is rarely the PATH a bundled
/// app inherits from launchd.
pub async fn shell_path() -> String {
    crate::agents::cached_login_shell_env()
        .await
        .iter()
        .find(|(key, _)| key == "PATH")
        .map(|(_, value)| value.clone())
        .or_else(|| std::env::var("PATH").ok())
        .unwrap_or_default()
}

/// Absolute path to an executable, resolved through the login shell's PATH.
/// Every command a feature spawns goes through here — a bare
/// `Command::new("ffmpeg")` finds nothing when the app is launched from
/// `/Applications`.
pub async fn resolve_executable(name: &str) -> Option<PathBuf> {
    resolve_in_path(name, &shell_path().await, &on_disk)
}

/// Like [`resolve_executable`], also looking in `extra_dirs` after PATH.
pub async fn resolve_executable_in(name: &str, extra_dirs: &[PathBuf]) -> Option<Resolved> {
    resolve_with_extra_dirs(name, &shell_path().await, extra_dirs, &on_disk)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_lookup_walks_entries_in_order() {
        let exists = |path: &Path| path == Path::new("/opt/homebrew/bin/ffmpeg");
        assert_eq!(
            resolve_in_path("ffmpeg", "/usr/bin:/opt/homebrew/bin", &exists),
            Some(PathBuf::from("/opt/homebrew/bin/ffmpeg"))
        );
    }

    #[test]
    fn path_lookup_reports_absence_rather_than_a_bare_name() {
        let exists = |_: &Path| false;
        assert_eq!(resolve_in_path("ffmpeg", "/usr/bin:/bin", &exists), None);
        assert_eq!(resolve_in_path("ffmpeg", "", &exists), None);
    }

    #[test]
    fn an_explicit_path_is_checked_not_searched() {
        let exists = |path: &Path| path == Path::new("/custom/parakeet");
        assert_eq!(
            resolve_in_path("/custom/parakeet", "/usr/bin", &exists),
            Some(PathBuf::from("/custom/parakeet"))
        );
        assert_eq!(
            resolve_in_path("/missing/parakeet", "/usr/bin", &exists),
            None
        );
    }

    #[test]
    fn a_binary_on_path_wins_over_the_extra_folders() {
        let exists = |path: &Path| {
            path == Path::new("/usr/bin/okf") || path == Path::new("/home/dev/go/bin/okf")
        };
        let found = resolve_with_extra_dirs(
            "okf",
            "/usr/bin",
            &[PathBuf::from("/home/dev/go/bin")],
            &exists,
        );
        assert_eq!(
            found,
            Some(Resolved {
                path: PathBuf::from("/usr/bin/okf"),
                outside_path: false
            })
        );
    }

    #[test]
    fn an_extra_folder_is_used_when_path_has_nothing_and_says_so() {
        let exists = |path: &Path| path == Path::new("/home/dev/go/bin/okf");
        let found = resolve_with_extra_dirs(
            "okf",
            "/usr/bin",
            &[PathBuf::from("/home/dev/go/bin")],
            &exists,
        );
        assert_eq!(
            found,
            Some(Resolved {
                path: PathBuf::from("/home/dev/go/bin/okf"),
                outside_path: true
            })
        );
    }

    #[test]
    fn extra_folders_are_tried_in_order_and_absence_is_none() {
        let exists = |path: &Path| path == Path::new("/second/okf");
        let dirs = [PathBuf::from("/first"), PathBuf::from("/second")];
        assert_eq!(
            resolve_with_extra_dirs("okf", "", &dirs, &exists).map(|r| r.path),
            Some(PathBuf::from("/second/okf"))
        );
        let nothing = |_: &Path| false;
        assert_eq!(
            resolve_with_extra_dirs("okf", "/usr/bin", &dirs, &nothing),
            None
        );
    }

    #[test]
    fn a_leading_tilde_becomes_the_home_folder() {
        let home = Path::new("/Users/dev");
        assert_eq!(
            expand_home("~/go/bin", Some(home)),
            PathBuf::from("/Users/dev/go/bin")
        );
        assert_eq!(
            expand_home("/opt/tools", Some(home)),
            PathBuf::from("/opt/tools")
        );
        assert_eq!(expand_home("~/go/bin", None), PathBuf::from("~/go/bin"));
    }

    #[test]
    fn a_file_without_the_execute_bit_is_not_an_executable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let tool = dir.path().join("okf");
        std::fs::write(&tool, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!on_disk(&tool));
        std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(on_disk(&tool));
    }
}
