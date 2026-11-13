# AuricIDE architecture — modules and dependencies

Status: written 2026-10-23 against `main` at `10878a8f`, checked against the code, not
copied from older docs. Where a number is given it was counted that day.

The ownership sections and affected source counts below are updated on
2026-11-11 on `refactor/untangle`. Other historical counts retain their original
measurement date.

The overview scenes' Rust headline counts all `.rs` files under `src-tauri/src`,
including tests. Agent-module counts refer to runtime source files. The labels
make that distinction explicit rather than relying on test-file name exclusions.

This is the module-level companion to [`../architecture.md`](../architecture.md) (the
one-screen diagram) and to the [developer guides](../development/README.md) (the working
rules per feature). It answers three questions: what are the modules, what depends on what, and
where can something from outside dock on. The last one has its own file:
[`interfaces.md`](interfaces.md).

The same content as 3D scenes, for a viewer that reads them through the Supervisor
Link:

| Scene                                                                  | What it shows                                                     |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`auricide-modules.scene.json`](auricide-modules.scene.json)           | The modules and their dependencies (this file, as a picture)      |
| [`auricide-interfaces.scene.json`](auricide-interfaces.scene.json)     | Every external docking point and what stands behind it            |
| [`auricide-runtime-flow.scene.json`](auricide-runtime-flow.scene.json) | How a client request becomes an agent, a branch and a merge       |
| [`supervisor.scene.json`](supervisor.scene.json)                       | Supervisor launch, child admission, manager booking and adoption  |
| [`agent-session.scene.json`](agent-session.scene.json)                 | Process and PTY ownership, publication and ordered run completion |
| [`foundations.scene.json`](foundations.scene.json)                     | Shared Rust environment, identity and file-storage foundations    |
| [`system.scene.json`](system.scene.json) and its module scenes         | The older system view with drill-down (`detail`) into each module |

The three new scenes link into the older module scenes with `detail`, so a viewer can
drill from the overview into `agents`, `supervisor-link`, `mcp` and the rest.

## 1. Shape of the system

AuricIDE is a **Tauri v2 desktop app**. Three layers, one process tree:

```
Next.js 16 / React 19 (src/app, src/lib)  ──invoke()/events──▶  Rust backend (src-tauri/src)
        │  Zustand store (37 creators)                                │
        │                                                             ├─ PTY children: agent CLIs, shells
        │                                                             ├─ SQLite: .auric/project.db + app-level *.db
        │                                                             ├─ git2: all git behaviour
        │                                                             ├─ MCP runtime (Node) started per agent / per supervisor
        │                                                             └─ two unix sockets for clients outside the IDE
        ▼
   webview (WebKit)
```

What makes it more than an editor:

- **It runs other people's agent CLIs** (Claude Code, Codex, Gemini CLI, Crush, …) in
  PTYs, keeps a fleet view with an attention model, and hands each agent an MCP server
  (`auric-pm`) bound to one project.
