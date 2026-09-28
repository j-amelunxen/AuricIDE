# Goal dependencies: serial, parallel, bundle

Sub-goals used to carry only a `sortOrder`. With nothing else to go on, the
conductor started every sub-goal of a goal at once and picked tickets from the
whole subtree by priority. A plan like "first the data model, then API and client
together, then the rollout" could only live in prose. This document explains how
such a plan is written down and enforced.

## The model

| Plan says               | Stored as                                  | Effect                                                                                    |
| ----------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| B after A (serial)      | row in `pm_goal_dependencies` (B → A)      | B, its subtree and their tickets wait until A is `achieved`/`archived`                    |
| A and B side by side    | nothing                                    | both run, which is the default and what every existing project does                       |
| B and C finish together | `pm_goals.bundle = 'api'` on both siblings | neither is achieved before both meet their own conditions; waiting for one waits for both |

- **`failed` keeps blocking.** An `archived` goal was dropped on purpose, so it
  no longer holds anyone up. A `failed` one means the base the next goal would
  build on is broken, and that needs a human decision, not a quiet start.
- **Blocking is inherited.** A blocked goal's descendants are blocked too,
  together with the tickets linked to them. Without this, a sub-sub-goal would
  start while its parent is still waiting.
- **Bundles act on the target side only.** An edge onto a bundle member waits for
  every member. The members themselves do not start together: a bundle means
  "finish together", not "start together" (co-scheduling was considered and not
  chosen). A `dependsOn` on member B therefore does not hold back member C.
- **Bundles are scoped to siblings.** The same label under two parents means two
  bundles. Labels compare trimmed, and a blank label means no bundle.
- **Waves** are the topological levels of a parent's children, with a bundle
  kept in one wave. They are derived and never stored. An edge from a grandchild
  onto a sibling orders the two top-level children. The waves drive the plan
  graph and `list_goal_dependencies`.

## What is rejected, and why

`validateGoalDependencies` (`src/lib/goals/goalDependencies.ts`) returns one error
per rejected edge:

- `unknown-goal`, `self`: plain nonsense.
- `ancestor`: a parent is achieved only once its children are, so a child that
  waits for its parent waits forever.
- `descendant`: the goal already contains the target and cannot finish before it
  anyway. The edge is noise, and it would deadlock through inheritance.
- `same-bundle`: members run in parallel by definition.
- `cycle`: checked on a waits-for graph over bundle-collapsed nodes. The graph
  has three kinds of arcs: own edges, completion arcs (parent → child) and
  inheritance arcs (each descendant → the target of its ancestor's edge). The
  last two catch deadlocks that no single edge shows, for example
  `Y → A, A → X` where X is a child of Y.

Edges are inserted in input order, and the one that would close a loop is the
one rejected. That makes "which edge gets the error" deterministic, which the
Rust twin depends on.

## Twins

- **TypeScript** (`goalDependencies.ts`) owns all of it: validation, blockers,
  bundle hold, waves. The store, the conductor, the MCP server and the graphs
  all call it.
- **Rust** (`src-tauri/src/database/goal_deps.rs`) only validates. It runs at the
  end of the `goals_sync_impl` transaction and rolls the whole sync back on the
  first rejected edge. The app therefore cannot persist a deadlock, even through
  a bug in the frontend.
- Both run `src/lib/goals/goalDependencies.fixtures.json`. **Change the fixtures
  first**, then both sides.
- The satisfaction twin (`evaluate_goal` in `src/mcp/tools/goalsDb.ts`) mirrors
  the bundle hold of `getGoalSatisfaction`. Waiting is not a satisfaction
  blocker: a goal that is waiting has not failed at anything, it simply has not
  started.

## Why a separate table

`pm_dependencies` already links tickets and epics. It was not reused because:

- `pm_save_impl` deletes and re-inserts the whole table on every PM save, so
  goal edges written by MCP would be wiped by the next ticket edit.
- It has no foreign keys, so a deleted goal would leave dangling edges.

`pm_goal_dependencies` has cascading foreign keys on both ends. It travels
through the row-level goal sync, and its rows are immutable: an edge is added or
removed, never edited.

## Surfaces

- **MCP**:
  - `create_goal { dependsOn, bundle }`.
  - `decompose_goal { mode: 'serial' | 'parallel', children[{ key, dependsOn, bundle }] }`.
  - `add_goal_dependency`, `remove_goal_dependency`.
  - `list_goal_dependencies { parentId }`, which returns edges, bundles, blocked
    goals and waves.
  - `get_goal` and `get_goal_tree` carry `bundle`, `dependsOn` and `blockedBy`.
  - `fetch_next_unblocked_task` skips tickets of blocked goals.
- **Conductor**:
  - A blocked stations-mode goal is neither launchable nor exhausted (preflight
    `stationGoalsBlocked`).
  - Tickets of blocked goals are filtered out before `getUnblockedOpenTickets`.
  - Auto-achieve closes a bundle in one step, never one member alone.
  - Auto-achieve runs at the start of every tick, not only once the run is out
    of work (`conductorGoalSweep.ts`). A goal that others wait on has to be
    closed before they are released, so a chain only runs through in one run
    if each link closes as soon as it is finished. A goal whose own agent still
    runs is not closed yet.
  - Tickets of a blocked goal do not count as work left. With nothing running,
    what blocks them cannot change any more, so the run ends `goal_blocked`
    and names the blocker instead of idling.
- **UI**: the sub-goal plan graph (waves as columns, bundles framed, blocked goals
  dimmed), dependency edges in the work map, and the "waits for" and bundle
  editors in the goal detail.
- **mission-to-goals skill**: sends the sub-goal files' `depends_on` and `bundle`
  along with `create_goal`.
