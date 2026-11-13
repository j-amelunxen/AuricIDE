# Multi-repository Git

[Developer guide index](README.md) · [Documentation index](../README.md)

Repository identity, discovery, ignored repos and graph operations. See also the [module specification](../spec/modules/git-multirepo.md) and [graph design](../design-git-graph.md).

## Git across several repositories

The opened folder is not assumed to be a repository. `git_discover_repos`
walks it (depth ≤ 4, same prune list as the explorer, root never pruned) and
reports every work-tree root at or below it — the root itself, nested
checkouts, submodules (`kind` decided by the nearest enclosing discovered
repo). From there **the repository is resolved per path, never from
`rootPath`**. What to keep in mind when touching anything git-shaped:

- **`repoPath` is the identity.** `gitSlice` holds `repos` + `repoStates`
  keyed by it; every store action, panel callback and diff-tab id
  (`diffTabId(source, filePath, repoPath)`) carries it. `repoForPath` (deepest
  match) is the one way from a file to its repo; explorer badges, gutter,
  blame and history all go through it. A nested repo's own folder gets no
  badge from the outer repo.
- **A repo has a state the moment it is discovered**, statuses fill in later
  per repo; rediscovery prunes vanished repos (and their blame) and ignores
  late writes for them; changing `activeRepoPath` clears the previous repo's
  history/compare state.
- **One root repo renders the panel exactly as before.** Otherwise the Changes
  view is one collapsible section per repo with its own commit box; a section
  follows its content until the user toggles it. Agentic commit is a project
  setting but runs with `cwd = repoPath` of the section.
- **Global git shortcuts** target the active tab's repo, then
  `activeRepoPath`, then the only repo — never `rootPath`.
- **Ignored nested repos** live in the project database (`ignored_repos` /
  `paths`), same twin pattern as the provider policy. Discovery does not
  walk them, `git_projects_dirty` does not count them (so Quick Access stays
  quiet), and the parent repo's status treats those paths as ignored. The
  opened folder itself cannot be ignored. TypeScript:
  `src/lib/config/ignoredRepos.ts`; Rust: `src-tauri/src/ignored_repos.rs`;
  both tested against `ignoredRepos.fixtures.json`.
- Left as it was, deliberately: goal-line evidence (`gitLogSince(rootPath)`)
  and opening a _subfolder_ of a repo (no upward discovery).

### The git graph tab

A full-width editor tab (`git-graph:<repoPath>`, ⌥⌘G, "Show Graph" in
History) that draws every branch, remote and tag as a commit graph and runs
light local operations: checkout, branch create/rename/delete, tag
create/delete, cherry-pick, revert. Nothing pushes or fetches. Contract and
the rules QA added: [docs/design-git-graph.md](../design-git-graph.md).

- **Rust walks, TypeScript lays out.** `git/graph.rs` returns commits in
  topological order with parents; lanes are `src/lib/git/graphLayout.ts`,
  tested against `gitGraph.fixtures.json` and a seeded fuzz. Lane 0 is
  HEAD's first-parent line.
- **Writes never force.** `git/refs_ops.rs` refuses with a coded sentence
  (`<code>: <sentence>`); unmerged deletes need an explicit second confirm.
  Cherry-pick and revert use the real `git` CLI, so conflicts land in the
  state the merge panel's `git_operation_step` already finishes.
