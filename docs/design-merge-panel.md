# The merge panel

Status: design + contract, 2026-10-09. Owner of the reasoning: this file. Update it
after QA with whatever changed — the contract as written first is never the one
that ships.

## Where we started

AuricIDE could merge an agent's worktree back into `main`, and that was all.
`merge_commits_onto_branch` built the merge in memory and, the moment the index
had a conflict, returned the string `merge conflict — the worktree was left in
place so you can resolve it`. Resolve it _where_? There was no merge state, no
conflict view, no abort, and `git status` did not even label a conflicted file —
`status.rs` skipped the flag. A merge started in a terminal was invisible to the
IDE; a merge started by the IDE could not finish in it.

The diff viewer is further along: side-by-side and unified, word-level
highlighting, hunk navigation, double-click to edit a line in place, and review
comments that go to an agent as a checklist. What it lacks is the one operation
every serious diff tool is built around: **acting on a hunk**. You cannot stage
one hunk and leave the next, unstage a hunk you staged too eagerly, or throw away
a single hunk an agent got wrong. Today that is all-or-nothing per file.

Those are the two gaps this document closes: the merge panel, and hunk actions in
the diff viewer.

## The bar: what a CTO at Apple or JetBrains would look for

Imagine pitching this panel to the leadership of a company that ships Xcode or
IntelliJ. They have both seen a hundred merge tools. They will not be impressed by
three columns — every tool has three columns. What they probe:

| #   | Criterion            | What they actually ask                                                                                                                                                           | Weight |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----: |
| 1   | **Trust**            | Can this tool lose my work? Can it produce a merge that git would not? Can I always get out? Can the AI change a line I did not approve?                                         |   30 % |
| 2   | **Comprehension**    | Do I understand what _each side meant_, not just what each side typed? Is the common ancestor one keystroke away? Are sides named by branch, not by "ours/theirs"?               |   20 % |
| 3   | **Agentic leverage** | Does the machine take the boring 80 % off me and show its reasoning for the rest? Is there a credible path from "agent made this conflict" to "agent resolved it, I signed off"? |   20 % |
| 4   | **Flow**             | Can I do a 12-conflict merge without touching the mouse? Does progress read at a glance? Are trivial conflicts gone in one action? Are there dead ends?                          |   15 % |
| 5   | **Craft**            | Focus, keyboard, screen reader, reduced motion, density, copy. Does it feel like it belongs in the app?                                                                          |   10 % |
| 6   | **Integration**      | Does a merge started in a terminal show up? Do the Source Control panel, the worktree flow and the agent fleet all lead into the same panel? Multi-repo?                         |    5 % |

How the two houses would weigh it differently, and why the blend above:

- **JetBrains** leads with flow and correctness. Their merge dialog's reputation
  rests on the "magic wand" (resolve all non-conflicting changes), `F7` navigation
  and the guarantee that the result pane is the truth. A JetBrains CTO opens a
  12-file conflict and times you.
- **Apple** leads with comprehension and craft. FileMerge is old, but the question
  an Apple reviewer asks is "does a person who has never seen a conflict marker
  understand what to do?" — and "what does VoiceOver say?".
- **Both** would stop the demo at the first sign the AI writes into the file on its
  own. The pitch only works if the agent is an advisor with receipts, and the human
  is the one who signs.

So trust is weighted highest, and agentic leverage is weighted equal to
comprehension: it is the part neither house has, and therefore the part of the
pitch that lands — but only on top of the first two.

### What "impressive" means, concretely

These are the demo moments, each mapped to a criterion:

1. A terminal `git merge` conflicts. The IDE's Source Control panel already says
   _Merging `feature/x` into `main` · 3 files to resolve_ (Integration).
2. Open a file: every conflict is a card with **your side**, **incoming side** and,
   one key away, **the original** (Comprehension). Labels are branch names.
3. Press the wand: conflicts where only one side changed, or both made the same
   change, or the sides differ only in whitespace, resolve in one action and each
   one says _why_ it was safe (Flow, Trust).
4. On a real conflict press **Ask agent**: a proposal arrives with a one-sentence
   rationale and a confidence. It is shown, not applied. Accept or edit it
   (Agentic, Trust).
5. `⌥↓` to the next conflict, `⌥←`/`⌥→` to take a side, `⌘↵` to mark the file
   resolved. The counter ticks down (Flow).
6. **Resolve all with an agent**: one click opens the spawn dialog with a prompt
   that lists every conflicted file, the two branches and the rules (no markers
   left, stage each resolved file, do not commit). The human commits (Agentic).
7. **Abort** always works and gives back exactly the pre-merge state, including
   unrelated local edits (Trust).
