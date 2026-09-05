use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub staged: Option<String>,
    pub unstaged: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub ahead: u32,
    pub behind: u32,
}

/// One commit as the evidence engine reads history: what it touched is the
/// payload — "a commit touches this path prefix" is a station predicate.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub oid: String,
    pub summary: String,
    pub author: String,
    /// UTC, `YYYY-MM-DD HH:MM:SS` — the app's one timestamp format.
    pub timestamp: String,
    /// Repo-relative paths this commit changed (diff against first parent).
    pub touched: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub kind: String,
    pub is_current: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitNameStatus {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlameHunk {
    pub oid: String,
    pub author: String,
    pub timestamp: String,
    pub summary: String,
    pub start_line: u32,
    pub line_count: u32,
}

/// Whether a project folder (or a git repo inside it) has uncommitted work.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDirty {
    pub path: String,
    pub dirty: bool,
}

/// A git work-tree root found under a project's root path.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoRef {
    /// Absolute work-tree path.
    pub path: String,
    /// Relative to the project root, "" when the root itself is the repo. `/`-separated.
    pub relative_path: String,
    /// Basename of the work tree (the project folder's name for the root repo).
    pub name: String,
    /// "root" | "nested" | "submodule"
    pub kind: String,
}

/// One linked worktree belonging to a repository. Auric-managed ones live in a
/// sibling `*.auric-wt` folder on a branch named `auric/…`.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub source_repo: String,
    pub is_auric: bool,
    pub dirty: bool,
    /// True when the worktree branch has commits the source HEAD does not.
    pub branch_ahead: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeMergeResult {
    pub default_branch: String,
    pub merged: bool,
    pub fast_forward: bool,
    pub cleaned_up: bool,
    pub oid: Option<String>,
}

pub const AURIC_WORKTREE_DIR_SUFFIX: &str = ".auric-wt";
pub const AURIC_WORKTREE_BRANCH_PREFIX: &str = "auric/";
pub const DEFAULT_BRANCH_CANDIDATES: [&str; 2] = ["main", "master"];

/// How far below the project root discovery looks for a `.git`. Bounded so
/// opening a huge unrelated folder as a project never turns into a full-disk
/// walk.
pub const GIT_DISCOVERY_MAX_DEPTH: usize = 4;

/// Commits actually walked before we give up, whether or not they matched.
/// The `limit` bounds the answer; this bounds the *work*.
pub const GIT_LOG_MAX_SCAN: usize = 2000;