- **It has a work model on top of tickets**: goals → stations → tickets, with a
  conductor loop that spawns agents until the goal's four satisfaction conditions hold
  ([goal workflow and invariants](../development/goals.md#goals-tickets-and-the-conductor-loop)).
- **It has a supervisor tier**: one interactive agent (the supervisor) that starts
  other agents under a policy file, plus named, remembered supervisors (managers).
- **It can be driven from outside** over three doors that all end in the same
  dispatcher: the `auric-mcp --control` stdio server, `control.sock`, and the
  Supervisor Link WebSocket (`supervisor-link.sock`). See `interfaces.md`.

The frontend owns bookkeeping (tickets, goals, launch defaults, cards); Rust owns
processes, files, sockets and anything that has to be enforced. Where a rule exists on
both sides it is a **twin** tested against one fixture file (see section 4).

## 2. Modules

Paths are relative to the repo root. "Rust" paths are under `src-tauri/src/`. Dependency
statements come from `use crate::…` in non-test Rust code and from imports on the
TypeScript side; arrows mean "uses".

### 2.1 Frontend

**UI shell** — `src/app/` (448 non-test TS/TSX files), `src/lib/editor`, `nlp`,
`terminal`, `explorer`, `work`, `ide`, `overlays`, `theme`.
Purpose: IDE shell, CodeMirror editor and viewers, explorer, terminals, agent console,
PM, git, canvas, settings. `src/app/page.tsx` splits into `useIDEState`,
`useIDEHandlers`, `useIDEActions`. Uses: store, IPC wrappers.

**State store** — `src/lib/store/` (36 `*Slice.ts` plus the overlay slice).
`types.ts` owns the authoritative `StoreState` intersection and derived get/set
contracts. Every creator is typed against that complete state. `createStore.ts`
composes all 37 creators in order; `index.ts` creates the application hook.
Tests use the same factory through `testing.ts`, with explicit typed dependency
overrides and fresh complete state. Exposed on `window.__AURIC_STORE__` for
browser-mode QA. Uses: IPC wrappers. Used by: everything in the frontend.

**IPC wrappers** — `src/lib/tauri/` (58 non-test files), one lazy `invoke.ts` helper.
Purpose: the only place the frontend calls Rust (`invoke`) or listens to Rust events
(`subscribe.ts`). Uses: Tauri JS API. Used by: store, UI.

**Goals and conductor** — `src/lib/goals`, `src/lib/conductor`, `conductorSlice`,
`goalsSlice`, `requirementsSlice`. Purpose: goal trees, satisfaction rule, ticket
spawning loop, scheduled conductor runs. Uses: store, IPC (`pm_*`, `agents`), MCP
`auric-pm` indirectly through the agents it spawns.

The deterministic goal model lives in `src/lib/goals/model/`: tree traversal and
move planning, satisfaction/completion/progress calculations, and dependency
adapters over domain rows. Consumers import these rules directly; `goalsSlice`
does not re-export them. The model receives its data as arguments and does not
load the Zustand store or IPC wrappers. Store-specific draft rebasing and the
clock used for mutations remain with the store. This lets orchestration, usage
aggregation and the MCP satisfaction contract use the same rules without
loading store initialization or a desktop transport.

**Shared rules, one definition each** — rules several features (and often the
MCP server) apply live in small leaf modules with no store or IPC import:
`lib/time/utcStamp.ts` (the UTC `YYYY-MM-DD HH:MM:SS` stamp, written and read),
`lib/pm/blocking.ts` and `pm/enums.ts` `priorityUrgency` (what blocks a ticket
and the priority order the conductor, board, lists and inbox share),
`lib/paths/baseName.ts` and `withoutTrailingSlash.ts` (every path-equality key),
`lib/markdown/markdownPath.ts`, `lib/text/clipAtWord.ts`, `lib/text/modelJson.ts`
(the JSON in a model reply: judge, planner, video import), `lib/pm/labels.ts`
(ticket/goal status and priority names), `lib/ui/pointerDrag.ts` (drag
threshold and the click a drag swallows), `lib/terminal/fit.ts` (fit, refit and
PTY resize for both terminal hosts),
`lib/agents/sessionId.ts` (the agent PTY key) and `lib/store/draftMerge.ts` (the
field-level rebase of a draft onto a fresh load, used by the PM, requirement and
goal slices). `lib/store/projectSession.ts` holds the one list of per-project
resets and loads used when a project opens and when its database changes
outside the IDE. Names Rust spells too are checked against shared fixtures:
`lib/tauri/backendNames.fixtures.json` (prefs Rust reads, events it emits, the
`auric-pm` server name, the folders the file list skips, the agent schedule id
prefix), `lib/agents/taskTitle.fixtures.json` and `src/mcp/dbSchemas.fixtures.json`
(every table and index of a fresh `project.db` and `notifications.db`).

**Agent fleet (frontend half)** — `src/lib/agents/` (liveness, attention, fleet split,
`controlBridge.ts`, `agentWindowHost.ts`, supervisor presets/managers), `agentSlice`.
Purpose: cards, console feed, parking, the attention model, and the frontend end of the
control socket (spawn and kill take the same store actions as the UI buttons).
Uses: IPC, store. Contract fixtures live next to it (`*.fixtures.json`).

**Domain contracts** live with their owners, below IPC and UI:
`src/lib/agents/types.ts`, `quickAccess/types.ts`, `goals/types.ts`, `pm/types.ts`
and `pm/usage/types.ts`. Both `src/lib/tauri/` and `src/mcp/` import those
contracts directly. IPC-specific envelopes remain in `lib/tauri`; MCP does not
depend on that transport layer to describe a domain row.

The MCP caller contract lives in the type-only `src/mcp/controlTypes.ts`.
Control, supervisor and question tools import it directly, so using that
contract does not introduce a dependency on another tool's registration.
Station ID resolution shares `tools/resolve.ts`; its table policy preserves
stations' exact-first lookup, short prefixes and existing errors.

Shared rendering primitives (`ContextMenu`, `ToastHost`, `ProjectTileFace`,
`SkillInvocationInput`, `ManagerConfirmDialog`) live in `components/ui`. The menu
contract lives in `lib/ui/contextMenu.ts`; IDE, settings and terminal contracts
live in their respective `lib/*/types.ts` modules. Pure explorer tree types and
traversal live together in `lib/explorer/fileTree.ts`. Library code imports these
contracts and algorithms directly, without depending on their rendering components.

The shared diff renderer and shortcut sheet live in `components/diff`; the editor's
`DiffViewer` wrapper, git review and merge views consume that renderer. Markdown
link and heading parsing live in `lib/markdown`, with `LinkIndexEntry` in
`markdown/types.ts`. Entity occurrences belong to `nlp/nlpTypes.ts`, and
`ReferenceResult` belongs to `refactoring/types.ts`. Index slices keep their state
and actions; parsing, graph and refactoring code import the contracts directly
without loading store modules to describe their inputs.

### 2.2 Rust backend

**Shared foundations** — `json_store.rs`, `file_lock.rs`, `project_path.rs`, and
`machine/` own file storage, project identity and the login-shell environment.
They do not depend on agents or supervisors:

- `json_store` owns atomic replacement, unique temporary paths, private-file
  permissions, versioned reads and locked updates. Each store explicitly chooses
  its unreadable-file policy (`Refuse`, `MoveAside` or `Empty`).
- `machine::shell_env` owns the shared login-shell cache. `machine` also owns
  executable checks and PATH traversal. Node ABI selection examines every PATH
  candidate; selecting the first executable would change its behavior. An absent
  harvested PATH remains distinguishable from an empty PATH.
- `project_path::real_path` supplies filesystem identity. Its callers retain
  distinct fallback contracts: `canonical_project_path` falls back to normalized
  text, `same_folder` falls back to the original paths, and a failed real-path
  lookup remains `None` where existence is required.
- Provider identifier normalization lives in `providers`, alongside the
  registry, so quota matching and policy parsing do not depend on supervisor
  implementation details for a string operation.

Git, formatting, MCP, Node selection and video preflight use `machine` directly;
video import no longer re-exports the machine resolver. These ownership changes
preserve IPC names, file formats and existing fallback behavior.

**Command layer** — `lib.rs` (registers 229 `#[tauri::command]` handlers in one
`generate_handler!`, which Tauri needs as a single list), each feature's own
`commands.rs` (notifications, schedules, missions, mcp, llm, excalidraw, themes,
crashlog, agent_log, providers), `commands/` (fs, db, agent, inbox, terminal,
watcher, the menu's command states),
`database/` (SQLite schema, migrations, CRUD for epics, tickets, goals, requirements,
reviews, goal dependencies). Purpose: IPC dispatch and persistence of the work model.
Uses: nearly everything below. Not used by anything except Tauri.

**Agent runtime** — `agents/` (21 non-test files: manager, session finish, PTY registry, exit log, PTY output buffer, awaiting-input
detection, write sandbox, launch dir, run results, MCP guard), `agent_persistence.rs`,
`agent_log.rs`, `task_log.rs`, `agent_window.rs`, `providers/` (provider registry, `dynamic-providers/`
JSON; each provider's `McpBinding` — unbound, template, Codex TOML or Crush config —
is read from its declaration and answers whether it can be project-bound, reads the
per-agent MCP config and carries SSE), `provider_policy.rs`, `connectors/`, `extra_mcp.rs` (a project's extra MCP servers from its `.mcp.json`, named in the supervisor policy's `extraMcpServers` and merged into each agent's private MCP config). Purpose: spawn, stream, kill and persist
agent processes. Depends on: providers, supervisor, mcp, notifications, agent_usage, machine
and json_store. It is the most connected module in the backend.

`AgentSession` groups the child process, run metadata and an `AgentPty` registration
handle. `agents::pty` owns terminal state, writing, resize announcements and the
agent session-key convention. A pending PTY owns its writer/master until publication;
after publication the registry and in-flight operations hold the terminal references.
The session handle retains the key and registry, without retaining another writer
reference that could keep a closed terminal alive. The existing publish-then-liveness
recheck prevents an immediate exit from leaving a late PTY registration behind.
A native kill is attempted while the manager still owns the session. On failure,
the process, metadata and PTY registration remain available for another attempt;
no ending is published. On success, the runtime claims the session under that
same lock, then releases the lock before dropping the writer and finishing the
run. The native call may spend its existing Unix SIGHUP grace period under the
manager lock. An accepted kill is not a guarantee about every descendant.
There is no repo-wide native kill: "Stop all" in the UI sends one `kill_agent`
per ID it counted for the confirmation (`src/lib/agents/stop.ts`), so agents
started later are outside the selection and a failed member keeps its writer.
A refused kill counts as stopped only when a fresh, well-formed `list_agents`
no longer shows the agent running; otherwise the store keeps the card, logs,
ticket and goal run and rejects with `AgentStopError`, which every Stop control,
the conductor and the control bridge report.

`agents::finish::finish_agent` owns the ordered completion steps for natural exit,
manual kill and app quit. Results capture console text before finishing a buffer
can evict it. The first manager remover owns the result and run bookkeeping; a late
EOF retains its existing console/status behavior without replacing that result.
Natural exit publishes status before scheduling records and ending the launch; kill
publishes status afterward and remains `Idle`. App quit keeps restart anchors,
does not publish console/results/status/launch endings, and shares one two-second
usage-booking deadline across all drained runs. Command adapters preserve IPC names;
the runtime no longer imports command-owned terminal infrastructure.

**Control socket** — `control_socket/` (16 files; `caller.rs` PID walk, `protocol.rs`,
`link_spawn.rs`, `pingback.rs`, `stall_watchdog.rs`). Purpose: NDJSON unix socket
`control.sock` plus the shared `Dispatcher` that both outside doors use. Depends on:
agents, supervisor and supervisor_link. The native backend accesses agent PTY
infrastructure directly, without importing terminal state from command adapters.

**Quota blocks** — `quota_blocks/` (matcher, store, reset time), `agents/quota_detection.rs`,
`control_socket/quota_blocks.rs` and `src/lib/config/quotaBlocks.ts` (types and matching
rules, no UI). Purpose: remember for a limited time that a provider or model family ran
out of quota, in `quota-blocks.json`. An agent's console tail is scanned when it ends; a
block can also be set over the control socket. Only a supervisor's spawns are refused.
Depends on: providers (provider id normalization), json_store (atomic file storage).

**Supervisor** — `supervisor/` (launch, admission, policy, runs, managers, memory,
several, attachments)
and `src/lib/config/supervisorPolicy.ts` (twin). Purpose: the policy
(`supervisor-policy.json`), run folders under `~/.auric/supervisors/`, named managers
with `INSTRUCTIONS.md` and an OKF memory. Depends on: agents, connectors,
notifications, machine.

`supervisor::launch` owns role admission, supervisor launch configuration and
CLI/MCP binding, manager launch booking, the late duplicate-run check, and child
adoption. `agents::manager` still owns process/PTY creation and invokes booking
and adoption at their original points after successful process start: adoption
before inserting the new agent, manager booking after insertion.
`LaunchToBook` belongs to the supervisor launch module, even though an
`AgentConfig` carries it between preparation and startup.

`supervisor::admission::ChildAdmission` assembles the common policy-check inputs
from explicit snapshots and retains structured denials for the control socket
and formatted errors for final process admission. Each caller still reads
policy, offerings, modes, project policy, running children and quota at its
original point and in its original order. Running-child counting canonicalizes
project paths, so it is itself a filesystem read. A successful socket pre-check
never replaces the final check or carries a cached acceptance into it.

The remaining `agents` ↔ `supervisor` dependency is explicit: the process runtime
calls supervisor policy/launch code, and supervisor code uses agent runtime
types and adoption state. Moving launch ownership does not make these two
runtime modules independently extractable.

**Supervisor Link** — `supervisor_link/` (21 files: `protocol.rs`, `mod.rs` WebSocket
server, `documents.rs`, `assets.rs`, `jobs.rs` + `job_runner.rs`, `policy.rs`,
`proposals.rs`, `subscription.rs`, `subtree.rs`, `instructions.rs`, `glob.rs`).
Purpose: the Supervisor Control API, see `interfaces.md` section 3. Depends on:
supervisor, agents, control_socket (shares the dispatcher). `control_socket` also
reaches back into it (5 references), so the two form a cycle that is deliberate: one
dispatcher, two doors.

The job runner records cancellation intent before requesting a stop. Failed
dispatcher stops reach the caller and a deduplicated inbox warning; subsequent
ticks retry while the agent remains listed as running or queued. A launch that
received no worktree stays tracked until its ending is observed, then fails
with `internal`. Its persisted null worktree records that launch outcome;
a worktree directory disappearing later does not change the stored outcome.
The stop observation uses the existing dispatcher/agent-registry contract;
native child-kill errors now retain the live session and reach the dispatcher.
Frontend stop-action cleanup remains a separate lifecycle boundary. On app
restart, active job records still become `interrupted`.

**MCP runtime** — `mcp.rs` (writes per-agent MCP config, starts/stops the server),
`node_runtime.rs` (picks a Node whose ABI matches the bundled `better-sqlite3`
addon and writes that absolute path into every generated MCP config),
`src/mcp/` (FastMCP server, `cli.ts` mode switch, 26 tool files, about 90 tools),
bundled by `pnpm mcp:bundle` into `src-tauri/resources/auric-mcp/` (a build output,
not in git; `manifest.json` records `nodeModuleVersion`). Purpose: three server
modes, see `interfaces.md` section 2.
Depends on: project DB (`better-sqlite3`), notifications DB, control socket client.

**Git** — `git/` (30 files, git2-rs: status, diff, two-file compare (`diff_files`), stage,
commit, push, blame, branches, graph, merge, worktrees), `ignored_repos.rs`, `src/lib/git`.
All git behaviour is in Rust; `lib.rs` only registers it. Depends on: ignored_repos,
machine (executable resolution), skip_recent_walk_dir and video_import.

**Notifications, schedules, inbox, missions** — `notifications/`, `schedules/`,
`inbox/`, `missions/`, `delivery/` (outbound push), `notifications.db`, `inbox.db`.
Purpose: cross-project event log, cron and one-shot schedules that survive restarts,
GTD inbox, markdown missions owned by a repo. Depends on: database, schedules ↔
notifications (mutual). `schedules_occurrences` walks the runner's own engine over a time
window so the Command Center's calendar and timeline views draw exactly the runs the
runner will make (capped at 200 per schedule, 3 000 overall); past runs are read from the
notifications a schedule raised, never from a separate history.
A schedule also carries `exceptions` (JSON column, migration 10): single occurrences moved
or skipped, applied inside the engine so the runner, the preview and the views agree. The
calendar and timeline create schedules by click and move runs by drag ("only this
occurrence" writes an exception, "all occurrences" rewrites the rhythm).

**Usage** — `cc_usage/` (what the CLIs consumed, from transcripts), `usage_limits/`
(quota window via a Claude `--settings` statusLine sidecar and the Codex CLI),
`agent_usage/` (cost of one run, booked into `pm_agent_usage`), `task_log.rs`
(monthly JSONL log `tasks-YYYY-MM.jsonl` of finished agent tasks, opt-in for billing),
`external_agents/` (runs the IDE tracks without a process, `external-agents.json`; they
book through the same two records, `docs/design-external-agents.md`).
`capability_tokens/` (scoped capability tokens: a grant on one resource for named
actions, hash-only in `capability-tokens.json`; first scope `external_run` /
`external_stop`, `docs/design-capability-tokens.md`) and `file_lock.rs` (the advisory
lock both stores share).
Depends on: providers, agents, webview_prefs.

**Imports and machine tools** — `video_import/` (transcription, frames), `machine/`
(declared table of `ffmpeg`, `ffprobe`, `go`, `okf`; absolute-path resolution through
the login shell), `formatter/` (format on save: the project's biome or prettier,
ruff or black, gofmt, rustfmt, shfmt, resolved through `machine/`; Tauri command
`format_document`, never writes a file), `excalidraw/` (Excalidraw+ REST, mock lane `AURIC_EXCALIDRAW_MOCK=1`),
`llm.rs` (HTTP calls to LLM APIs), `app_config.rs` (machine-wide credentials,
`app-credentials.json`, 0600).

**Platform shell** — `menu.rs`, `menu_bar.rs`, `ui_watchdog.rs`, `crashlog.rs`,
`webview_prefs.rs`, `recent_projects/`, `project_icons.rs`, `project_skills.rs`,
`themes.rs`, `clipboard.rs`, `memory_report.rs`, `recent_creations.rs`, `ansi.rs`,
`utf8_stream.rs`. Purpose: native menu and menu-bar icon, stall detection, crash log,
cross-origin prefs mirror, project discovery.

### 2.3 Verification and tooling

`verification/` (Lean 4 model plus JSON contracts `goal-satisfaction-v1.json`,
`launch-gate-v1.jsonl`, `provider-policy-v1.jsonl`), `e2e/` (Playwright, 8 top-level
entries), `scripts/` (probes against a real app: `probe-supervisor-link.mjs`,
`probe-agent-control.mjs`, `probe-supervisor.mjs`, `probe-project-manager.mjs`),
`.husky/pre-commit` (lint-staged, knip, jscpd; fmt, clippy, test and machete when Rust
is staged), `docs/automation-surface.md` (generated). ADRs: `docs/adr/0001…0004`.

## 3. Dependency overview

Backend, from `use crate::…` counts (top-level modules, tests excluded; only edges with
at least 2 references or a structural role):

```
                       ┌──────────────── commands / lib.rs ─────────────────┐
                       ▼                                                    ▼
 notifications ◀── agents ──▶ providers ──▶ connectors            database, inbox
      ▲   ▲        ▲ │ ▲                     ▲                        ▲
      │   │        │ │ └── agent_usage ──▶ cc_usage                   │
 schedules│   supervisor ◀── control_socket ◀──▶ supervisor_link       │
      │   │        │            │                                      │
   missions       machine       git (leaf; uses ignored_repos)      app_config ──▶ delivery
                                                                     excalidraw, llm ─▶ app_config
```

Reading rules:

- **Everything outside lands in `agents`.** Both sockets, the MCP `--control` mode, the
  conductor and the UI buttons reach agent spawn through `spawn_agent_impl`, which is
  also where provider policy, supervisor policy and the write sandbox are enforced.
- **`control_socket` ↔ `supervisor_link` and `agents` ↔ `supervisor` are cycles.**
  They are intentional (shared dispatcher; supervisor children are agents) but mean
  none of these four can be extracted alone.
- **`git` is nearly a leaf.** It uses `ignored_repos`, `skip_recent_walk_dir`,
  `video_import` and the machine executable resolver. Resolving a tool no longer
  introduces a dependency on the agent runtime.
- **Frontend direction is one-way**: UI → store → IPC wrappers → Rust. Rust never
  imports TypeScript; it reaches the frontend only through events and the control
  bridge (`control-request` / `control_respond`).

## 4. Twins and fixtures

A rule that exists in Rust and TypeScript is tested against one JSON file; **change the
fixture first**. From the code (all under `src/lib/**` unless noted):
`providerPolicy`, `goalDependencies`, `goalsSync`, `goalReviewsSchema`,
`supervisorPolicy`, `supervisorLink`, `supervisorManagers`, `agentControl`,
`agentWindow`, `awaitingInput`, `externalAgents`, `capabilityTokens`,
`scheduleDedupeKey`, `attachmentKinds`, `ignoredRepos`, `extraMcpName`,
`videoImportSettings`, `auricEnv`, `backendNames`, `taskTitle` (each `<name>.fixtures.json`)
and `src/mcp/dbSchemas.fixtures.json`. `gitGraph` and `goalReviewDecision`
are read by TypeScript only (the graph layout, and the review decision checked against `decide.py`).

## 5. Gaps, inconsistencies and stale docs

Found while writing this; items 1, 2, 3, 5, 9, 10 and 12 were fixed in the follow-up docs commit on `main`.

| #   | Where                                                                       | Doc says                                                                                                   | Code says                                                                                                                                                                                                                                           | Status    |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | `CLAUDE.md`, "Rust Backend Modules" table                                   | Files `agents.rs`, `git.rs`, `database.rs`, `inbox.rs`, `notifications.rs`, `schedules.rs`, `providers.rs` | These are directories now (`agents/`, `git/`, `database/`, `inbox/`, `notifications/`, `schedules/`, `providers/`). The table also omits `supervisor/`, `supervisor_link/`, `control_socket/`, `machine/`, `connectors/`, `missions/`, `delivery/`. | **Fixed** |
| 2   | `CLAUDE.md`, "MCP Server"                                                   | "15 tool domains with 40+ tools"; run standalone with `npx tsx src/mcp/server.ts /path/to/project.db`      | 25 tool files and about 90 tool registrations; `cli.ts` requires `--project-root <dir>` (or `--control` / `--supervisor`), a bare db path is refused (`USAGE` in `src/mcp/cli.ts`).                                                                 | **Fixed** |
| 3   | `CLAUDE.md`, "Rust Backend Modules" row Commands                            | commands are in `lib.rs`                                                                                   | `lib.rs` only registers; implementations are in `commands/*.rs` and the feature modules.                                                                                                                                                            | **Fixed** |
| 4   | `docs/architecture.md`                                                      | One diagram with frontend, Rust, PTYs, SQLite                                                              | No mention of the two sockets, the MCP runtime or the supervisor tier, the largest outside-facing surface. Now pointed to this folder.                                                                                                              | **Fixed** |
| 5   | `docs/architecture/system.scene.json` metrics and hud panel                 | 396 files in `src/app`, 175 Rust files, 46 wrapper files, 35 slices, 25 MCP tool files                     | Today: 439 non-test TS/TSX in `src/app`, 189 non-test Rust files, 50 wrapper files, 36 slices, 25 tool files. The scenes are five days old and already drifted.                                                                                     | **Fixed** |
| 6   | `docs/design-supervisor-link.md` / `docs/supervisor-control-api.md` example | `jobKinds[].instructions: "docs/agents/draw-scene.md"`                                                     | No such file in this repo. The task description for scene drawing exists only as a skill template outside the repo, so `scene.draw` cannot run here until a project adds one.                                                                       | Open      |
| 7   | Commit `f590ce9d` message                                                   | `scenes.projects/search/get/resolve/propose`, "Companion link", branch `auric/scene-proposal/*`            | Renamed since: `documents.*`, "Supervisor link", prefix `auric/proposal/` (fixture `proposalBranchPrefix`). Only history is stale; `supervisorLink.fixtures.json:184` keeps `scenes.get` as a negative test on purpose.                             | N/A       |
| 8   | `docs/design-supervisor-link.md` status line                                | "contract v1, revised 2026-10-17"                                                                          | Policy file is version 3 (`POLICY_VERSION`, `supervisor_link/policy.rs:36`) and the handshake advertises the feature `supervisorKeys`; the status line does not say so.                                                                             | Open      |
| 9   | `CLAUDE.md`, "Rust Backend Modules" (Agents row)                            | `agents.rs`, `agent_persistence.rs`                                                                        | `agent_persistence.rs` is the only one of the two still a file; `agents/persistence.rs` also exists, so two persistence files with similar names are in the tree.                                                                                   | **Fixed** |
| 10  | `src-tauri/resources/auric-mcp`                                             | Referenced in `tauri.conf.json` as bundle resource                                                         | Not in git; produced by `pnpm mcp:bundle`. A fresh clone cannot build the bundle without that step, and the docs for the MCP runtime do not say where it comes from.                                                                                | **Fixed** |
| 11  | `.husky/pre-commit` in a worktree                                           | Runs `pnpm lint-staged`, `knip`, `jscpd`                                                                   | Needs a working `node_modules`; in a git worktree it can fail with `ERR_PNPM_UNSAFE_MODULES_DIR`. Not a doc error, a tooling gap; the checks that apply to docs (prettier) can be run by hand.                                                      | Tooling   |
| 12  | `docs/spec/modules/fastmcp-server.md` vs. three MCP modes                   | "15 distinct tool domains", one stdio server, no mention of `--control` or `--supervisor` (grep: no hit)   | Three modes (`project`, `control`, `supervisor`) in `src/mcp/cli.ts`; the control and supervisor tool sets (`tools/agentControl.ts`, `tools/supervisor.ts`) are undocumented in the spec.                                                           | **Fixed** |

Not checked: the line-by-line truth of `docs/spec/**` and `docs/design-*.md` apart from
the Supervisor Link and control-socket contracts. The `doc-truth-audit` skill is the
right tool for that.