8. In any working-tree diff: hover a hunk, **Stage hunk** / **Discard hunk**
   (`S` / `⌫` on the focused hunk). In a staged diff: **Unstage hunk**. The diff
   reloads in place and keeps the focused hunk (Flow, Trust).
9. An agent's worktree merge that conflicts no longer ends in a toast; it lands in
   this panel (Integration).

## The diff viewer is a review panel now

A diff viewer used to answer "what did _I_ change?". The person reading it wrote
the code an hour ago and knows the intent. In an IDE that runs a fleet of agents,
that is no longer the common case. Most diffs a person opens here were written by
someone else, by a model, often in a worktree they never looked at. The question
is now "**may this go in?**" That makes the diff viewer a code-review tool, and a
review tool is judged by different things:

| A diff viewer optimises for   | A review panel optimises for                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| One file, the one you clicked | The **change set**: all files of one agent run, branch or worktree                                                        |
| Showing lines                 | Showing **intent next to the lines**: what was asked, by whom, for which ticket                                           |
| Reading                       | **Deciding**: accept or reject per hunk, a verdict per change set                                                         |
| Being correct about the text  | Being correct about **what the reviewer has seen**: viewed marks that reset when the file changes                         |
| Alphabetical order            | **Risk order**: deleted tests, `.skip`, lint disables, type escapes and secrets first; lockfiles and generated files last |
| Comments as notes             | Comments as **work orders** that go back to the agent, survive a restart, and come back as a new round                    |

What follows from that, as concrete requirements:

1. **A review session is a tab over a change set**, not a file. Sources: the
   working tree of a repo, an agent worktree against its default branch, a branch
   against a ref. All files stacked in one scroll, a file list with progress
   ("4 of 9 viewed"), `]`/`[` to jump file, `V` to mark viewed.
2. **Viewed is bookkept by content.** The mark stores a hash of the file's patch;
   when the agent changes the file again, the mark drops and the file says
   "changed since you viewed it". A reviewer must never sign off on a version they
   did not see.
3. **Intent header.** When the change set belongs to an agent (worktree → agent →
   ticket/goal), the session shows the task the agent was given and its ticket,
   so the reviewer checks "did it do what was asked", not only "is this code ok".
4. **Deterministic risk flags first, model second.** A pure function flags hunks:
   removed or skipped tests, `eslint-disable` / `@ts-ignore` / `any` / `unwrap()`,
   strings shaped like credentials, large deletions, changes to CI or lockfiles.
   Each flag is a chip on the hunk and raises the file in the order. Cheap,
   explainable, testable; an LLM pass can come later on top, never instead.
5. **Accept/reject per hunk** is staging and discarding (section above). A
   rejected hunk can carry a comment, so the agent learns why.
6. **Comments persist per repo** (they were in memory only and died with the app)
   and carry the round they were sent in. "Request changes" sends the open
   comments to an agent as the checklist that already exists; sent comments are
   marked as sent rather than deleted. A line holds a **thread**: every comment
   has its own id (`reviewLineKey` groups them), a sent one is immutable, and a
   new comment on its line is added beside it rather than replacing it. Records
   from before threads keep their line key as their id. `C` opens the composer
   on the focused hunk's first changed line in the review and the diff.
7. **A verdict ends the session.** _Request changes_ (send comments) or _Approve_:
   for a working tree, stage what was accepted and focus the commit box; for an
   agent worktree, the existing merge into the default branch — which, on conflict,
   now lands in the merge panel.

This reweights the bar. Review is where a human now spends their git time, so it
takes weight from flow and comprehension:

| Criterion                                                  | Weight |
| ---------------------------------------------------------- | -----: |
| Trust                                                      |   25 % |
| **Review (change-set view, intent, risk order, verdicts)** |   20 % |
| Agentic leverage                                           |   20 % |
| Comprehension                                              |   15 % |
| Flow                                                       |   10 % |
| Craft                                                      |    7 % |
| Integration                                                |    3 % |

### Review contract (TypeScript only, no new Rust)

- `src/lib/git/review/riskFlags.ts` — `riskFlagsForHunk(filePath, hunkLines): RiskFlag[]`,
  `RiskFlag = { kind: 'test-removed' | 'test-skipped' | 'lint-disabled' | 'type-escape' | 'unwrap' | 'secret-like' | 'large-deletion' | 'ci-config' | 'lockfile' | 'generated'; label: string; line?: number }`;
  `fileRiskScore(flags): number` for ordering. Only added lines count for
  disables/escapes; removed lines count for test removal.
