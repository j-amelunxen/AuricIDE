//! Which instructions a job's agent follows (`docs/design-supervisor-link.md`,
//! "Global defaults").
//!
//! A kind names a project-relative file, a global one, or both. The project's
//! file wins when the project has it; the agent then reads it in its own
//! worktree, as before. A global file is read by the IDE alone and its text
//! goes into the prompt: no `documents.*` method can reach it, and no error a
//! client sees names its path.

use super::documents::read_contained;
use super::policy::{is_relative_file, JobKind};
use std::path::{Path, PathBuf};

/// Fixture `globalInstructions.maxBytes`.
pub const MAX_INSTRUCTIONS_BYTES: u64 = 65_536;

/// The instructions a job's agent gets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Instructions {
    /// A project-relative file the agent reads in its worktree.
    ProjectFile(String),
    /// The text of a global file, put into the prompt.
    GlobalText(String),
}

/// Why a kind has no usable instructions, worded for a client: a global
/// file's path is never part of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unusable(pub String);

/// The file a `globalInstructions` value names, and the folder it must stay
/// in when it is a bare name under `job-kinds/`.
fn global_location(
    global: &str,
    job_kinds_dir: Option<&Path>,
) -> Option<(PathBuf, Option<PathBuf>)> {
    if Path::new(global).is_absolute() {
        return Some((PathBuf::from(global), None));
    }
    if !is_relative_file(global) {
        return None;
    }
    let dir = job_kinds_dir?;
    Some((dir.join(global), Some(dir.to_path_buf())))
}

/// The text of a global instructions file: a regular UTF-8 file of at most
/// `MAX_INSTRUCTIONS_BYTES`. A name under `job-kinds/` must also resolve
/// there, so a symlink cannot carry it out of the folder.
pub fn read_global(global: &str, job_kinds_dir: Option<&Path>) -> Option<String> {
    let (path, within) = global_location(global, job_kinds_dir)?;
    let real = path.canonicalize().ok()?;
    if let Some(dir) = within {
        let dir = dir.canonicalize().ok()?;
        if !real.starts_with(&dir) {
            return None;
        }
    }
    let metadata = std::fs::metadata(&real).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_INSTRUCTIONS_BYTES {
        return None;
    }
    String::from_utf8(std::fs::read(&real).ok()?).ok()
}

/// The instructions of `kind` in the project at `root`: the project's own
/// file when it has one, else the global file.
pub fn resolve(
    kind: &JobKind,
    root: &Path,
    project: &str,
    job_kinds_dir: Option<&Path>,
) -> Result<Instructions, Unusable> {
    if let Some(relative) = kind.instructions.as_deref() {
        let found = is_relative_file(relative)
            && read_contained(root, relative)
                .map_err(|error| Unusable(error.message))?
                .is_some();
        if found {
            return Ok(Instructions::ProjectFile(relative.to_string()));
        }
    }
    if let Some(global) = kind.global_instructions.as_deref() {
        return read_global(global, job_kinds_dir)
            .map(Instructions::GlobalText)
            .ok_or_else(|| {
                Unusable(format!(
                    "the global instructions of job kind \"{}\" are missing or unreadable \
                     (Settings → Supervisor → Supervisor link)",
                    kind.kind
                ))
            });
    }
    Err(Unusable(format!(
        "the instructions of job kind \"{}\" ({}) are not a file in {project}",
        kind.kind,
        kind.instructions.as_deref().unwrap_or("none")
    )))
}

#[cfg(test)]
#[path = "instructions_tests.rs"]
mod tests;
