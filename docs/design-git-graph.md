# The git graph browser

A full-width editor tab that shows every branch of a repository as a commit
graph: where lines fork, where they merge, which refs point where. It is also
the place for light git operations: checkout, branches, tags, cherry-pick and
revert. It sits beside the per-file History in Source Control and does not
replace it.

The bar is a native macOS developer tool (Xcode's Source Control navigator,
Tower, Fork): earned familiarity, invisible chrome, full keyboard use, and
operations that say exactly what they will do before they do it.

## Where we started

`HistoryView` lists the commits that touched one file. `git_log_since` walks
only HEAD, sorts by time, diffs every commit to fill `touched`, and returns no
parents and no refs. `git_list_branches` returns names without targets. Nothing
lists tags or the files of a whole commit. None of that can draw a graph, and
`git_log_since` has other callers (evidence engine, station evidence, fork
proposals), so the graph gets its own commands instead of changing it.

## Rules the implementation must keep

1. **Nothing leaves the machine.** No push, no fetch, no remote delete. Tags
   and branches are local. A remote branch can be checked out (as a new
   tracking local branch) but never changed.
2. **Never force, never lose work.** Checkout refuses when it would overwrite
   uncommitted changes; it never discards them. Deleting an unmerged branch is
   refused with `not_merged` until the user confirmed and the UI sends
   `force: true`. The current branch can never be deleted.
3. **One operation at a time, and never into a running one.** Every write
   command refuses while the repository is in a merge, rebase, cherry-pick or
   revert (`operation_in_progress`). Cherry-pick and revert also refuse with a
   dirty index or work tree (`dirty_worktree`).
4. **Conflicts go to the merge panel.** Cherry-pick and revert run through the
   real `git` CLI, so the sequencer state is exactly the one
   `git_operation_step` (continue, skip, abort) already understands. A
   conflicting result opens the merge panel; the graph never resolves anything.
5. **Refusals are sentences, not git output.** Every refusal is an error string
   of the form `<code>: <one plain sentence>` (codes below). The UI shows the
   sentence. Raw git stderr never reaches a label (same rule as
   `toolFailure.ts`); it goes to the log.
6. **Layout is the frontend's.** Rust returns commits in topological order with
   their parents and never assigns lanes. One layout, in TypeScript, tested
   against `src/lib/git/gitGraph.fixtures.json`.
7. **The graph reflects the repository, not a cache.** After every write
   operation the tab reloads refs and the first page, and refreshes the
   Source Control status and branch list. It also reloads when the window
   regains focus and the HEAD or refs changed (cheap: compare `git_refs`).

### Vocabulary (user-facing copy)

| Word        | Means                                                          | Never say           |
| ----------- | -------------------------------------------------------------- | ------------------- |
| Check Out   | Switch the working copy to a branch or commit                  | "Switch", "Go to"   |
| New Branch… | Create a branch at the selected commit                         | "Fork"              |
| Delete      | Remove a local branch or tag. Irreversible, styled destructive | "Remove", "Discard" |
| Cherry-Pick | Apply this commit's change on top of the current branch        | "Copy", "Apply"     |
| Revert      | Create a new commit that undoes this commit                    | "Undo", "Rollback"  |
| Detached    | HEAD on a commit, not on a branch                              | "Headless"          |

Menu items that open a sheet or popover end in an ellipsis ("New Branch…").
No em dashes in user copy.

## Contract

### Error codes (prefix of every `Err(String)` from a write command)

`invalid_name`, `already_exists`, `not_found`, `not_merged`, `current_branch`,
`would_overwrite`, `operation_in_progress`, `dirty_worktree`, `remote_ref`,
`already_applied`, `git_failed`. The UI maps a code to a title and shows the sentence after the
colon as the body. Unknown codes fall back to "Git refused the operation."

### Rust (`src-tauri/src/git/graph.rs`, `src-tauri/src/git/refs_ops.rs`)

All structs `#[serde(rename_all = "camelCase")]`. Commands are
`#[tauri::command(async)]` thin wrappers over `*_impl` functions, registered in
`git/commands.rs` and `lib.rs`. Tauri args arrive in camelCase.

