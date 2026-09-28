//! AuricIDE's write sandbox for agent CLIs: the agent may write inside its
//! workspace and nowhere else on the machine.
//!
//! Some CLIs ship no sandbox, and some ship one that is no use for unattended
//! work: the Antigravity CLI's `--sandbox` (1.2.x, macOS) denies every shell
//! write, the workspace included, so an agent can edit files but not install,
//! build, test or commit. Without it the same CLI writes anywhere. A provider
//! config that sets `writeSandbox` gets neither extreme: the process tree is
//! started under a Seatbelt profile (`sandbox-exec`, the mechanism the Claude,
//! Codex and Gemini CLIs use on macOS) that allows writes only where the work
//! lives.
//!
//! Writable: the agent's cwd, the project it is bound to, the shared `.git`
//! of a worktree, the temp dirs, the usual package-manager caches, the paths
//! the provider config names for the CLI's own state, and the inbox database
//! the bound MCP server writes. Reads and network stay open — the point is
//! that an agent cannot change the rest of the machine, not that it cannot see
//! it. Everything the agent starts (shells, MCP servers) inherits the profile.
//!
//! macOS only. Elsewhere the spawn is refused rather than run unconfined: a
//! config that asked for confinement must not quietly get none.

use std::path::{Path, PathBuf};

use crate::providers::{shell_word, SpawnCommand};

const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

/// Package-manager and tool caches under `$HOME`: writing there is part of
/// installing and building, and nothing in them is the user's own work.
const HOME_CACHES: &[&str] = &[
    ".cache",
    "Library/Caches",
    ".npm",
    "Library/pnpm",
    ".local/share/pnpm",
    ".cargo/registry",
    ".cargo/git",
    ".bun/install/cache",
    ".gradle/caches",
    ".m2/repository",
];

const TEMP_DIRS: &[&str] = &["/private/tmp", "/private/var/folders"];

/// Where one confined agent may write.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct WritablePaths {
    /// Whole directory trees.
    pub dirs: Vec<PathBuf>,
    /// Single files (a SQLite database and its journal files).
    pub files: Vec<PathBuf>,
}

pub struct SandboxInputs<'a> {
    pub cwd: Option<&'a Path>,
    pub project_root: Option<&'a Path>,
    pub home: &'a Path,
    /// From the provider config; `~/` is expanded against `home`.
    pub provider_writable: &'a [String],
    pub notifications_db: Option<&'a Path>,
}

/// Resolves every writable location to the path Seatbelt compares against.
/// Seatbelt matches the real path, so `/var/...` has to be written as
/// `/private/var/...`, and a symlinked project as its target.
pub fn writable_paths(inputs: &SandboxInputs<'_>) -> Result<WritablePaths, String> {
    let workspace: Vec<PathBuf> = [inputs.cwd, inputs.project_root]
        .into_iter()
        .flatten()
        .filter_map(|path| std::fs::canonicalize(path).ok())
        .collect();
    if workspace.is_empty() {
        return Err(
            "This provider runs in AuricIDE's write sandbox, which needs an existing working \
             directory; none was given"
                .to_string(),
        );
    }

    let mut dirs = workspace.clone();
    for root in &workspace {
        if let Some(common) = worktree_common_git_dir(root) {
            dirs.push(common);
        }
    }
    dirs.extend(TEMP_DIRS.iter().map(PathBuf::from));
    if let Some(tmp) = std::env::var_os("TMPDIR").and_then(|t| std::fs::canonicalize(t).ok()) {
        dirs.push(tmp);
    }
    let home = real_or_lexical(inputs.home);
    dirs.extend(HOME_CACHES.iter().map(|rel| home.join(rel)));
    dirs.extend(
        inputs
            .provider_writable
            .iter()
            .map(|entry| real_or_lexical(&expand_home(entry, &home))),
    );
    dedup(&mut dirs);

    let files = inputs
        .notifications_db
        .map(|db| {
            let db = real_or_lexical(db);
            ["", "-wal", "-shm", "-journal"]
                .iter()
                .map(|suffix| PathBuf::from(format!("{}{suffix}", db.display())))
                .collect()
        })
        .unwrap_or_default();

    Ok(WritablePaths { dirs, files })
}

/// The Seatbelt profile: everything allowed except writing, then writing
/// allowed back for exactly the given paths and the terminal devices a PTY
/// program needs. Later rules win in SBPL, so the order is the policy.
pub fn profile(paths: &WritablePaths) -> String {
    let mut out =
        String::from("(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write*\n");
    for dir in &paths.dirs {
        out.push_str(&format!("  (subpath \"{}\")\n", sbpl_string(dir)));
    }
    for file in &paths.files {
        out.push_str(&format!("  (literal \"{}\")\n", sbpl_string(file)));
    }
    out.push_str(
        "  (literal \"/dev/null\") (literal \"/dev/zero\") (literal \"/dev/ptmx\")\n  \
         (literal \"/dev/dtracehelper\") (regex #\"^/dev/tty\") (regex #\"^/dev/fd/\"))\n",
    );
    out
}

/// Starts `cmd` under the profile. The whole command line, arguments and
/// task included, runs as sandbox-exec's program, so nothing the agent starts
/// escapes it.
pub fn confine(mut cmd: SpawnCommand, profile: &str) -> SpawnCommand {
    let prefix = format!("{SANDBOX_EXEC} -p {} ", shell_word(profile));
    cmd.command = format!("{prefix}{}", cmd.command);
    cmd.executable = format!("{prefix}{}", cmd.executable);
    cmd
}

/// Refuses where there is no Seatbelt, instead of running unconfined.
pub fn ensure_supported() -> Result<(), String> {
    if cfg!(target_os = "macos") && Path::new(SANDBOX_EXEC).exists() {
        Ok(())
    } else {
        Err(
            "This provider runs in AuricIDE's write sandbox, which is only available on macOS"
                .to_string(),
        )
    }
}

/// A worktree's `.git` is a file pointing at `<main>/.git/worktrees/<name>`;
/// commits write objects and refs into the shared `<main>/.git`.
fn worktree_common_git_dir(root: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(root.join(".git")).ok()?;
    let gitdir = text.strip_prefix("gitdir:")?.trim();
    let gitdir = root.join(gitdir);
    let common = match std::fs::read_to_string(gitdir.join("commondir")) {
        Ok(rel) => gitdir.join(rel.trim()),
        Err(_) => gitdir,
    };
    std::fs::canonicalize(common).ok()
}

fn expand_home(entry: &str, home: &Path) -> PathBuf {
    match entry.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        None if entry == "~" => home.to_path_buf(),
        None => PathBuf::from(entry),
    }
}

/// The real path when it exists; the lexical one for a cache that has not
/// been created yet, so the first install may still create it.
fn real_or_lexical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn dedup(paths: &mut Vec<PathBuf>) {
    let mut seen = std::collections::HashSet::new();
    paths.retain(|p| seen.insert(p.clone()));
}

fn sbpl_string(path: &Path) -> String {
    path.display()
        .to_string()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

#[cfg(test)]
#[path = "write_sandbox_tests.rs"]
mod tests;
