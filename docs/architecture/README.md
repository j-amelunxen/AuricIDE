# AuricIDE architecture — modules and dependencies

Status: written 2026-10-23 against `main` at `10878a8f`, checked against the code, not
copied from older docs. Where a number is given it was counted that day.

This is the module-level companion to [`../architecture.md`](../architecture.md) (the
one-screen diagram) and to [`../../CLAUDE.md`](../../CLAUDE.md) (the working rules per
feature). It answers three questions: what are the modules, what depends on what, and
where can something from outside dock on. The last one has its own file:
[`interfaces.md`](interfaces.md).

The same content as 3D scenes, for a viewer that reads them through the Supervisor
Link:

| Scene                                                                  | What it shows                                                     |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`auricide-modules.scene.json`](auricide-modules.scene.json)           | The modules and their dependencies (this file, as a picture)      |
| [`auricide-interfaces.scene.json`](auricide-interfaces.scene.json)     | Every external docking point and what stands behind it            |
| [`auricide-runtime-flow.scene.json`](auricide-runtime-flow.scene.json) | How a client request becomes an agent, a branch and a merge       |
| [`system.scene.json`](system.scene.json) and eleven module scenes      | The older system view with drill-down (`detail`) into each module |

The three new scenes link into the older module scenes with `detail`, so a viewer can
drill from the overview into `agents`, `supervisor-link`, `mcp` and the rest.

## 1. Shape of the system

AuricIDE is a **Tauri v2 desktop app**. Three layers, one process tree:

```
Next.js 16 / React 19 (src/app, src/lib)  ──invoke()/events──▶  Rust backend (src-tauri/src)
        │  Zustand store (36 slices)                                  │
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
  (`CLAUDE.md`, "Goals, Tickets, and the Conductor Loop").
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

**UI shell** — `src/app/` (439 non-test TS/TSX files), `src/lib/editor`, `nlp`,
`terminal`, `explorer`, `work`, `ide`, `overlays`, `theme`.
Purpose: IDE shell, CodeMirror editor and viewers, explorer, terminals, agent console,
PM, git, canvas, settings. `src/app/page.tsx` splits into `useIDEState`,
`useIDEHandlers`, `useIDEActions`. Uses: store, IPC wrappers.

**State store** — `src/lib/store/` (36 `*Slice.ts`, composed in `store/index.ts`; the
`StoreState` intersection is the authoritative list). Exposed on `window.__AURIC_STORE__`
for tests and browser-mode QA. Uses: IPC wrappers. Used by: everything in the frontend.

**IPC wrappers** — `src/lib/tauri/` (50 non-test files), one lazy `invoke.ts` helper.
Purpose: the only place the frontend calls Rust (`invoke`) or listens to Rust events
(`subscribe.ts`). Uses: Tauri JS API. Used by: store, UI.

**Goals and conductor** — `src/lib/goals`, `src/lib/conductor`, `conductorSlice`,
`goalsSlice`, `requirementsSlice`. Purpose: goal trees, satisfaction rule, ticket
spawning loop, scheduled conductor runs. Uses: store, IPC (`pm_*`, `agents`), MCP
`auric-pm` indirectly through the agents it spawns.

**Agent fleet (frontend half)** — `src/lib/agents/` (liveness, attention, fleet split,
`controlBridge.ts`, `agentWindowHost.ts`, supervisor presets/managers), `agentSlice`.
Purpose: cards, console feed, parking, the attention model, and the frontend end of the
control socket (spawn and kill take the same store actions as the UI buttons).
Uses: IPC, store. Contract fixtures live next to it (`*.fixtures.json`).

### 2.2 Rust backend

**Command layer** — `lib.rs` (registers about 220 `#[tauri::command]` handlers in one
`generate_handler!`), `commands/` (fs, db, app, agent, inbox, terminal, watcher),
`database/` (SQLite schema, migrations, CRUD for epics, tickets, goals, requirements,
reviews, goal dependencies). Purpose: IPC dispatch and persistence of the work model.
Uses: nearly everything below. Not used by anything except Tauri.

