# Git Multi-Repo

The Git Multi-Repo module manages version control operations, repository discovery, staging, and history across one or multiple Git repositories in an AuricIDE workspace.

---

## 1. Purpose

Workspaces frequently contain multiple Git worktrees, nested repositories, or submodules. The Git Multi-Repo module ensures:

- Automatic recursive repository discovery from the workspace root.
- Clear identity isolation: every Git operation is addressed by exact `repoPath`, not ambiguous root paths.
- Independent status, staging, committing, and branching for each repository.
- Configurable ignored repository paths to exclude auxiliary checkouts.

---

## 2. Boundaries

- **File System Watching**: Does not listen to raw OS file modification events; it receives change triggers from [Tauri Backend Core](./tauri-backend-core.md).
- **Editor Gutter Rendering**: Does not compute line-by-line diff markers in CodeMirror; it provides raw diffs consumed by the editor extension.

---

## 3. Public Contracts

### Rust IPC Commands (`src-tauri/src/git.rs`)

- `git_discover_repos(root_path: String) -> Result<Vec<DiscoveredRepo>, String>`: Walks the directory tree (depth ≤ 4) to identify Git roots (regular repos, nested checkouts, submodules).
- `git_status(repo_path: String) -> Result<RepoStatus, String>`: Returns file statuses (staged, unstaged, untracked, conflicts) and branch metadata for `repo_path`.
- `git_diff(repo_path: String, file_path: String, staged: bool) -> Result<String, String>`: Produces unified diff output.
- `git_stage(repo_path: String, paths: Vec<String>) -> Result<(), String>`: Stages files into the index.
- `git_unstage(repo_path: String, paths: Vec<String>) -> Result<(), String>`: Removes files from the staging index.
- `git_commit(repo_path: String, message: String, amend: bool) -> Result<String, String>`: Creates a commit in `repo_path`.
- `git_blame(repo_path: String, file_path: String) -> Result<Vec<BlameHunk>, String>`: Computes blame hunks for a file.
- `git_history(repo_path: String, max_count: usize) -> Result<Vec<CommitSummary>, String>`: Retrieves recent commit history.

### Ignored Repositories Contract

Stored under the `ignored_repos` namespace with key `paths` in `<project>/.auric/project.db`:

- Twin implementations: `src/lib/config/ignoredRepos.ts` (frontend) and `src-tauri/src/ignored_repos.rs` (Rust), tested against `ignoredRepos.fixtures.json`.
- The workspace root cannot be ignored.
- Ignored paths are skipped during discovery, omitted from dirty probes, and masked in parent repo status.

---

## 4. Key Flows

### 4.1 Discovery & Path Resolution

1. **Workspace Scan**: On folder open, `git_discover_repos` scans up to depth 4. Pruned folders (e.g. `node_modules`, `dist`, `.auric`) are skipped.
2. **Path Matching (`repoForPath`)**: Given any file path, `repoForPath` selects the deepest enclosing discovered `repoPath`.
3. **State Initialization**: Each discovered repo initializes an independent entry in `gitSlice.repos` and `gitSlice.repoStates`.

### 4.2 Multi-Repo Changes View

1. **Single Repo**: If only the root is a repository, renders a standard single-pane Git Changes view.
2. **Multiple Repositories**: Renders collapsible per-repo sections, each with its own branch chip, staged list, unstaged list, and commit message box.
3. **Agentic Commit**: Commits run strictly with `cwd = repoPath` of the target section.

### 4.3 Git Shortcuts & Tab Integration

1. Global Git shortcuts (e.g. Commit, Diff, Blame) evaluate:
   - Active tab's repository (`repoForPath(activeTab.path)`).
   - If no active file, falls back to `activeRepoPath`.
   - If only one repository exists, targets that repository.
2. Diff tabs are keyed by compound id `diffTabId(source, filePath, repoPath)`.

### 4.4 Merge an agent worktree on close

All agent close/dismiss surfaces use `endAgentThenOfferMerge` and the shared
`offerWorktreeMerge` dialog. The default branch is resolved by the backend
(`main`, otherwise `master`); its name appears in every action and outcome.

- **Merge & push main** (or master): fetch origin first. A local default branch
  behind or diverged from origin stops before merging; the worktree stays.
  Otherwise commit uncommitted work first, merge locally, then push the explicit
  `refs/heads/<default>:refs/heads/<default>` refspec to origin, without force.
  The checked-out branch does not decide what is pushed. Server ref rejections
  and transport errors both count as failures; no force retry is made.
- **Merge locally**: commit leftover work, merge locally and remove the worktree.
  No network operation is performed, and the toast explicitly says “not pushed”.
- **Cancel** (including Escape): leave the worktree and branches untouched.

A failed push preserves the local merge, worktree and local agent branch. The
error names the push failure and states what was kept. A subsequent push choice
can push an already-contained branch without creating another merge commit.
After a successful push, delete an existing origin agent branch only if its
fetched commits are contained in the default branch. The deletion also checks the remote tip advertised during push negotiation,
so work added since the fetch is kept. Remote deletion errors do
not undo the successful push and are reported separately. Local cleanup errors
are returned with `cleanedUp: false` and a reason; the toast never claims the
worktree was removed in that case. `merged: false` without conflicts is reported
as “Already merged”, while conflicts open the existing merge panel.

IPC: `git_worktree_merge_into_default(repoPath, worktreePath, commitMessage, push)`.
Omitted `push` means local-only for compatibility. `WorktreeMergeResult` carries
`merged`, `pushed`, `pushError`, `cleanedUp`, `cleanupError`, `remoteBranchError`,
and `conflicts`, so a partial outcome is preserved through the store and UI.

Supervisor follow-up: `remove_worktree` still reports a missing folder as
“merged or removed”. Distinguishing human local/pushed merges requires retaining
an outcome after cleanup and passing it to the control socket; no outcome is
inferred from the folder's absence.

---

## 5. Dependencies

- **[Tauri Backend Core](./tauri-backend-core.md)**: SQLite project DB for ignored repo configuration and Tauri IPC registration.
- **[Configuration & Credentials](./configuration-credentials.md)**: Commit conventions and provider permissions.

---

## 6. Relevant Source Paths

- `src-tauri/src/git.rs` — Comprehensive Git implementation using `git2-rs` (libgit2).
- `src-tauri/src/ignored_repos.rs` — Rust backend ignored repository filtering.
- `src/lib/config/ignoredRepos.ts` — Frontend ignored repository configuration.
- `src/lib/store/gitSlice.ts` — Zustand store managing per-repo states, staging, and active repo.
- `src/app/components/git/` — Git Changes panel and history viewer components.
