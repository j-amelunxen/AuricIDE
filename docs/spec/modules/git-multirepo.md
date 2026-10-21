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
- `git_log_since(repo_path, since_iso?, path_prefix?, limit, max_scan) -> Result<Vec<CommitInfo>, String>`: Walks HEAD newest first, with the paths each commit touched. Used by per-file History and the evidence engine.

Git graph browser (contract: `docs/design-git-graph.md`; code: `git/graph.rs`, `git/refs_ops.rs`). Write commands refuse with `<code>: <sentence>` and never run during a merge, rebase, cherry-pick or revert.

- `git_graph_log(repo_path, skip, limit) -> GraphPage`: All branches, remotes and tags as one topologically sorted walk, paged (`limit` clamped to 1..=500).
- `git_refs(repo_path) -> GitRefs`: Branches, remotes, tags and HEAD with ahead/behind, plus the running operation.
- `git_commit_detail(repo_path, oid, parent_index?) -> CommitDetail`: Full message and changed files against one parent.
- `git_diff_commit(repo_path, oid, file_path, parent_index?) -> String`: Patch of one file in a commit, against the chosen parent.
- `git_checkout(repo_path, target)`: Local branch, remote branch (new tracking branch) or commit/tag (detached); refuses with `would_overwrite` instead of discarding work.
- `git_branch_create(repo_path, name, at_oid, checkout)`, `git_branch_rename(repo_path, old_name, new_name)`, `git_branch_delete(repo_path, name, force)`, `git_tag_create(repo_path, name, oid, message?)`, `git_tag_delete(repo_path, name)`: Local refs only; nothing is pushed.
- `git_cherry_pick(repo_path, oid)`, `git_revert(repo_path, oid) -> PickResult`: Run the real `git`; a conflict is a result (`clean: false`) that `git_operation_step` can continue, skip or abort.

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

### 4.5 Agent Worktree Carry Over (Included Files)

When an agent worktree is created (`git_worktree_add_impl`), git-ignored local configuration, environment variables, code graph index databases, and dependencies are carried over from the main checkout so that agents operating inside isolated worktrees have the necessary environment:

1. **Configuration Precedence**:
   - `<project>/.auric/worktree-include`
   - `<project>/.worktreeinclude` (standard Claude Code compatibility)
   - Built-in defaults if neither file exists:
     - `.env` (`copy`)
     - `.env.local` (`copy`)
     - `.env.*` (`copy`)
     - `.codegraph` (`copy`, copying index databases and skipping `.sock` and `*.pid` runtime files)
     - `node_modules` (`symlink`)

2. **File Syntax & Modes**:
   - Gitignore-style patterns (supports `#` comments, wildcards `*`, and `?`).
   - `copy: <pattern>`: recursively copies files or directories. Edits in the worktree remain isolated and never modify the main checkout.
   - `symlink: <pattern>`: creates a filesystem symlink to the main checkout. Used for heavy dependencies where copying is too slow.
   - Plain `<pattern>` lines default to `copy` for compatibility with `.worktreeinclude`.

3. **Invariants & Logging**:
   - Only untracked, git-ignored entries are carried over (`repo.is_path_ignored`). Tracked files already present in HEAD are skipped.
   - Missing entries are skipped silently.
   - Carried-over entries are returned in `GitWorktree.carriedOver` and reported in the agent's startup log:
     `[worktree] Carried over from main checkout: <entry> (<mode>), ...`

---

## 5. Dependencies

- **[Tauri Backend Core](./tauri-backend-core.md)**: SQLite project DB for ignored repo configuration and Tauri IPC registration.
- **[Configuration & Credentials](./configuration-credentials.md)**: Commit conventions and provider permissions.

---

## 6. Relevant Source Paths

- `src-tauri/src/git/` — Git implementations using `git2-rs` (libgit2).
- `src-tauri/src/git/worktree_include.rs` — Worktree include pattern parsing and carry-over logic.
- `src-tauri/src/git/worktrees.rs` — Worktree creation, listing, removal, and merge operations.
- `src-tauri/src/ignored_repos.rs` — Rust backend ignored repository filtering.
- `src/lib/config/ignoredRepos.ts` — Frontend ignored repository configuration.
- `src/lib/store/gitSlice.ts` — Zustand store managing per-repo states, staging, and active repo.
- `src/lib/store/agent/agentLifecycle.ts` — Spawning agents with worktrees and recording carry-over output.
- `src/app/components/git/` — Git Changes panel and history viewer components.
