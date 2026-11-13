# Goals, requirements and conductor

[Developer guide index](README.md) · [Documentation index](../README.md)

Execution rules and acceptance gates. See also the [module specification](../spec/modules/goals-conductor-loop.md) and [goal dependency design](../design-goal-dependencies.md).

## Goals, Tickets, and the Conductor Loop

Goals lead; epics are storage. The primary workflow of the app is one loop:

1. **Define a goal** — a desired world state with machine-checkable `successCriteria` (`pm_goals`, tree via `parentId`).
2. **Attach work** — link tickets to the goal (`ticket.goalId`, set atomically via `create_ticket`'s `goalId` param or `link_ticket_to_goal`), link requirements as acceptance gates, or launch a planning agent that calls `decompose_goal` / `create_ticket` itself.
3. **Run the conductor** (`conductorSlice`) — it spawns agents for unblocked open tickets in the goal's subtree (priority order, dependency-aware, `needsHumanSupervision` approval gate, 2 attempts per ticket).
   Started on a parent goal it works the whole tree unattended, all agents
   headless:
   - **Start is the go-ahead for the tree.** Draft goals in it become `active`
     (mission-to-goals registers every sub-goal as a draft for review first).
   - **Order comes from goal dependencies** ([docs/design-goal-dependencies.md](../design-goal-dependencies.md));
     goals without an edge run side by side.
   - **A finished sub-goal closes in the same tick** (`conductorGoalSweep.ts`),
     which releases whatever waits on it. Not while its own agent still runs.
   - **Stations goals get a goal agent, empty goals a planning agent**, both
     spawned directly (`conductorGoalAgents.ts`), never via a launch request.
     The planner only lays out stations (or tickets, in ticket mode) and stops.
   - **Nothing left that can move ends the run** with the blockers named, rather
     than idling on work a failed or exhausted goal holds back.
   - **Human stations are handed over, never waited on.** Conductor goal agents
     get the launch prompt with `unattended: true`: no `/goal` (its stop hook
     refuses to let an agent end while an open human station keeps the goal
     unmet, so the run hung), and a rule to call `request_human_check` (MCP)
     and move on to the next station. The steps land on the station and as one
     inbox warning; "For you" lists every open human station with no open agent
     station before it. The goal stays open and its dependents keep waiting
     until a person ticks it. A run that ends on them says "Goal waits for you".
     `GOAL_AGENT_TIMEOUT_MS` (2 h) ends any conductor goal agent that still
     does not exit.
   - **A run can be scoped to one epic instead of a goal.** The play button on
     an epic row (ticket list) preloads the conductor panel with it
     (`conductorScopeEpicId`, a chip there); Start runs it as a goal-less run
     over that epic's tickets only (`conductorEpicId`). Picking a goal drops
     the epic. A ticket waiting on one outside the run does not keep the run
     alive: it ends and names the ticket.
4. **Verified done** — when no work is left, `getGoalSatisfaction` checks **four**
   conditions: all subtree tickets `done` + all linked requirements `verified` +
   **every station of the goal's line `done`** + all child goals `achieved`. If
   green, the goal auto-achieves; otherwise the blockers are listed. A goal with
   nothing attached never auto-satisfies.

   The station condition is the one people forget when debugging "why won't this
   goal close". It is stricter than `status === 'done'`: a station whose evidence
   is a bare claim rather than a verified kind blocks exactly like a pending one
   (`isVerifiedEvidence`, `goalsSlice.ts`). The `stations` parameter is required
   on purpose so a caller cannot omit it and get a falsely green goal.

   A station with a machine predicate is never settled by a claim. MCP
   `mark_station_done` runs `file_exists`, `ticket_done` and
   `requirement_verified` on the spot (`src/mcp/stationEvidence.ts`, walking the
   folder the way `list_all_files_impl` does): proof if it holds, an error and an
   open station if not. A claim that still lands on a machine station (older
   rows, `git_touches`) is decided by its predicate in `checkClaimedStations`,
   rejected claims included; the judge only sees `judged` stations and those
   without a predicate.

**Sub-goals can be ordered: serial, parallel, bundle.** An edge in
`pm_goal_dependencies` (B → A) makes B, its subtree and their tickets wait until
A is `achieved` or `archived`. A `failed` A keeps blocking. No edge means the
two run in parallel, which is the default. The same `bundle` label on siblings
means the members finish together: none is achieved before all of them meet
their own conditions, and waiting for one member waits for all of them. One
definition lives in `src/lib/goals/goalDependencies.ts`. The Rust twin
(`database/goal_deps.rs`) validates at the end of `goals_sync_impl`, and both
run `goalDependencies.fixtures.json`, so **change the fixtures first**. The
conductor starts nothing that is still waiting. A goal that is waiting is not a
satisfaction blocker; a held bundle is. The reasoning, and why this is not
`pm_dependencies`, is in [docs/design-goal-dependencies.md](../design-goal-dependencies.md).

**How long a goal sat where** is recorded like it is for tickets, in its own
table `pm_goal_status_history` (migration 24, twinned in `src/mcp/db.ts`).
Rust writes it inside `goals_sync_impl` by comparing the _stored_ statuses
before and after the goal writes, so a write rejected as a conflict is not
logged as a change. The MCP writers in `goalsDb.ts` (`createGoal`,
`updateGoal`, `recordGoalRun`) log their own changes. Goals that existed
before the table got one `backfill` snapshot of their status at the time, not
invented transitions. The UI says "Tracked since …" for these goals, and they
get no lead time. `computeGoalMetrics` (`src/lib/pm/metrics/goalMetrics.ts`)
shares its core with the ticket metrics (`lifecycle.ts`). Review counts as
part of the working spell, so rework does not restart the cycle.
`reviewRounds` counts how often the goal went into review. `GoalTiming` in the
goal detail panel shows the result, and `list_goal_status_history` exposes it
over MCP.

Tickets still belong to an epic (`epicId`, required) — that is the organizational/backlog view. The goal link (`goalId`, optional) is the outcome view and drives satisfaction. `getGoalWorkflowStage` (goalsSlice) derives which loop stage a goal is in and powers the onboarding stepper in `GoalDetailPanel` plus the workflow strip in `GoalsModal`.

## Requirements vs. Tickets

Requirements and Tickets serve fundamentally different purposes:

- **Requirements** are **application invariants** — analogous to loop invariants in formal verification. An invariant is provable, continuously checked, and when it breaks, you know the code is wrong. Requirements are never "done"; they are either fulfilled or violated. They are linked to test cases (proof of the invariant), tracked for verification freshness (`lastVerifiedAt`), and scoped to specific code paths (`appliesTo`).
- **Tickets** are transient work items — tasks that get completed and closed. Tickets are created _to fulfill_ requirements. Once a ticket is done, the requirement it serves should be verified (status → `verified`).

The lifecycle: `draft` → `active` → `implemented` (code exists) → `verified` (tests confirm it) → optionally `deprecated`. Verification is not permanent — a requirement can become _stale_ if not re-verified within 30 days.

### Requirements Data Model (`PmRequirement`)

Defined in `src/lib/tauri/requirements.ts`. Key fields:

| Field                | Type                                                                 | Purpose                                                                  |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `reqId`              | `string`                                                             | Human-readable ID, auto-generated from category (e.g. `REQ-AUTH-01`)     |
| `title`              | `string`                                                             | Short name (only true required field at creation)                        |
| `type`               | `'functional' \| 'non_functional'`                                   | Functional requirement vs. NFR (performance, security, etc.)             |
| `category`           | `string`                                                             | Grouping key (e.g. `auth`, `perf`) — used for filtering and reqId prefix |
| `priority`           | `'low' \| 'normal' \| 'high' \| 'critical'`                          | Business priority                                                        |
| `status`             | `'draft' \| 'active' \| 'implemented' \| 'verified' \| 'deprecated'` | Fulfillment lifecycle                                                    |
| `description`        | `string`                                                             | Full Markdown description                                                |
| `rationale`          | `string`                                                             | Why this requirement exists                                              |
| `acceptanceCriteria` | `string`                                                             | Markdown checklist that defines "fulfilled"                              |
| `source`             | `string`                                                             | Origin document (e.g. `spec.md`)                                         |
| `lastVerifiedAt`     | `string \| null`                                                     | Timestamp of last verification (null = never verified)                   |
| `appliesTo`          | `string[]`                                                           | Code paths this invariant covers (e.g. `src/auth/`)                      |

### Requirements Stack

```
UI (RequirementsModal)  →  Zustand (requirementsSlice)  →  IPC  →  Rust/SQLite (pm_requirements + pm_requirement_test_links)
                            ↕
                        MCP Tools (list/get/create/update/delete/import/link/unlink/verify/get_tests)
```

- **Store:** `src/lib/store/requirementsSlice.ts` — same draft pattern as PM (draft + persisted + dirty flag); includes test link drafts and selector helpers (`getStaleRequirements`, `getUnverifiedRequirements`)
- **IPC:** `src/lib/tauri/requirements.ts` — `requirementsLoad`, `requirementsSave`, `requirementsClear`; `RequirementsState` includes `testLinks: PmRequirementTestLink[]`
- **MCP:** `src/mcp/tools/requirements.ts` — 10 tools, supports `resolveRequirementId` (UUID, prefix, or reqId like `REQ-AUTH-01`)
- **UI:** `src/app/components/requirements/` — Modal with FilterPanel (includes verification freshness filter), List (verification indicator), DetailPanel (verify button, appliesTo chips, linked tests), CreateDialog (appliesTo input)