- `src/lib/git/review/reviewSession.ts` — `ReviewSource = { kind: 'worktree'; repoPath } | { kind: 'ref'; repoPath; ref }`,
  `orderReviewFiles(files)` (risk desc, then generated/lockfiles last, then path),
  `patchHash(patch)` (stable, cheap, e.g. FNV-1a over the hunk lines only so
  header noise does not reset marks), `viewedState(file, marks)` →
  `'unviewed' | 'viewed' | 'changed-since-viewed'`.
- `src/lib/store/reviewSlice.ts` — sessions per tab id `review:<repoPath>:<sourceKey>`,
  viewed marks per repo persisted (survive restart), plus persistence of the
  existing `reviewComments` and a `sentInRound?: number` on each comment.

## Rules the implementation must keep

- **The result is git's result.** The markered text comes from
  `git2::merge_file` on the three index stages, in diff3 style. We do not run our
  own three-way merge; we only parse git's output and let the human choose per
  region. A conflict region we cannot parse is shown raw and must be edited by
  hand — never guessed.
- **The agent proposes, the human disposes.** A proposal lives next to the
  conflict until accepted. It is rejected outright if it still contains a conflict
  marker line, is not valid JSON, or is empty while neither side is empty.
- **"Does it still parse?" advises, it never blocks.** A ready proposal says
  whether the file would still parse with it used ("Parses as JSON", "Brackets and
  strings balance", or "Would break: unbalanced `{` at line 42"), and Mark resolved
  checks the composed file once more: a problem costs one extra press ("Mark
  resolved anyway") with the reason under the button, and any change to the file
  asks again. A false "would break" on valid code teaches people to press through
  the warning, so whenever the check cannot read the file for certain it says
  nothing rather than guess.
- **Writing a resolution = write the file + stage it.** Nothing else. No commit.
  Concluding the merge is a separate, explicit action that refuses while any
  conflict remains.
- **Abort is `git reset --merge`, not `reset --hard`.** Paths the merge touched go
  back to `HEAD`; the rest of the working tree is left alone.
- **Starting a merge refuses on a dirty tree.** Same rule as the worktree merge
  already had.
- **Never write through a link.** Resolving refuses when the target or any parent
  inside the repo is a symlink; a conflict on a link itself is kind `symlink` and is
  resolved only by picking a side, which recreates the link from the blob.
- **One shell-out, and only where libgit2 has nothing.** libgit2 has no sequencer,
  so continuing a rebase, cherry-pick or revert runs the real `git`
  (`git/operation_step.rs`): resolved by absolute path through the login shell's
  PATH (`preflight::resolve_executable`), `GIT_EDITOR`/`GIT_SEQUENCE_EDITOR=true`,
  no stdin, cwd = repo, 5-minute timeout. Its output never becomes the message:
  a stop is classified into one sentence, the cleaned output goes to `details`.
- **One commit path per state.** While a merge, rebase, cherry-pick or revert is in
  progress, `git_commit` refuses; the only way to finish a merge is Commit merge,
  which writes both parents.
- **One vocabulary across merge, review and diff.** Merge: _Take yours_, _Take
  incoming_, _Both_, _Edit_, _Ask agent_, _Use proposal_, _Mark resolved_, _Commit
  merge_, _Abort merge_. Diff: _Stage hunk_, _Unstage hunk_, _Discard hunk_. Review:
  _Accept_ (stages, reversible, "Undo accept") and _Discard_ (irreversible, always
  confirmed), _Viewed_, _Request changes_, _Approve, then commit…_ / _Approve and
  merge_. A destructive verb never sounds soft ("Reject" was retired for that
  reason), and a button never claims a step it does not take.
- **The keyboard story never breaks.** After any action, focus lands on the next
  thing to decide (next open conflict, next hunk, next unviewed file), never on
  `body`. `?` opens the shortcut sheet in every surface.
- **Sides are named.** `oursLabel` / `theirsLabel` are branch names where git
  knows them (`HEAD`'s shorthand, the branch named in `MERGE_MSG`), short oids
  otherwise. The UI never says "ours"/"theirs" alone.

- **Hunk actions apply git's own patch.** The hunk is cut from the patch the
  viewer is showing (file header + that one hunk), reversed in TypeScript where
  needed, and applied by `git2::Repository::apply`. If the patch no longer
  applies (the file moved on), the action refuses and the diff reloads — never a
  fuzzy apply. Discarding asks first.

## Contract

### Rust (`src-tauri/src/git/merge.rs`, registered in `commands.rs` + `lib.rs`)

All structs `#[serde(rename_all = "camelCase")]`.

```rust
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
    /// Rebase only: from `.git/rebase-merge/{msgnum,end,message,head-name}`
    /// (`rebase-apply/{next,last}` for the am backend, without subject).
    pub step: Option<GitOperationStep>,
}

pub struct GitOperationStep {
    pub current: u32,             // 1-based
    pub total: u32,
    pub subject: Option<String>,  // first line of the commit being replayed
    pub branch: Option<String>,   // the branch being rebased, None when detached
}

pub struct GitOperationStepResult {
    /// "done" | "stopped" | "conflicts"
    pub outcome: String,
    pub operation: String,         // "rebase" | "cherry-pick" | "revert"
    pub conflicts: Vec<String>,    // only for "conflicts"
    pub message: Option<String>,   // one sentence; never git's output
    pub details: Option<String>,   // git's output, cleaned + tail-trimmed; "stopped" only
}

pub struct GitMergePreview {
    /// "up-to-date" | "fast-forward" | "clean" | "conflicts"
    pub outcome: String,
    pub conflicts: Vec<String>,    // sorted; only for "conflicts"
    pub commits: u32,              // commits on the branch HEAD does not have
}

pub struct GitConflictEntry {
    pub path: String, // repo-relative, '/'-separated
    /// "content" | "both-added" | "deleted-by-us" | "deleted-by-them" | "binary" | "symlink"
    pub kind: String,
}

pub struct GitConflictFile {
    pub path: String,
    pub kind: String,          // as above
    pub base: Option<String>,  // None when the stage is absent or binary
    pub ours: Option<String>,
    pub theirs: Option<String>,
    /// diff3-style text from git2::merge_file (markers `<<<<<<< `, `||||||| `,
    /// `=======`, `>>>>>>> ` followed by the label). None for binary and
    /// delete/modify conflicts — those resolve by picking a side.
    pub merged: Option<String>,
    pub ours_label: String,
    pub theirs_label: String,
}

/// Why each side looks like this: per side, the lines changed since the merge
/// base and the commit that last changed each one. Unchanged lines are absent.
pub struct GitConflictOrigins {
    pub ours: Vec<LineOrigin>,
    pub theirs: Vec<LineOrigin>,
    pub commits: Vec<OriginCommit>, // every commit named above, once each
}

pub struct LineOrigin {
    pub line: u32,   // 1-based, in that side's stage text
    pub oid: String,
}

/// Not `CommitInfo`: that name is the git-log shape with touched paths.
pub struct OriginCommit {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    pub author: String,
    pub time: i64, // unix seconds
}

pub struct GitMergeStartResult {
    /// "up-to-date" | "fast-forward" | "merged" | "conflicts"
    pub outcome: String,
    pub oid: Option<String>,        // new HEAD for fast-forward/merged
    pub conflicts: Vec<String>,     // paths, only for "conflicts"
}
```

`WorktreeMergeResult` gains `pub conflicts: Vec<String>` (always present, empty
unless the merge stopped on conflicts).

| Command (Tauri)             | Args (camelCase)                                    | Returns                  | Refuses when                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git_merge_state`           | `repoPath`                                          | `GitMergeState`          | never (not a repo → `inProgress:false, operation:"none"`)                                                                                                                                 |
| `git_conflict_file`         | `repoPath, filePath`                                | `GitConflictFile`        | path has no conflict                                                                                                                                                                      |
| `git_conflict_origins`      | `repoPath, filePath`                                | `GitConflictOrigins`     | no merge in progress; path escapes repo. A side without the file (deleted) has no origins                                                                                                 |
| `git_resolve_conflict`      | `repoPath, filePath, content: string \| null`       | `()`                     | path not conflicted; path escapes repo. `null` = resolve by deleting the file                                                                                                             |
| `git_resolve_conflict_side` | `repoPath, filePath, side: "ours" \| "theirs"`      | `()`                     | as above. Takes blob and mode from that index stage; an absent stage removes the file. The only way to resolve binary and delete/modify conflicts                                         |
| `git_merge_abort`           | `repoPath`                                          | `()`                     | no merge in progress                                                                                                                                                                      |
| `git_merge_conclude`        | `repoPath, message`                                 | `string` (oid)           | no merge in progress; any conflict left                                                                                                                                                   |
| `git_merge_branch`          | `repoPath, branch`                                  | `GitMergeStartResult`    | a merge already in progress; tracked changes in index or work tree; unknown branch                                                                                                        |
| `git_merge_preview`         | `repoPath, branch`                                  | `GitMergePreview`        | unknown branch; unborn HEAD. Built with `merge_commits` in memory: index, work tree and refs are untouched (tested byte for byte on the index)                                            |
| `git_operation_step`        | `repoPath, action: "continue" \| "skip" \| "abort"` | `GitOperationStepResult` | nothing in progress; a merge in progress (it keeps Commit merge / Abort merge); `continue` while a conflict is left; unknown action; git not found; timeout. Nothing runs when it refuses |

`git_conflict_origins` blames the path at `HEAD` (ours) and at `MERGE_HEAD`
(theirs) with the merge base as the oldest commit, so a line unchanged since the
base has no origin. Its line numbers are in the **stage** texts, not in git's
diff3 text: a change only one side made is merged into a clean run, so clean
runs can differ in length per side. `conflictOrigins.ts` therefore walks the
segments for an estimate and then finds each conflict's lines in the stage text
near it.

`git_merge_branch` behaves like `git merge <branch>`: up to date → nothing;
fast-forward when possible; clean merge → commit `Merge branch '<branch>' into
<head>` at once; otherwise leave the merge in progress with diff3 markers in the
working tree and `MERGE_HEAD`/`MERGE_MSG` written.

`git_operation_step` re-reads the repository after git exits, so the outcome is
git's state, not its exit code: nothing in progress → `done`; conflicts in the
index → `conflicts` (the next commit stopped); still in progress without
conflicts → `stopped` with a sentence for the cause (empty commit, unstaged
changes, an untracked file in the way, a hook, no identity, an `edit` stop).
A rebase that resolves to an empty commit is dropped by git itself
(`drop_redundant_commits`) and reads as `done`; an empty cherry-pick stops.

A conflict doc belongs to one **stop**, not to a path. `GitMergeState` carries
`headOid` and `applyingOid` (`REBASE_HEAD` / `CHERRY_PICK_HEAD` / `REVERT_HEAD`),
and `operationKey(state)` (`mergeSlice.ts`) joins operation, `theirsOid`, both oids
and the step number. A doc stores the key it was loaded under; `refreshMergeState`
(polled every 4 s while something is in progress, and on focus) ends every doc
whose key no longer matches, and `resolveFile` refuses on a mismatch. That covers
a rebase continued in a terminal (HEAD moves) and a terminal `--skip` (HEAD stays,
the applied commit moves) — during a rebase `theirsOid` is `null` for every commit,
so it alone could not tell the stops apart. `stepOperation` additionally ends the
repo's docs right after a step from the banner, without waiting for the poll.
Real-app e2e: a terminal `rebase --continue` that stops on the same path turns the
open tab into "This conflict is closed".

`git_worktree_merge_into_default`: on conflict **and** HEAD on the default branch,
start the same in-progress merge in the main work tree and return
`merged:false, cleanedUp:false, conflicts:[…]` (the worktree stays until the merge
is concluded). On conflict while HEAD is elsewhere keep the error, but say:
`merge conflict — check out <default> and merge <branch> to resolve it in the merge panel`.

| `git_apply_patch` | `repoPath, patch, target: "index" \| "workdir", guard: { filePath, side: "staged" \| "unstaged", diff } \| null` | `()` | `guard` given and `git_diff(filePath, side)` no longer equals `guard.diff` (`<file> changed since this diff was shown; it was reloaded`), checked before applying; patch does not apply cleanly (error names the file) |

The guard exists because a stage applies against the **index**: when only the
work tree moved on, the hunk still applies there and would stage something the
viewer no longer shows. Comparing the whole shown diff catches that, and every
other drift, before anything is written.

`git_diff_ref_files` / `git_diff_file_ref` (ref → work tree) include untracked
files, recursing into untracked folders and showing their content. An agent
worktree review must list the new files, because the merge commits them.

Hunk actions map to `git_apply_patch` like this:

| Viewer source | Action       | Patch         | Target    |
| ------------- | ------------ | ------------- | --------- |
| `unstaged`    | Stage hunk   | hunk as shown | `index`   |
| `unstaged`    | Discard hunk | hunk reversed | `workdir` |
| `staged`      | Unstage hunk | hunk reversed | `index`   |

No hunk actions on `combined`, `revision`, `ref`, on new/deleted/binary files, or on
mode-only changes. Whole-file staging covers those.

`git_status`: a conflicted entry gets `status: "conflicted"`, `staged: null`,
`unstaged: "conflicted"`.

### TypeScript

- `src/lib/tauri/gitMerge.ts` — one wrapper per command, types mirroring the above.
- `src/lib/store/git/gitTypes.ts` — `GitStatusLabel` and `GitUnstagedKind` gain `'conflicted'`.
- `src/lib/git/merge/conflictModel.ts` — pure:
  - `parseMergedText(text): MergeSegment[]` where
    `MergeSegment = { kind: 'clean'; lines: string[] } | { kind: 'conflict'; index: number; ours: string[]; base: string[] | null; theirs: string[] }`,
    plus `{ kind: 'unparsed'; text: string }` when markers are unbalanced (whole file).
    Line endings preserved: `lines` are split on `\n`; a trailing newline state is
    carried on the result (`endsWithNewline`).
  - `Resolution = { kind: 'ours' } | { kind: 'theirs' } | { kind: 'base' } | { kind: 'both'; first: 'ours' | 'theirs' } | { kind: 'custom'; lines: string[]; source: 'manual' | 'agent' | 'auto' }`
  - `resolutionLines(conflict, resolution): string[]`
  - `autoResolution(conflict): { resolution: Resolution; reason: string } | null` —
    only side changed vs. base → that side; both identical → ours; differ only in
    whitespace → ours. Base absent (both-added) → only the identical case.
  - `composeResult(doc, resolutions): string | null` — null while any conflict is unresolved.
  - `hasConflictMarkers(text): boolean` — a line starting with `<<<<<<< ` or
    `>>>>>>> ` always counts; `=======` and `||||||| ` count only when one of
    those is present too. A lone `=======` is a Markdown setext heading, not a
    conflict.
- `src/lib/git/merge/agentProposal.ts` — pure prompt builder + strict parser
  (`buildProposalPrompt`, `parseProposal(raw) → { ok: true; lines; rationale; confidence: 'high'|'medium'|'low' } | { ok: false; reason }`)
  and `proposeResolution({ conflict, context, askLlm })`.
- `src/lib/git/merge/resolveAllPrompt.ts` — the whole-merge agent prompt.
- `src/lib/git/merge/syntaxCheck.ts` — pure: `checkSyntax(filePath, text)` →
  `{ kind: 'ok' | 'problem' | 'unchecked'; checker; message?; line? }`. JSON via
  `JSON.parse` (falling back to comment and trailing-comma rules when the file has
  comments or is a `tsconfig`/`.jsonc`/`.vscode` file; the error line is found by
  reading the text again, because WebKit's message has no position), YAML via
  `js-yaml` (custom tags are unchecked), XML via `DOMParser` where one exists.
  Code (ts/js/jsx/tsx, rs, py, go, java, kt, swift, c/cpp/h, css/scss) goes through
  a tokenizer that knows each family's strings, comments, template literals,
  regex literals, JSX, Rust raw strings and lifetimes, Python triple quotes and the
  C preprocessor, and reports the first unbalanced bracket or unclosed string.
  It is never a compile: no types, no names. Two guards keep it from crying wolf:
  a construct with two readings (`x) /re/`) is tried both ways and a disagreement
  is `unchecked`; and `checkResolvedFile` / `checkProposalSyntax` stay silent
  when the file's own versions (the stages, or the file with either side taken)
  fail the same check. TOML, Markdown and unknown types are `unchecked`.
- `src/lib/git/merge/conflictOrigins.ts` — pure: `conflictSideRanges(segments, { ours, theirs })`
  (each conflict's 1-based range in each stage text), `conflictOrigins(segments, sides, origins)`
  → `Record<index, { ours: OriginCommit[]; theirs: OriginCommit[] }>` (deduplicated, newest
  first, empty = unchanged since the base), `intentFor(origin)` (commit subjects for the
  proposal prompt) and `commitAge(timeSeconds, nowMs)` ("3 days ago").
  `mergeSlice.openConflict` loads them in the background onto `MergeDocState.origins`; a
  failure leaves them absent and never blocks resolving. `buildProposalPrompt` takes the
  optional `intent` and adds one line per side that has commits; without it the prompt
  is unchanged. The side header shows the newest commit (`SideOrigin.tsx`), the tooltip
  up to three.
- `src/lib/git/hunkPatch.ts` — pure: `hunkPatchFor(rawPatch, hunkIndex): string | null`
  (file header lines + one `@@` hunk; null for new/deleted/binary/no such hunk),
  `reversePatch(patch): string` (swap `-`/`+` lines and the `@@ -a,b +c,d @@` ranges,
  swap `---`/`+++` paths, keep `\ No newline` markers attached to the right line, and within each run of
  changed lines put every `-` line before every `+` line, because libgit2 refuses a
  `-` that follows a `+` across a marker),
  `hunkActionsFor(source, rawPatch): ('stage'|'unstage'|'discard')[]`.
- `src/lib/tauri/git.ts` — `applyGitPatch(repoPath, patch, target)`.
- `src/lib/store/mergeSlice.ts` — merge state per repo, open conflict documents per
  tab, resolutions, proposals; actions call the wrappers. `stepOperation(repoPath, action)`.
- `mergeCopy.ts` — `previewSummary` ("3 commits · merges cleanly", "Conflicts in 2
  files: a.ts, b.yml"), `stepLine` ("Replaying commit 2 of 5: <subject>"), `stepCopy`
  (button labels and what Skip / Abort give back). `operationCopy().continueLabel`
  replaces the old `finishCommand`.

### UI

- Tab id `merge:<repoPath>:<filePath>` (`mergeTabId`, `isMergeTabId` beside `diffTabId`).
- `src/app/components/git/merge/` — `MergeView` (the tab), `ConflictCard`,
  `MergeBanner` (Source Control, per repo), `MergeToolbar`.
- `MergeBanner` for a rebase, cherry-pick or revert: the progress line, **Continue
  rebase** (disabled with "Resolve N files first"), **Skip this commit** (confirm)
  and **Abort rebase** (confirm that says what comes back: for a rebase the branch
  returns to where it started, every replayed commit and resolution dropped). A
  `stopped` outcome shows its sentence with git's output in a "What git said" fold;
  `conflicts` opens the next file. The merge view's done state points at that
  button, not at a terminal.
- `MergeBranchMenu`: each branch previews on focus or hover (150 ms debounce,
  computed once per menu opening; the branch list is re-read on every open, so a
  moved tip is picked up then — there is no tip oid in `GitBranch` to key on). A
  branch the preview says conflicts asks first, naming the files.
- Diff viewer: a hunk toolbar on each `@@` header (hover and focused hunk) with
  the actions from `hunkActionsFor`. `S` stages/unstages the focused hunk, `⌫`
  discards it after a confirm.
- Keyboard in `MergeView`: `⌥↓`/`⌥↑` next/previous unresolved conflict, `⌥←` take
  yours, `⌥→` take incoming, `⌥B` both, `⌥O` show original, `⌥A` ask agent,
  `⌘↵` mark file resolved.

## How it is verified

- **Real app, real git:** `pnpm test:e2e:tauri:merge` (`--skip-build` to reuse the
  debug bundle) drives the built Tauri app over WebDriver against a temp repo made
  with the `git` CLI: a merge started in a terminal shows up, conflicts are taken by
  click and by `⌥→`, one is edited, Commit merge writes two parents; a second merge
  is aborted with an unrelated local edit surviving; one hunk of two is staged; the
  Merge… menu names the conflicting file before merging (index and HEAD untouched,
  Cancel merges nothing); a rebase stopped in a terminal is resolved in the panel and
  finished with **Continue rebase** — linear history, replayed onto `main`, file
  content byte-exact.
- **Real git CLI in Rust tests:** `git/tests/operation_step_tests.rs` — a two-commit
  rebase continued commit by commit, skip, abort back to the pre-rebase HEAD,
  cherry-pick continue, an empty cherry-pick that stops with a sentence, every
  refusal (and that a refusal ran nothing), the stop classifier, and the preview
  for all four outcomes with the index compared byte for byte.
  Every outcome is asserted on disk with `git`, byte for byte.
- **Browser mode, deterministic IPC:** `e2e/merge-review-demo.spec.ts` records every
  IPC call and proves that an agent proposal reaches disk only through Use proposal
  plus Mark resolved, that the wand explains itself, and the review demo (risk
  chip, `V`, Approve waiting with a reason, `?`). Two JSON cases cover the syntax
  check: a good proposal says "Parses as JSON"; one that drops a comma says "Would
  break: not valid JSON at line 3", is still usable, and Mark resolved writes
  nothing until it is pressed a second time.
- **The syntax check against real code, not only fixtures:** run over every
  tracked source and config file in this repo (1,756 files) it reports no problem
  and leaves none unchecked; deleting the last `}` of each of the 1,701 code files
  is caught in 1,681 of 1,683 cases (the other two `}` sat inside a string and a
  pattern, so the file stayed valid). Over about 33,000 more files on the
  development machine (Cargo registry, Python site-packages, Homebrew's Go, C,
  C++ and Swift sources, 4,000 JS/TS files from `node_modules`) it reported 47
  problems, all of them in files that really do not balance on their own: Go's
  own error-check tests (19) and four zlib-style C fragments meant to be
  `#include`d (28, seven copies each). C files with `#if` branches are left
  unchecked rather than judged.