```rust
pub struct GraphCommit {
    pub oid: String,            // full 40-hex
    pub parents: Vec<String>,   // in parent order; empty for a root
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    pub author_time: i64,       // unix seconds
    pub committer_time: i64,    // unix seconds
}
pub struct GraphPage { pub commits: Vec<GraphCommit>, pub has_more: bool }

pub struct GitRef {
    pub name: String,           // full: refs/heads/main, refs/remotes/origin/main, refs/tags/v1, HEAD
    pub shorthand: String,      // main, origin/main, v1, HEAD
    pub kind: String,           // "local" | "remote" | "tag" | "head"
    pub target: String,         // commit oid (annotated tags peeled to their commit)
    pub upstream: Option<String>,   // shorthand of the upstream, local branches only
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub is_current: bool,       // the branch HEAD points at
}
pub struct GitRefs {
    pub refs: Vec<GitRef>,      // order: head, current local, other local, remote, tag; each by name
    pub head_detached: bool,
    pub head_oid: Option<String>,   // None when unborn
    pub operation: String,      // merge::operation_name(): none|merge|rebase|cherry-pick|revert|other
}

pub struct CommitDetail {
    pub oid: String,
    pub parents: Vec<String>,
    pub message: String,        // full message, trailing whitespace trimmed
    pub author_name: String, pub author_email: String, pub author_time: i64,
    pub committer_name: String, pub committer_email: String, pub committer_time: i64,
    pub files: Vec<GitNameStatus>,  // against parents[parent_index], or the empty tree for a root
}

pub struct PickResult { pub clean: bool, pub conflicts: Vec<String>, pub new_oid: Option<String> }
```

| Command             | Args (camelCase)                                 | Returns        |
| ------------------- | ------------------------------------------------ | -------------- |
| `git_graph_log`     | `repoPath, skip: usize, limit: usize`            | `GraphPage`    |
| `git_refs`          | `repoPath`                                       | `GitRefs`      |
| `git_commit_detail` | `repoPath, oid, parentIndex?: usize` (default 0) | `CommitDetail` |
| `git_diff_commit`   | existing + `parentIndex?: usize` (default 0)     | `String`       |
| `git_checkout`      | `repoPath, target` (full ref name or oid)        | `()`           |
| `git_branch_create` | `repoPath, name, atOid, checkout: bool`          | `()`           |
| `git_branch_rename` | `repoPath, oldName, newName` (short local names) | `()`           |
| `git_branch_delete` | `repoPath, name, force: bool`                    | `()`           |
| `git_tag_create`    | `repoPath, name, oid, message?: String`          | `()`           |
| `git_tag_delete`    | `repoPath, name`                                 | `()`           |
| `git_cherry_pick`   | `repoPath, oid`                                  | `PickResult`   |
| `git_revert`        | `repoPath, oid`                                  | `PickResult`   |

Details that matter:

- **`git_graph_log`** pushes HEAD (if born), every `refs/heads/*`,
  `refs/remotes/*` (except `*/HEAD`) and every tag peeled to a commit (tags on
  non-commits are skipped). Sort `TOPOLOGICAL | TIME`. `limit` is clamped to
  `1..=500`. `has_more` is true when a commit exists after the page. Paging is
  `skip`-based over the same deterministic walk; the frontend asks again from
  0 after any change. An unborn repository returns an empty page, not an error.
- **`git_checkout`** with a local branch ref sets HEAD to it after a safe
  checkout (`CheckoutBuilder::safe()`, conflicts → `would_overwrite`). With a
  remote ref `refs/remotes/<r>/<b>` it creates local `<b>` tracking it and
  checks that out; if local `<b>` exists, `already_exists`. With a tag or an oid
  it detaches HEAD. Untracked files that would be overwritten count as
  `would_overwrite` too.
- **`git_branch_delete`** without `force` follows `git branch -d`: with an
  upstream the tip must be reachable from the upstream, without one from HEAD;
  otherwise `not_merged`.
- **Directory/file clashes** (`feature` vs `feature/x`) are refused with
  `already_exists` before anything is written, for create, rename and the
  local branch a remote checkout creates. libgit2's rename deletes the old
  loose ref before it fails on such a clash, so the check must come first.
- **`git_branch_rename`** keeps the upstream config (git2 `Branch::rename`
  does), and works on the current branch too.
- **Names** are validated with `git2::Branch::name_is_valid` /
  `Reference::is_valid_name("refs/tags/<name>")` → `invalid_name`.
