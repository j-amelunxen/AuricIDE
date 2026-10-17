use git2::Repository;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CarryOverMode {
    Copy,
    Symlink,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeIncludeEntry {
    pub pattern: String,
    pub mode: CarryOverMode,
}

pub fn default_worktree_include_entries() -> Vec<WorktreeIncludeEntry> {
    vec![
        WorktreeIncludeEntry {
            pattern: ".env".to_string(),
            mode: CarryOverMode::Copy,
        },
        WorktreeIncludeEntry {
            pattern: ".env.local".to_string(),
            mode: CarryOverMode::Copy,
        },
        WorktreeIncludeEntry {
            pattern: ".env.*".to_string(),
            mode: CarryOverMode::Copy,
        },
        WorktreeIncludeEntry {
            pattern: ".codegraph".to_string(),
            mode: CarryOverMode::Copy,
        },
        WorktreeIncludeEntry {
            pattern: "node_modules".to_string(),
            mode: CarryOverMode::Symlink,
        },
    ]
}

/// Resolves the include rules for a repository:
/// 1. `.auric/worktree-include`
/// 2. `.worktreeinclude` (Claude Code compatibility)
/// 3. Built-in defaults
pub fn resolve_worktree_include_rules(source_repo: &Path) -> Vec<WorktreeIncludeEntry> {
    let auric_file = source_repo.join(".auric").join("worktree-include");
    if auric_file.is_file() {
        if let Ok(content) = fs::read_to_string(&auric_file) {
            return parse_worktree_include_content(&content);
        }
    }

    let claude_file = source_repo.join(".worktreeinclude");
    if claude_file.is_file() {
        if let Ok(content) = fs::read_to_string(&claude_file) {
            return parse_worktree_include_content(&content);
        }
    }

    default_worktree_include_entries()
}

pub fn parse_worktree_include_content(content: &str) -> Vec<WorktreeIncludeEntry> {
    let mut entries = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let (mode, raw_pattern) = if let Some(tail) = line.strip_prefix("symlink:") {
            (CarryOverMode::Symlink, tail.trim())
        } else if let Some(tail) = line.strip_prefix("copy:") {
            (CarryOverMode::Copy, tail.trim())
        } else {
            (CarryOverMode::Copy, line)
        };

        let pattern = raw_pattern.trim_end_matches('/').to_string();
        if !pattern.is_empty() {
            entries.push(WorktreeIncludeEntry { pattern, mode });
        }
    }
    entries
}

pub fn wildcard_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0, 0);
    let (mut star_pi, mut match_ti) = (None, 0);

    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star_pi = Some(pi);
            pi += 1;
            match_ti = ti;
        } else if let Some(sp) = star_pi {
            pi = sp + 1;
            match_ti += 1;
            ti = match_ti;
        } else {
            return false;
        }
    }

    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }

    pi == p.len()
}

fn find_matching_relative_paths(source_repo: &Path, pattern: &str) -> Vec<String> {
    if !pattern.contains('*') && !pattern.contains('?') {
        let full = source_repo.join(pattern);
        if full.exists() || full.is_symlink() {
            return vec![pattern.to_string()];
        }
        return Vec::new();
    }

    let (parent_dir, file_pattern) = match pattern.rsplit_once('/') {
        Some((prefix, pat)) => (source_repo.join(prefix), pat),
        None => (source_repo.to_path_buf(), pattern),
    };

    let mut matches = Vec::new();
    if let Ok(dir_entries) = fs::read_dir(&parent_dir) {
        for entry in dir_entries.flatten() {
            let file_name = entry.file_name();
            let name_str = file_name.to_string_lossy();
            if wildcard_match(file_pattern, &name_str) {
                if let Ok(rel) = entry.path().strip_prefix(source_repo) {
                    matches.push(rel.to_string_lossy().into_owned());
                }
            }
        }
    }
    matches.sort();
    matches
}

fn is_git_ignored_and_untracked(repo: &Repository, source_path: &Path, rel_path: &str) -> bool {
    let path = Path::new(rel_path);
    if let Ok(index) = repo.index() {
        if index.get_path(path, 0).is_some() {
            return false;
        }
    }

    let ignored = repo.is_path_ignored(path).unwrap_or(false)
        || (source_path.is_dir()
            && repo
                .is_path_ignored(Path::new(&format!("{rel_path}/")))
                .unwrap_or(false));
    ignored
}

fn copy_entry_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        if name_str.ends_with(".pid") || name_str.ends_with(".sock") {
            continue;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::FileTypeExt;
            if file_type.is_socket() || file_type.is_fifo() {
                continue;
            }
        }

        let target = dst.join(&file_name);
        if file_type.is_dir() {
            copy_entry_recursive(&path, &target)?;
        } else if file_type.is_file() || file_type.is_symlink() {
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

fn symlink_entry(source_path: &Path, dest_path: &Path) -> std::io::Result<()> {
    if dest_path.exists() || dest_path.is_symlink() {
        return Ok(());
    }
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source_path, dest_path)
    }
    #[cfg(windows)]
    {
        if source_path.is_dir() {
            std::os::windows::fs::symlink_dir(source_path, dest_path)
        } else {
            std::os::windows::fs::symlink_file(source_path, dest_path)
        }
    }
}

/// Carries over ignored files and directories from `source_repo` into `dest_worktree`.
/// Returns the list of carried over items with their modes, e.g. `[".env (copied)"]`.
pub fn apply_worktree_carry_over(
    repo: &Repository,
    source_repo: &Path,
    dest_worktree: &Path,
) -> Vec<String> {
    let rules = resolve_worktree_include_rules(source_repo);
    let mut carried_over = Vec::new();

    for rule in rules {
        let matching_paths = find_matching_relative_paths(source_repo, &rule.pattern);
        for rel_path in matching_paths {
            let source_path = source_repo.join(&rel_path);
            if !source_path.exists() && !source_path.is_symlink() {
                continue;
            }

            if !is_git_ignored_and_untracked(repo, &source_path, &rel_path) {
                continue;
            }

            let dest_path = dest_worktree.join(&rel_path);
            let success = match rule.mode {
                CarryOverMode::Copy => {
                    if source_path.is_dir() {
                        copy_entry_recursive(&source_path, &dest_path).is_ok()
                    } else {
                        if let Some(parent) = dest_path.parent() {
                            let _ = fs::create_dir_all(parent);
                        }
                        fs::copy(&source_path, &dest_path).is_ok()
                    }
                }
                CarryOverMode::Symlink => symlink_entry(&source_path, &dest_path).is_ok(),
            };

            if success {
                let mode_label = match rule.mode {
                    CarryOverMode::Copy => "copied",
                    CarryOverMode::Symlink => "symlinked",
                };
                let label = format!("{rel_path} ({mode_label})");
                if !carried_over.contains(&label) {
                    carried_over.push(label);
                }
            }
        }
    }

    carried_over
}