- **Real model, real CLI:** `pnpm probe:merge-agent` builds a repo with the git
  CLI that stops in a merge with two conflicted files (`src/pricing.ts`, two
  regions; `config/limits.json`, one), then (a) asks for each region with the real
  `buildProposalPrompt` (commit subjects as intent) through `claude -p`, reads the
  answer with the real `parseProposal`, composes and runs `checkSyntax`; (b) hands
  the real `buildResolveAllPrompt` to `claude -p` inside the repo, with
  `--restricted`, file tools and only `git add`/`rm`/`show`/`status`/`diff`/
  `ls-files`/`log`, and then asks git. Run on 2026-10-09 with Claude Code 2.1.296
  and `--model haiku` (resolved to `claude-haiku-5-5`): **18/18 assertions passed**.
  (a) 3/3 answers parsed, no marker, both files compose and check ok (JSON,
  brackets); the model kept both new plans and combined "two months free" with
  "round to whole units" as `Math.round(plan.monthly * 10)`; $0.0016. (b) 10
  turns, 18 s, $0.0041: `git ls-files -u` empty, no marker, both files staged and
  nothing unstaged, `MERGE_HEAD` still there, `HEAD` unchanged, and the summary
  named one judgment call (5 seats over 4). The run surfaced no prompt or parser
  weakness to fix. It is one scenario and one small model; it shows the path works
  end to end, not that every merge will.