**Agent runtime** — `agents/` (20 files: manager, PTY output buffer, awaiting-input
detection, write sandbox, launch dir, run results, MCP guard), `agent_persistence.rs`,
`agent_log.rs`, `agent_window.rs`, `providers/` (provider registry, `dynamic-providers/`
JSON), `provider_policy.rs`, `connectors/`. Purpose: spawn, stream, kill and persist
agent processes. Depends on: providers (35 references), supervisor (32), mcp (9),
notifications (8), agent_usage (7). It is the most connected module in the backend.

**Control socket** — `control_socket/` (14 files; `caller.rs` PID walk, `protocol.rs`,
`link_spawn.rs`, `pingback.rs`, `stall_watchdog.rs`). Purpose: NDJSON unix socket
`control.sock` plus the shared `Dispatcher` that both outside doors use. Depends on:
agents (17), supervisor (9), supervisor_link (5).

**Supervisor** — `supervisor/` (policy, runs, managers, memory, several, attachments)
and `src/lib/config/supervisorPolicy.ts` (twin). Purpose: the policy
(`supervisor-policy.json`), run folders under `~/.auric/supervisors/`, named managers
with `INSTRUCTIONS.md` and an OKF memory. Depends on: agents, connectors,
notifications, machine.

**Supervisor Link** — `supervisor_link/` (21 files: `protocol.rs`, `mod.rs` WebSocket
server, `documents.rs`, `assets.rs`, `jobs.rs` + `job_runner.rs`, `policy.rs`,
`proposals.rs`, `subscription.rs`, `subtree.rs`, `instructions.rs`, `glob.rs`).
Purpose: the Supervisor Control API, see `interfaces.md` section 3. Depends on:
supervisor, agents, control_socket (shares the dispatcher). `control_socket` also
reaches back into it (5 references), so the two form a cycle that is deliberate: one
dispatcher, two doors.

**MCP runtime** — `mcp.rs` (writes per-agent MCP config, starts/stops the server),
`src/mcp/` (FastMCP server, `cli.ts` mode switch, 25 tool files, about 90 tools),
bundled by `pnpm mcp:bundle` into `src-tauri/resources/auric-mcp/` (a build output,
not in git). Purpose: three server modes, see `interfaces.md` section 2.
Depends on: project DB (`better-sqlite3`), notifications DB, control socket client.

**Git** — `git/` (28 files, git2-rs: status, diff, stage, commit, push, blame, branches,
graph, merge, worktrees), `ignored_repos.rs`, `src/lib/git`. All git behaviour is in
Rust; `lib.rs` only registers it. Depends on: ignored_repos, video_import (2), agents (1).

**Notifications, schedules, inbox, missions** — `notifications/`, `schedules/`,
`inbox/`, `missions/`, `delivery/` (outbound push), `notifications.db`, `inbox.db`.
Purpose: cross-project event log, cron and one-shot schedules that survive restarts,
GTD inbox, markdown missions owned by a repo. Depends on: database, schedules ↔
notifications (mutual).

**Usage** — `cc_usage/` (what the CLIs consumed, from transcripts), `usage_limits/`
(quota window via a Claude `--settings` statusLine sidecar and the Codex CLI),
`agent_usage/` (cost of one run, booked into `pm_agent_usage`). Depends on: providers,
agents, webview_prefs.

**Imports and machine tools** — `video_import/` (transcription, frames), `machine/`
(declared table of `ffmpeg`, `ffprobe`, `go`, `okf`; absolute-path resolution through
the login shell), `excalidraw/` (Excalidraw+ REST, mock lane `AURIC_EXCALIDRAW_MOCK=1`),
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
- **`git` is nearly a leaf.** It uses `ignored_repos` and has two light references to
  `video_import` and `agents`.
- **Frontend direction is one-way**: UI → store → IPC wrappers → Rust. Rust never
  imports TypeScript; it reaches the frontend only through events and the control
  bridge (`control-request` / `control_respond`).

## 4. Twins and fixtures

A rule that exists in Rust and TypeScript is tested against one JSON file; **change the
fixture first**. From the code: `providerPolicy.fixtures.json`,
`goalDependencies.fixtures.json`, `supervisorPolicy.fixtures.json`,
`supervisorLink.fixtures.json`, `agentControl.fixtures.json`,
`agentWindow.fixtures.json`, `supervisorManagers.fixtures.json`,
`ignoredRepos.fixtures.json`, `awaitingInput.fixtures.json`, `gitGraph.fixtures.json`
(all under `src/lib/**`).

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
