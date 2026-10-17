use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub staged: Option<String>,
    pub unstaged: Option<String>,
    /// The executable bit differs on either side (HEAD→index or index→worktree).
    /// Says nothing about the content: libgit2 does not always hash the
    /// worktree file here, so "only the mode" cannot be claimed from a status.
    /// Sent only when true — a status can hold thousands of rows.
    #[serde(rename = "modeChanged", skip_serializing_if = "std::ops::Not::not")]
    pub mode_changed: bool,
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

/// What `git_worktree_remove_unless_work_impl` did: removed, or kept because
/// it holds uncommitted changes (`dirty`) or unmerged commits (`branch_ahead`).
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemoval {
    pub path: String,
    pub branch: Option<String>,
    pub source_repo: String,
    pub removed: bool,
    pub dirty: bool,
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
    /// Paths left conflicted when the merge stopped in the main work tree.
    /// Empty unless `merged` is false because of a conflict.
    pub conflicts: Vec<String>,
}

/// What the repository is in the middle of, and what is still conflicted.
/// Contract: `docs/design-merge-panel.md`.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeState {
    pub in_progress: bool,
    /// "merge" | "rebase" | "cherry-pick" | "revert" | "none" | "other"
    pub operation: String,
    /// HEAD's branch shorthand, or a short oid when detached. None when unborn.
    pub ours_label: Option<String>,
    /// Branch named in MERGE_MSG ("Merge branch 'x'"), else short MERGE_HEAD oid.
    pub theirs_label: Option<String>,
    pub theirs_oid: Option<String>,
    /// Content of .git/MERGE_MSG, trimmed of comment lines. None when absent.
    pub message: Option<String>,
    /// Sorted by path. Empty when nothing is conflicted.
    pub conflicts: Vec<GitConflictEntry>,
    /// Which commit a rebase is replaying. None outside a rebase, or when git
    /// left no progress files to read.
    pub step: Option<GitOperationStep>,
    /// HEAD's full oid. None when unborn.
    pub head_oid: Option<String>,
    /// The commit a rebase, cherry-pick or revert is applying right now
    /// (`REBASE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`). With `head_oid` it
    /// tells one stop apart from the next, which `theirs_oid` cannot outside a
    /// merge.
    pub applying_oid: Option<String>,
}

/// "Replaying commit 2 of 5: <subject>", read from `.git/rebase-merge`.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationStep {
    /// 1-based.
    pub current: u32,
    pub total: u32,
    /// First line of the commit being replayed. None for the am backend.
    pub subject: Option<String>,
    /// The branch being rebased (`head-name`), None when it was detached.
    pub branch: Option<String>,
}

/// What `git rebase|cherry-pick|revert --continue|--skip|--abort` left behind.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationStepResult {
    /// "done" | "stopped" | "conflicts"
    pub outcome: String,
    /// The operation the step ran on: "rebase" | "cherry-pick" | "revert".
    pub operation: String,
    /// Paths, only for "conflicts".
    pub conflicts: Vec<String>,
    /// One plain sentence for "conflicts" and "stopped". Never git's output.
    pub message: Option<String>,
    /// git's own output, cleaned and tail-trimmed, for a fold. Only for "stopped".
    pub details: Option<String>,
}

/// What `git merge <branch>` would do, computed in memory.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitMergePreview {
    /// "up-to-date" | "fast-forward" | "clean" | "conflicts"
    pub outcome: String,
    /// Paths that would conflict, sorted. Only for "conflicts".
    pub conflicts: Vec<String>,
    /// Commits on the branch that HEAD does not have.
    pub commits: u32,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictEntry {
    /// Repo-relative, '/'-separated.
    pub path: String,
    /// "content" | "both-added" | "deleted-by-us" | "deleted-by-them" | "binary"
    pub kind: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictFile {
    pub path: String,
    pub kind: String,
    /// None when the stage is absent or binary.
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    /// diff3-style text as libgit2 merges it. None for binary and
    /// delete/modify conflicts — those resolve by picking a side.
    pub merged: Option<String>,
    pub ours_label: String,
    pub theirs_label: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeStartResult {
    /// "up-to-date" | "fast-forward" | "merged" | "conflicts"
    pub outcome: String,
    /// New HEAD for fast-forward/merged.
    pub oid: Option<String>,
    /// Paths, only for "conflicts".
    pub conflicts: Vec<String>,
}

/// One line of a conflicted file's side that changed since the merge base.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LineOrigin {
    /// 1-based, in that side's own text (its index stage).
    pub line: u32,
    /// The commit that last changed the line on that side.
    pub oid: String,
}

/// A commit named by a `LineOrigin`. Not `CommitInfo`: that one is the
/// git-log shape with touched paths.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OriginCommit {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    pub author: String,
    /// Unix seconds.
    pub time: i64,
}

/// Why each side of a conflict looks the way it does: per side, the lines
/// changed since the merge base and the commit that changed them. Lines
/// unchanged since the base are left out.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictOrigins {
    pub ours: Vec<LineOrigin>,
    pub theirs: Vec<LineOrigin>,
    /// Every commit named above, once each.
    pub commits: Vec<OriginCommit>,
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

/// What the viewer showed when a hunk action was taken. `git_apply_patch`
/// recomputes the diff for `side` and refuses when it no longer matches.
#[derive(Debug, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPatchGuard {
    pub file_path: String,
    /// "staged" | "unstaged"
    pub side: String,
    pub diff: String,
}
