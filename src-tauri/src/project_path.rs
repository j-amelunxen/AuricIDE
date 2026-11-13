//! Project identity shared by policy, supervisors and external sessions.
//!
//! Filesystem identity and textual policy keys have different failure rules:
//! a missing path has no real path, string keys retain normalized spelling,
//! and folder comparison retains the original Path when resolution fails.

use std::path::{Path, PathBuf};

/// The filesystem's real path, or no answer if resolution fails. This does
/// not require a directory: callers still decide which kind of path they allow.
pub fn real_path(path: &Path) -> Option<PathBuf> {
    path.canonicalize().ok()
}

/// `/abs/project-a/` → `/abs/project-a`; the root stays `/`.
pub fn normalize_project_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() && path.starts_with('/') {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

/// The real path when it can be represented as UTF-8, the normalized text
/// otherwise. Policy lookup keeps its original fallback for missing paths.
pub fn canonical_project_path(path: &str) -> String {
    real_path(Path::new(path))
        .and_then(|real| real.to_str().map(str::to_string))
        .unwrap_or_else(|| normalize_project_path(path))
}

/// Compare real paths when possible, retaining each original Path on failure.
/// Unlike policy-key normalization, this does not trim or rewrite missing paths.
pub fn same_folder(a: &Path, b: &Path) -> bool {
    let canonical = |path: &Path| real_path(path).unwrap_or_else(|| path.to_path_buf());
    a == b || canonical(a) == canonical(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn textual_normalization_preserves_root_and_unresolved_components() {
        assert_eq!(normalize_project_path("/"), "/");
        assert_eq!(normalize_project_path("///"), "/");
        assert_eq!(normalize_project_path(""), "");
        assert_eq!(
            normalize_project_path("relative/../project///"),
            "relative/../project"
        );
    }

    #[test]
    fn real_path_reports_missing_paths_and_preserves_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(real_path(&dir.path().join("missing")), None);
        let file = dir.path().join("file");
        std::fs::write(&file, "x").unwrap();
        assert_eq!(real_path(&file), Some(file.canonicalize().unwrap()));
    }

    #[test]
    fn missing_projects_use_trimmed_text_without_resolving_parent_components() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing").join("..").join("project");
        let written = format!("{}///", missing.display());
        assert_eq!(canonical_project_path(&written), missing.to_str().unwrap());
        assert!(same_folder(&missing, &missing));
        assert!(!same_folder(&missing, &dir.path().join("project")));
    }

    #[test]
    fn existing_projects_resolve_parent_components() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let spelled = project.join("..").join("project");
        let real = project.canonicalize().unwrap();
        assert_eq!(
            canonical_project_path(spelled.to_str().unwrap()),
            real.to_str().unwrap()
        );
        assert!(same_folder(&spelled, &real));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_match_their_real_project() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        let alias = dir.path().join("alias");
        std::fs::create_dir(&project).unwrap();
        std::os::unix::fs::symlink(&project, &alias).unwrap();
        assert!(same_folder(&alias, &project));
        assert_eq!(
            canonical_project_path(alias.to_str().unwrap()),
            project.canonicalize().unwrap().to_str().unwrap()
        );
    }
}
