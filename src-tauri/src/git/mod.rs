pub mod blame;
pub mod commands;
pub mod diff;
pub mod discard;
pub mod discovery;
pub mod file_compare;
pub mod graph;
pub mod log;
pub mod merge;
pub mod operation_step;
pub mod refs_ops;
pub mod staging;
pub mod status;
pub mod types;
pub mod worktree_include;
pub mod worktrees;

// Re-export commands for lib.rs and tauri handler
pub use commands::*;

// Shared value types used across the git modules and by callers.
pub use types::*;
pub use worktrees::*;

#[cfg(test)]
pub(crate) mod tests;

/// Opens the repository at `path` for a command that acts on it: anything
/// that is not an openable repository is an error.
pub fn open_repo(path: &str) -> Result<git2::Repository, String> {
    git2::Repository::open(path).map_err(|e| format!("not a git repository: {e}"))
}

/// Opens the repository at `path` for a read that has nothing to show
/// outside one: `None` when no repository is there, an error when one is
/// there but cannot be opened (a broken `.git`, no permission), so a damaged
/// repository is not shown as a clean, empty one.
pub fn open_repo_if_any(path: &str) -> Result<Option<git2::Repository>, String> {
    match git2::Repository::open(path) {
        Ok(repo) => Ok(Some(repo)),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(e) => Err(format!("Cannot open the repository at {path}: {e}")),
    }
}

#[cfg(test)]
mod open_tests {
    use super::open_repo_if_any;

    #[test]
    fn a_folder_without_a_repository_has_nothing_to_show() {
        let dir = tempfile::tempdir().unwrap();
        assert!(open_repo_if_any(dir.path().to_str().unwrap())
            .unwrap()
            .is_none());
    }

    /// A damaged repository must not read as a clean, empty one.
    #[test]
    fn a_broken_repository_is_an_error_not_an_empty_one() {
        let dir = tempfile::tempdir().unwrap();
        git2::Repository::init(dir.path()).unwrap();
        std::fs::write(dir.path().join(".git/config"), "[core\n\tbroken = = =").unwrap();
        assert!(open_repo_if_any(dir.path().to_str().unwrap()).is_err());
    }
}