- **`git_cherry_pick` / `git_revert`** run `git cherry-pick <oid>` /
  `git revert --no-edit <oid>` with the environment handling of
  `operation_step.rs` (no editor, `GIT_*` stripped). A merge commit gets
  `-m 1`. Exit 0 → `clean: true` and `new_oid` = new HEAD. A conflict (repo
  state is now cherry-pick/revert) → `clean: false` with the conflicted paths;
  that is not an error. A pick that leaves nothing to commit (already applied)
  is aborted again, so no operation stays open, and answered
  `already_applied`. Any other failure → `git_failed`, with the sentence
  derived from the stderr, never the stderr itself.

### TypeScript

- `src/lib/tauri/gitGraph.ts`: wrappers for every command above, through
  `./invoke`. Types mirror Rust; `kind` is the union
  `'local' | 'remote' | 'tag' | 'head'`. `parseGitError(e): { code, message }`
  splits the code prefix (unknown → `code: 'unknown'`).
- `src/lib/git/graphLayout.ts`: pure lane layout (below).
- `src/lib/git/graphTabId.ts`: `graphTabId(repoPath) = 'git-graph:' + repoPath`,
  `isGraphTabId`, `repoPathFromGraphTabId`; `isVirtualTabId` includes it.
- `src/lib/store/gitGraphSlice.ts`: state per `repoPath`
  (`graphs: Record<string, GraphRepoState>`), pages, layout rows, refs,
  selection, detail cache, filter text, branch filter, `busy` (the running
  operation's label or null) and actions for every operation.

### Lane layout

Input: commits in the order Rust sends them, plus the `GitRefs`. Output per
commit row:

```ts
interface GraphRow {
  oid: string;
  lane: number; // column of the commit dot
  color: number; // palette index of the commit's lane
  // Segments that pass through or touch this row, each from the row's top
  // half to its bottom half. A segment with fromLane !== toLane is a curve.
  edges: Array<{ fromLane: number; toLane: number; color: number; part: 'top' | 'bottom' }>;
  isMerge: boolean; // parents.length > 1
  width: number; // number of lanes in use at this row
}
```

Algorithm (the familiar "active lanes" walk, as in `git log --graph`):

- Keep `active: (oid | null)[]` — the commit each lane is waiting for, and the
  lane's colour.
- For each commit: its lane is the first lane waiting for it, else the first
  free lane, else a new lane. Every other lane waiting for the same commit
  merges into it (a curve in the top half) and becomes free.
- The commit's first parent continues in its lane. Each further parent takes
  the lane already waiting for it if there is one, else the first free lane
  (a curve in the bottom half), else a new lane.
- A root frees its lane. Trailing free lanes are dropped, so the graph narrows
  again.
- **Lane 0 belongs to HEAD's first-parent line.** The walk seeds lane 0 with
  HEAD's oid before the first commit, so the current branch is the straight
  line on the left whatever the dates say.
- Colours: a lane gets a new palette index when a new line starts in it, and
  keeps it while the line runs. Colour 0 belongs to HEAD's first-parent line
  only; an unrelated history that later reuses lane 0 gets its own colour.
- **Incremental:** `layoutGraph(commits, headOid, carry?)` returns
  `{ rows, carry }`; feeding the next page with that `carry` produces exactly
  the rows one call over both pages would. The fixtures assert this by
  splitting every DAG at every index.

Filtering by text never re-lays the graph: matching rows are highlighted and
⌘G / ⇧⌘G step between them. A branch filter ("Current branch", one ref)
does not reload either: it dims rows not reachable from the chosen tip
(reachability computed in TS over the loaded pages), so the lanes never jump
under the reader's eye.

## UI (`src/app/components/git/graph/`)

- **Toolbar**: repo picker (only with more than one repo), search field (⌘F;
  summary, author, sha prefix, ref name), branch filter menu, "Jump to HEAD",
  inspector toggle. Uses existing toolbar tokens; no new chrome colour.
- **Graph list**: fixed 28 px rows, hand-rolled windowing (render the visible
  range plus 10 rows overscan), next page requested 40 rows before the end.
  Per row: lanes as an inline SVG (2 px strokes, 8 px dots, merge dots hollow,
  HEAD dot ringed in the accent), ref pills (capsules: local filled with the
  lane colour at low alpha, remote outlined, tag with a tag glyph, current
  branch bold with a check), summary, author, relative date (`tabular-nums`,
  absolute date on hover title). Selection is the system-style accent row.
- **Inspector** (right, resizable 280–560 px, collapsible, remembers its width
  via app prefs): sha (copy button), refs, full message, author and committer
  (committer only when different), parents as buttons that select them, and
  the changed files (status letter + path). A file click opens the existing
  revision diff tab (`diffTabId({kind:'revision', oid, summary}, path,
repoPath)` through the same path `handleHistoryCommitClick` uses). For a
  merge commit a segmented control picks the parent to compare with.
- **Keyboard**: ↑/↓ select, ⇞/⇟ page, Home/End, ← first parent, → first child,
  Return toggles the inspector, ⌘C copies the selected sha, ⌘F search, Esc
  clears search then selection. The list is one `role="listbox"` with
  `aria-activedescendant`; rows are `role="option"` with an accessible label
  that reads summary, author, date and refs.
- **Context menu** (rows and ref pills; the existing portaled `ContextMenu`),
  also offered as a "…" button in the inspector so nothing is hover- or
  right-click-only:
  - on a commit: Check Out (detached)…, New Branch…, New Tag…, Cherry-Pick…,
    Revert…, Copy SHA, Copy Summary.
  - on a local branch: Check Out, Rename…, Delete…; on a remote branch: Check
    Out as Local Branch; on a tag: Delete Tag…, Copy Name.
  - Items that cannot run are disabled with the reason as their title
    (current branch: "You are on this branch"; operation running: "Finish the
    cherry-pick first").
- **Sheets** (`useDialogA11y`): one confirmation sheet for detached checkout,
  cherry-pick, revert, delete branch and delete tag. Title names the action,
  body says exactly what will happen with the real names ("Revert “Fix
  login” on main. This creates one new commit on main."). Default button is
  Cancel for destructive ones; the destructive button is styled destructive.
  `not_merged` turns the delete sheet into a second confirm that names the
  commits that would become unreachable count.
- **Popover** for New Branch / New Tag / Rename: one text field with live
  validation (same rules as Rust, checked again by Rust), "Check out after
  creating" checkbox for branches, optional message for tags.
- **Feedback**: while an operation runs, the affected row shows a spinner and
  the menu is disabled. Success: a toast ("Checked out main") and, after a
  checkout, the new HEAD row scrolls into view and pulses once. Refusal: a
  toast with the mapped title and the sentence. Conflict: a toast "Cherry-pick
  stopped on 2 conflicts" with an action that opens the merge panel; the
  graph shows the operation banner.
- **Banners and empty states**: not a repository, no commits yet, detached
  HEAD (informational, with "Check Out a Branch…"), operation in progress
  ("A cherry-pick is in progress." + "Open Merge Panel").
- **Motion**: selection and inspector open use a short spring (no layout
  props, no `transition-all`); nothing animates under
  `prefers-reduced-motion`. Colours: theme tokens for chrome; lane palette is
  fixed hex in `src/lib/git/graphColors.ts` (same reason as
  `agents/colors.ts`: "the blue line" must stay blue under any accent).
- **Entry points**: "Show Graph" button in the Source Control History header,
  command palette "Git: Show Graph", shortcut ⌥⌘G (active tab's repo, then
  `activeRepoPath`, then the only repo).

## What QA and the HIG audit changed (2026-10-21)

The contract above is the one that ships; these are the rules that were added
because a first build broke them.

- **A branch must never be lost on rename.** libgit2's `Branch::rename` onto a
  directory/file clash (`work` → `feature` while `feature/x` exists) deleted
  the old loose ref and then failed. The clash check runs before any write.
- **An empty pick is aborted, not left open.** Otherwise the repository stays
  in a cherry-pick with nothing to resolve and every later write is refused.
- **`GIT_*` never leaks into the real git.** `run_git` drops every inherited
  `GIT_*` variable, and `real_git()` drops the repo-location ones from the
  login-shell environment.
- **A page never duplicates a commit.** `loadMore` compares refs first and
  starts over from page one when they moved; appending also dedupes by oid.
- **HEAD's reserved lane becomes real** as soon as a merge drawn above HEAD
  sends a parent into it. The fixtures assert edges, and a seeded fuzz over
  2000 random DAGs checks edge continuity.
- **Focus returns to the opener.** A menu item that opens a sheet passes the
  row or "…" button as `useDialogA11y`'s `returnFocusTo`; the menu itself has
  arrow-key navigation and restores focus on close.
- **Menus in the graph are compact** (`ContextMenu compact`, 28 px rows,
  section headers in the ref's own case) and a disabled item shows its reason
  under the label, not only in a tooltip.
- **Dimming never dims text below 70 %.** Search and branch filter fade lanes
  and pills; summary, author and date stay readable.
