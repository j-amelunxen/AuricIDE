# Goals & Conductor Loop

The Goals & Conductor Loop module manages goal hierarchies, satisfaction criteria verification, and autonomous agent orchestration across tickets in AuricIDE.

---

## 1. Purpose

The core paradigm of AuricIDE is outcome-driven development:

- **Goals**: Desired world states structured as a tree with machine-checkable success criteria and verification gates.
- **Tickets**: Transient work items attached to epics and goals.
- **Conductor**: An autonomous execution engine that identifies unblocked tickets, schedules implementer agents, supervises their execution, and invokes judge evaluations until the goal is satisfied or a budget is reached.

---

## 2. Boundaries

- **Agent Process Management**: Does not fork PTY processes or manage raw terminal output; this is delegated to [Agent Fleet](./agent-fleet.md).
- **Scheduled Timetable Triggering**: Does not manage the cross-project cron runner; that belongs to [Notifications & Schedules](./notifications-schedules.md) and [Scheduled Conductor Runs](../../design-scheduled-conductor-runs.md).
- **Tool Protocol Surface**: Does not expose Model Context Protocol endpoints directly; see [FastMCP Server](./fastmcp-server.md).

---

## 3. Public Contracts

### Goal Satisfaction (`getGoalSatisfaction`)

A goal is evaluated as `satisfied` if and only if **all four** conditions hold:

1. **Subtree Tickets**: Every ticket attached to the goal or any of its descendant sub-goals must be in status `done` (or `discarded`).
2. **Linked Requirements**: Every invariant requirement linked to the goal must have status `verified`.
3. **Goal-Line Stations**: Every station in the goal's line must have status `done` **and** carry verified evidence (`isVerifiedEvidence(station.evidenceKind)`). A bare claim blocks satisfaction.
4. **Child Goals**: Every direct child sub-goal in the goal tree must have status `achieved`.

_Non-vacuity invariant_: A goal with no attached tickets, requirements, stations, or child goals refuses auto-satisfaction and reports a blocker.

### Workflow Stages (`getGoalWorkflowStage`)

Derives the 4-step onboarding progress:

- `define` (Step 1): Name, outcome description, and success criteria.
- `attach` (Step 2): Linking tickets, requirements, or goal-line stations.
- `execute` (Step 3): Conductor run active or work ready to execute.
- `done` (Step 4): Satisfaction checks green; mark achieved.

### Conductor Execution (`startConductor`)

Parameters:

- `goalId`: Target goal UUID (or `null` to run against all open tickets in the project).
- `options`:
  - `ticketBudget`: Limit on distinct tickets spawned in this run (ends with outcome `budget_reached`).
  - `maxConcurrent`: Maximum parallel implementer agents (default `1`).
  - `requireReview`: Whether judge evaluation is required before tickets mark `done`.
  - `judgeForm`: `'llm'` (direct API call) or `'agent'` (independent reviewer CLI).
  - `judgeProviderId`, `judgeModel`: Provider/model configuration for the judge.

### Ticket Attempts & Concurrency Rules

- `MAX_TICKET_ATTEMPTS = 2`: If an agent fails or the judge rejects work twice, the ticket transitions to `failed` and halts further automatic attempts on that item.
- Priority ordering: `critical` (0) > `high` (1) > `normal` (2) > `low` (3), followed by `sortOrder`.
- Dependency gating: A ticket is blocked while any prerequisite target ticket remains incomplete.

---

## 4. Key Flows

### 4.1 Goal Setup & Work Attachment

1. The user defines a goal in the Work place (`Work → Goals`).
2. Success criteria are recorded as markdown bullet points.
3. Work items are attached:
   - Existing tickets linked via `ticket.goalId`.
   - Invariant requirements linked via `pm_goal_requirement_links`.
   - Verification stations configured in `pm_goal_stations`.

### 4.2 Conductor Execution Loop

1. **Backlog Scan**: `conductorTick()` queries unblocked tickets in the target goal's subtree.
2. **Supervision Check**: Tickets with `needsHumanSupervision: true` pause the conductor until explicitly approved by the user.
3. **Implementer Spawn**: The Conductor calls `spawnNewAgent` with the ticket prompt and required skills.
4. **Agent Lifecycle Monitoring**: The conductor listens for agent completion events:
   - On clean exit (status `idle`): If `requireReview` is enabled, triggers the Judge; otherwise marks the ticket `done`.
   - On error: Records the failure; retries once if attempts < 2; otherwise flags as failed.

### 4.3 Judge Verification

1. **Prompt Construction**: Builds the evaluation prompt with acceptance criteria, diff context, and test outputs.
2. **Review Execution**: Runs LLM judge or reviewer agent.
3. **Verdict Evaluation**:
   - `approved`: Ticket marked `done`.
   - `rejected`: Ticket re-opened with feedback, or failed if attempts exhausted.

### 4.4 Satisfaction Check & Auto-Achievement

1. Once all active agents complete and no unblocked work remains, `getGoalSatisfaction()` evaluates the four conditions.
2. If green, the goal transitions to `achieved` and a success notification is dispatched.
3. If blocked or budget reached, the conductor terminates with a descriptive `ConductorRunSummary`.

---

## 5. Dependencies

- **[Agent Fleet](./agent-fleet.md)**: Agent execution, terminal streaming, and status tracking.
- **[Tauri Backend Core](./tauri-backend-core.md)**: SQLite storage in `<project>/.auric/project.db` for goals, tickets, and stations.
- **[Configuration & Credentials](./configuration-credentials.md)**: Conductor provider and judge model settings.
- **[Notifications & Schedules](./notifications-schedules.md)**: Outcome notifications and scheduled runs.

---

## 6. Relevant Source Paths

- `src/lib/goals/` — Station order management and goal graph helpers.
- `src/lib/conductor/` — Judge backend (`judgeBackend.ts`) and scheduled run runner (`scheduledRun.ts`).
- `src/lib/store/goalsSlice.ts` — Goal tree hierarchy, movement planning, and satisfaction evaluation.
- `src/lib/store/conductorSlice.ts` — Conductor state machine, ticket prioritization, and judge handoff.
- `src/lib/store/pmSlice.ts` — Epics and tickets state management with draft/persistence separation.
- `src-tauri/src/database.rs` — SQLite tables (`pm_goals`, `pm_tickets`, `pm_requirements`, `pm_goal_stations`).