- **Known harness quirks** (tauri-plugin-wdio-webdriver 1.4.0, worked around in the
  spec): arrow keys arrive without modifiers, so `⌥→` is dispatched as a
  KeyboardEvent; element click re-focuses the clicked element, so the spec focuses
  then clicks like a pointer does.

## Scorecard against the bar (2026-10-09)

Scored the way the leadership review at the top would score it: evidence first,
then what they would press on. 10 means nothing left a reviewer could fairly ask
for at this scope.

| Criterion        | Weight | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | What they would still press on                                                                                   |
| ---------------- | -----: | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Trust            |   25 % |   9.5 | Abort is `reset --merge` and refuses edited resolutions; no commit path can leave `MERGE_HEAD`; never writes through a link; hunk actions refuse a stale diff; proposals reach disk only via Use proposal + Mark resolved (IPC-recorded e2e); 66/66 hunk cases byte-identical to `git add -p`; each proposal and the final file are run through a parse/bracket check that asks for a second press on a problem (0 false problems on 1,756 repo files, 1,681/1,681 real breaks caught) | Still not a compile: types, names and imports are not checked; TOML and Markdown are not checked at all          |
| Review           |   20 % |   8.5 | Change-set tab, risk order and chips (7/7 true hits on 96 real diffs), viewed marks by content, merge-base for agent branches, untracked files shown, Approve re-reads and refuses while an agent runs, comment threads sent in rounds                                                                                                                                                                                                                                                 | No model pre-review on top of the deterministic flags (deliberately later)                                       |
| Agentic leverage |   20 % |   8.5 | Per-conflict proposals with rationale, confidence and the commits behind each side; whole-merge agent prompt; worktree conflicts land in the panel; review comments go back as a checklist; both agent paths run end to end against a real model through the `claude` CLI (`pnpm probe:merge-agent`, 18/18, under one cent)                                                                                                                                                            | One scenario and one small model so far; proposals are not validated by running the project's own tests or build |
| Comprehension    |   15 % |   8.5 | Sides named by branch and role (rebase-aware), original one key away, the commit that changed each side shown on the card, intent header in review                                                                                                                                                                                                                                                                                                                                     | No inline history of a conflicting line beyond the newest commits                                                |
| Flow             |   10 % |     9 | Keyboard for every action, focus never lands on `body` (tested), wand with reasons, summary per file, `?` sheet in all three surfaces; the Merge… menu previews each branch in memory ("conflicts in 1 file: export.yml", real-app e2e) and the confirm names the files                                                                                                                                                                                                                | The preview ignores uncommitted edits (the merge itself refuses them)                                            |
| Craft            |    7 % |     8 | Audited for contrast, targets, names, reduced motion and narrow widths; real-app screenshots                                                                                                                                                                                                                                                                                                                                                                                           | Not yet reviewed with VoiceOver by a person                                                                      |
| Integration      |    3 % |   9.5 | Terminal merges appear and end (focus + poll), multi-repo, worktree flow, Source Control commit routing; rebase, cherry-pick and revert continue, skip and abort in the banner via the real git, with a progress line (real-app e2e: terminal rebase finished by button)                                                                                                                                                                                                               | Interactive rebase plans (reorder, squash) still need a terminal                                                 |

Weighted: **8.8 / 10** (Flow 8.5 → 9, Integration 8 → 9.5, Trust 9 → 9.5, Agentic
leverage 7.5 → 8.5).

**Would it land in a leadership pitch?** Yes, on three things neither house ships
today: a review surface built for code someone else (or something else) wrote, an
agent that resolves conflicts with receipts and never touches disk on its own, and
trust guarantees proven against real git rather than asserted. The questions to
prepare for are the right-hand column. The two that would cost the most points if
asked live: "does a proposed resolution compile?" (now partly answered: it says
whether the file still parses, and says plainly that it does not check types) and,
now answered, "can I finish a rebase here?".
