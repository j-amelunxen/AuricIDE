# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **IMPORTANT:** Never invoke `pnpm test` (watch mode) — it will hang. Always use `pnpm test:run` for a single pass.

## TDD Workflow (mandatory)

1. **Write a failing test** for the new behavior
2. **Run the test** — confirm it fails for the right reason
3. **Implement** the minimum code to make it pass
4. **Refactor** while keeping tests green
5. **Never skip tests** — every feature needs unit coverage

## Key Commands

```bash
pnpm dev              # Next.js dev server (Turbopack)
pnpm test:run         # Vitest single run (use this, not pnpm test)
pnpm test:e2e         # Playwright E2E
pnpm lint             # ESLint
pnpm format:check     # Prettier check
pnpm tauri:dev        # Full desktop app (Rust + Next.js)
pnpm build:production # Build the .app and install it to /Applications
pnpm tauri:test       # Rust unit tests
pnpm tauri:clippy     # Rust linter
pnpm check:all        # Everything at once
```

### The installed app vs. the dev build

`pnpm build:production` (`scripts/build-production.sh`) produces the real macOS
bundle and puts it in `/Applications`, so the IDE can live in the Dock instead
of only starting through `pnpm tauri:dev`. Pass `--no-install` to keep the
bundle in `src-tauri/target/release`, `--dmg` for a disk image, `--open` to
launch it afterwards.

Both builds are meant to be the same install, and that takes two things:

- **Backend state already agrees.** Every store resolves from
  `app_data_dir()`, which Tauri derives from the `identifier` in
  `tauri.conf.json` — one string, both builds, so both land in
  `~/Library/Application Support/com.auricide.ide`. The build script checks the
  bundle it just produced really carries that identifier; a mismatch there is
  what makes an app open looking like a fresh install.
- **`localStorage` does not, so it is mirrored.** WebKit scopes it by data
  store (`~/Library/WebKit/auric-ide` for the bare dev binary,
  `~/Library/WebKit/<identifier>` for the bundle) and by page origin
  (`http://localhost:41873` vs `tauri://localhost`). Neither is ours to align,
  so `webview_prefs` (Rust) and `sharedPrefs.ts` (frontend) keep the values in
  `webview-prefs.json` next to the other stores. `SharedPrefsGate` reconciles
  before the first render, because the theme, the agent spawn defaults and the
  skill sources are all read synchronously as their panels mount.

The file is the source of truth once an origin has been seeded, absences
included — otherwise a preference cleared in one build would be handed back by
the other. The very first run seeds it from whichever webview store was written
to most recently, so which build the user happens to open first does not decide
whose settings survive.

### Running a Single Test

```bash
# Run one file
pnpm test:run src/lib/store/pmSlice.test.ts

# Run tests matching a name pattern
pnpm test:run --reporter=verbose -t "epic"
```

## Code Style

- **TypeScript:** strict mode, single quotes, trailing commas (es5), 100 char width
- **Rust:** edition 2021, 100 char width, 4-space indent
- **Components:** functional components, `'use client'` only when needed
- **Tauri IPC:** mock `@tauri-apps/api/core` in tests, try/catch fallback for browser mode

## Project Structure

- `src/app/` — Next.js App Router pages and components
- `src/lib/` — Shared logic (editor extensions, store slices, NLP, IPC wrappers)
- `src/mcp/` — MCP server (FastMCP, tool implementations per domain)
- `src-tauri/src/` — Rust backend (commands in lib.rs)
- `e2e/` — Playwright E2E tests
- Tests live next to source files (`*.test.tsx`)

## Before Committing

Run `pnpm check:all`. It is an 11-step chain and four of the steps are gates people
forget they can fail on their own: `automation-surface:check` (regenerates
`docs/automation-surface.md` and diffs it), `knip` (unused exports/deps), `jscpd`
(copy-paste detection) and `tauri:machete` (unused Rust deps) — alongside
`tauri:versions:check`, lint, format, TS tests, cargo test, clippy and rustfmt.

---

## Architecture Overview

AuricIDE is a **Tauri v2 desktop app**: a Next.js 16 frontend communicates with a Rust backend over Tauri's IPC command system. Think of it as three layers:

```
Next.js (React/TypeScript)  →  Tauri IPC invoke()  →  Rust backend
src/app/ + src/lib/             src/lib/tauri/*.ts      src-tauri/src/
```

## Configuration: application vs. project

Two layers, and the question that decides which one a setting belongs to: **would
it still be right if you opened a different repository?**

| Layer                    | What lives there                                                                                | Where it is stored                                                          | API                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Application**          | Theme, editor toggles, remembered launch choices, custom commands, MCP auto-start               | `localStorage`, mirrored to `<app_data_dir>/webview-prefs.json` (see above) | `src/lib/config/appConfig.ts`                                     |
| **Application (secret)** | API keys and endpoints for LLM, Judge, Excalidraw+, video transcription                         | `<app_data_dir>/app-credentials.json`, written by Rust at mode 0600         | `src/lib/tauri/appCredentials.ts` ↔ `src-tauri/src/app_config.rs` |
| **Project**              | Provider policy, commit conventions, ticket pattern, conductor provider, credential _overrides_ | `kv_store` in `<project>/.auric/project.db`                                 | `src/lib/config/projectConfig.ts`                                 |

Credentials are global with a per-project override. One rule decides which wins,
and it lives in `app_config::resolve_credential`: the project value wins when it
carries something, the global one otherwise. A **blank** project value is not an
override — clearing a field means "use the application value again", never "this
project deliberately has no key". `CredentialOverride.tsx` therefore stores
nothing for a cleared field and deletes the row instead.

Projects from before the split migrate once, on open
(`src/lib/config/migrateCredentials.ts`): field by field, a project value moves
up only where the application store has nothing, and otherwise stays put as an
override. The marker `project_config/credentialsMigratedV1` keeps it to one run —
but only after a clean pass, so a failed write is retried rather than stranded.

**Not persisted, deliberately:** `dangerouslyIgnorePermissions` and
`autoAcceptEdits`. A switch that lets an agent edit and run without asking,
restored days later, is one nobody remembers leaving on. Both start off every
launch and reset again when a project is opened.

### The provider policy

Which agent CLIs a project permits: `{ allow: string[] | null, deny: string[] }`.
`allow === null` (or empty) means no allow list is in effect; `deny` always wins.
An allow list that empties out is an absent one, never a total lockout — denying
everything stays possible, but only by saying so on the deny list.

It has **two implementations on purpose**: `src/lib/config/providerPolicy.ts`
decides what the dialogs offer, `src-tauri/src/provider_policy.rs` decides what
actually spawns. Both are tested against the same
`src/lib/config/providerPolicy.fixtures.json` (Rust reads it via `include_str!`),
because a disagreement between them is the failure that matters: a provider
hidden from every picker would still run, or a permitted one would be refused
with no way to see why. **Change the fixtures first**, then both sides.

The enforcement point is `agents::resolve_permitted_provider`, called from
`spawn_agent_impl` — the one path every agent takes, conductor, retry, resumed
run and notification action included. It checks the **resolved** provider id,
not the requested one: an unknown name falls back to the registry default, so
checking the request would let a deny list be dodged by naming a provider that
does not exist.

## State Management (Zustand)

All frontend state lives in a single combined Zustand store (`src/lib/store/index.ts`), composed of slices using `StateCreator`. The `StoreState` intersection in that file is the authoritative list — read it rather than trusting a count copied into prose:

```typescript
// Each slice follows this pattern:
export const createPmSlice: StateCreator<PmSlice> = (set, get) => ({ ... });

// Combined in index.ts:
export type StoreState = FileTreeSlice & TabsSlice & GitSlice & PmSlice & ...;
```

Key store slices:

| Slice                                                                                   | Key Concern                                                                           |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pmSlice`                                                                               | Epics, tickets, test cases, dependencies; draft/persisted split with a `pmDirty` flag |
| `agentSlice`                                                                            | Running AI agents, per-agent logs, fleet view state (see below)                       |
| `gitSlice`                                                                              | Branch, file statuses (A/M/D), staging, commit                                        |
| `fileTreeSlice`, `projectDbSlice`                                                       | Explorer tree; project SQLite init/close lifecycle                                    |
| `tabsSlice`                                                                             | Open editor tabs and active tab                                                       |
| `qaSlice`                                                                               | Test-coverage summary, per-file coverage, heatmap config                              |
| `mcpSlice`                                                                              | MCP server running state and PID                                                      |
| `canvasSlice`                                                                           | XYFlow nodes/edges for workflow canvas                                                |
| `uiSlice`                                                                               | Modal open/closed states, panel visibility                                            |
| `diagnosticsSlice`                                                                      | remark-lint errors keyed by file path                                                 |
| `goalsSlice`                                                                            | Goal hierarchy trees, satisfaction predicates, step states                            |
| `requirementsSlice`                                                                     | Application invariants, test links, freshness checks                                  |
| `conductorSlice`                                                                        | Conductor run status, judge backend evaluation loops                                  |
| `recentProjectsSlice`, `starredProjectsSlice`                                           | Multi-project history, pinned shortcuts                                               |
| `wikiLinkSlice`, `headingIndexSlice`, `entityIndexSlice`                                | WikiLinks graph, document headings, NLP entity index                                  |
| `blueprintsSlice`, `obsidianCanvasSlice`, `excalidrawSlice`                             | Canvas blueprints, Obsidian canvas view, Excalidraw scenes                            |
| `slashCommandSlice`, `commandUsageSlice`, `scratchSlice`                                | Slash commands, usage telemetry, scratchpad                                           |
| `toastSlice`, `notificationsSlice`, `schedulesSlice`, `skillComboSlice`, `overlaySlice` | System toasts, notification bus, recurring schedules, skill combos, overlay stack     |

**PM draft pattern:** `pmDraftEpics` holds in-progress edits; `pmEpics` is the last-persisted snapshot. `savePmData()` flushes drafts to SQLite via IPC.

## Goals, Tickets, and the Conductor Loop

Goals lead; epics are storage. The primary workflow of the app is one loop:

1. **Define a goal** — a desired world state with machine-checkable `successCriteria` (`pm_goals`, tree via `parentId`).
2. **Attach work** — link tickets to the goal (`ticket.goalId`, set atomically via `create_ticket`'s `goalId` param or `link_ticket_to_goal`), link requirements as acceptance gates, or launch a planning agent that calls `decompose_goal` / `create_ticket` itself.
3. **Run the conductor** (`conductorSlice`) — it spawns agents for unblocked open tickets in the goal's subtree (priority order, dependency-aware, `needsHumanSupervision` approval gate, 2 attempts per ticket).
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

Tickets still belong to an epic (`epicId`, required) — that is the organizational/backlog view. The goal link (`goalId`, optional) is the outcome view and drives satisfaction. `getGoalWorkflowStage` (goalsSlice) derives which loop stage a goal is in and powers the onboarding stepper in `GoalDetailPanel` plus the workflow strip in `GoalsModal`.

## Managing the Agent Fleet

Several agents run at once, so the panel's job is to make a fleet readable
rather than to show every agent at full size. Three shapes, one source of truth
(`splitFleet` in `src/lib/agents/fleet.ts`):

| Shape       | Who gets it                         | Why                                   |
| ----------- | ----------------------------------- | ------------------------------------- |
| Card        | `running` / `queued`, not parked    | Work in progress is what you watch    |
| Compact row | Parked agents (`minimizedAgentIds`) | Still running, deliberately set aside |
| Compact row | `idle` / `error`                    | Kept for review, but claims no space  |

Rules that hold across all of it:

- **Parking is a view state.** A parked agent keeps running and streaming; it
  still counts as running in the header and still belongs to its repo for
  Kill All. Nothing about the process changes.
- **Counts never lie about what is hidden.** Folding a repo group, parking an
  agent or collapsing finished ones must not change any number the panel
  states, nor what a destructive action would actually hit.
- **Dismiss ≠ kill.** `dismissFinishedAgent` only clears stopped agents from
  the list; it refuses running ones and touches no ticket or goal bookkeeping.
  `killRunningAgent` is the one with side effects.
- **Ending work asks first.** Both single kills and Kill All confirm while an
  agent is still running; already-stopped agents are cleared without a prompt.
- **Marker colours never touch the status slot.** Status owns amber, emerald,
  red and the accent; a user's marker (right-click → colour) lives on the left
  edge of the card or row. Painting a marker where status is read would quietly
  change what the card claims.

### The attention model — the system says when it needs you

The panel's core job is cutting the oversight tax: the human must never have
to poll cards to find out whether they are needed. One definition of "needs a
human" lives in `attention.ts` (`agentAttention`: `error` > `needs-input` >
`stalled`), and everything else derives from it:

- **Header badge + attention section.** "N need attention" counts the whole
  fleet — parked agents and folded groups included. The section at the top
  lists exactly those agents as pointer rows; cards never move. A folded
  repo group carries an amber dot when it hides a flagged agent.
- **Needs input beats liveness.** Permission menus redraw themselves, keeping
  `lastActivityAt` fresh — `awaitingInput` (derived in the store from prompt
  shapes in the output tail, `awaitingInput.ts`) must be checked before any
  live/waiting logic, or a blocked agent reads as Working forever.
- **Stalled is an escalation, not a state of alarm.** Waiting is normal;
  silence past `AGENT_STALL_MS` (far wider than the live window) turns the
  chip to "Stalled?" — question mark on purpose — and offers a one-click
  Enter nudge.
- **All-quiet is explicit.** "✓ all quiet" appears only while agents run and
  none needs a human. Absence of alarms is not permission to look away; a
  monitored silence says so. The window title mirrors the count ("(2)
  AuricIDE") so the answer is readable from the dock.
- **Failures interrupt once; successes never do.** running→error raises one
  toast. Clean finishes are represented by the unseen marker and the
  all-quiet signal — a toast per success trains the user to dismiss unread.
- **Review is bookkept, not remembered.** `finishedAt` orders the Done list
  newest-outcome-first; stopped agents stay marked unseen until their logs
  are opened (opening a _running_ agent does not count); bulk Clear spares
  unreviewed failures. Failed rows and the failed agent's terminal lead with
  the last error line (`errorDigest.ts`), and Retry relaunches with the
  verbatim stored config (`agentSpawnConfigs`).
- **Decisions default.** The spawn dialog remembers provider, model,
  permission mode and headless from the last launch, validated against the
  provider's current offering.

Supporting modules in `src/lib/agents/`:

- `liveness.ts` — one definition of "live". The window must stay wider than
  `AGENT_ACTIVITY_BUMP_MS` plus the 1s UI tick, or badges flicker.
- `activity.ts` — distils "what is it doing now" from the newest output.
  Derived inside the store's throttled activity bump, never per chunk.
- `naming.ts` — derives a name from the start instruction and disambiguates
  collisions, so a fleet is not a column of identical labels.
- `duration.ts` — compact ages that count in seconds below a minute.
- `colors.ts` — the marker palette. Explicit hex, not theme tokens: "the red
  one" must stay red whatever accent the user picked.

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

- **Store:** `src/lib/store/requirementsSlice.ts` — same draft pattern as PM (draft + persisted + dirty flag); includes test link drafts and selector helpers (`getStaleRequirements`, `getUnverifiedRequirements`, `getTestLinksForRequirement`)
- **IPC:** `src/lib/tauri/requirements.ts` — `requirementsLoad`, `requirementsSave`, `requirementsClear`; `RequirementsState` includes `testLinks: PmRequirementTestLink[]`
- **MCP:** `src/mcp/tools/requirements.ts` — 10 tools, supports `resolveRequirementId` (UUID, prefix, or reqId like `REQ-AUTH-01`)
- **UI:** `src/app/components/requirements/` — Modal with FilterPanel (includes verification freshness filter), List (verification indicator), DetailPanel (verify button, appliesTo chips, linked tests), CreateDialog (appliesTo input)

## Tauri IPC Pattern

All IPC wrappers live in `src/lib/tauri/*.ts`. They share one helper —
`src/lib/tauri/invoke.ts` — rather than each repeating the dynamic import:

```typescript
import { invoke } from './invoke';

export async function requirementsLoad(projectPath: string): Promise<RequirementsState> {
  return await invoke<RequirementsState>('requirements_load', { projectPath });
}
```

The import stays lazy so browser and test environments don't break on load, and
`resolveTauriInvoke` does two things a hand-rolled copy misses: it unwraps
`mod.invoke ?? mod.default?.invoke` (bundlers disagree on the shape), and it
throws `Tauri IPC is unavailable (<cmd>)` instead of calling `undefined(...)`.
Import the helper; don't re-implement it.

Rust commands are registered in `src-tauri/src/lib.rs` with `#[tauri::command]` and wired up in `.invoke_handler(tauri::generate_handler![...])`.

**In tests**, mock the IPC layer:

```typescript
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => mockData) }));
```

## CodeMirror Editor

`src/lib/editor/setup.ts` assembles the editor state. Each feature is a separate extension:

- `auricTheme` / `auricHighlightStyle` – theme styling and Markdown token colours
- `nlpHighlightExtension` – synchronous marking of **actionable** spans: entities,
  keywords and prompt-framework labels. It never colours word classes; POS
  highlighting was deliberately removed. See `docs/semantic-markdown-highlighting.md`.
- `deepHighlightExtension` – async Transformers.js NER plus paragraph intent
  classification (`src/lib/nlp/`, not `src/lib/editor/`)
- `mermaidWidgetExtension` – inline Mermaid diagram rendering
- `wikiLink broken/hover/completion extensions` – `[[WikiLink]]` completion, hover popups, and broken link markers
- `markdownFoldExtension` – heading-based section folding
- `createGitGutter` – per-line git status in gutter
- `markdownLintExtension` / `jsonLintExtension` / `xmlLintExtension` / `yamlLintExtension` – real-time diagnostics
- `renameHeadingExtension` / `findReferencesExtension` – markdown refactoring actions

Dynamic reconfigurations use CodeMirror `Compartment`s so the editor doesn't need to be recreated.

## MCP Server

`src/mcp/server.ts` is a FastMCP server that exposes 15 tool domains with 40+ tools (epics, tickets, tasks, dependencies, testcases, history, blueprints, context, canvas, requirements, goals, stations, knowledge, reviews, notifications). It runs as a subprocess started by Rust (`src-tauri/src/mcp.rs`) and communicates via stdio JSON-RPC. To run it standalone:

```bash
npx tsx src/mcp/server.ts /path/to/project.db
```

Tool implementations are in `src/mcp/tools/` — one file per domain. Environment variables `AURIC_NOTIFICATIONS_DB` and `AURIC_PROJECT_ROOT` configure notifications and knowledge/canvas tools.

## Main Page Structure

`src/app/page.tsx` (the main page) splits concerns into three hooks:

- `useIDEState()` – derives all state from the store
- `useIDEHandlers()` – event handlers and computed props
- `useIDEActions()` – side-effect setup (file watcher, Tauri event listeners)

The active tab type determines which viewer renders: `MarkdownEditor` (CodeMirror), `CanvasView` (XYFlow), `MindmapView`, `DiffViewer`, `ImageViewer`, `VideoViewer`, `PDFViewer`, `HtmlViewer`, `ObsidianCanvasView`, `ExcalidrawViewer`, or `WorkView`.

## Rust Backend Modules

| Module                    | File                                                                        | Responsibility                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commands                  | `lib.rs`                                                                    | IPC command registration, PTY shell (`shell_spawn/write/resize`), file watcher                                                                                          |
| Agents                    | `agents.rs`, `agent_persistence.rs`                                         | Spawn/kill AI agent processes, stream PTY output, persist run history                                                                                                   |
| Crashlog                  | `crashlog.rs`                                                               | Rust panic hook & frontend crash log reporting                                                                                                                          |
| CLI usage (historical)    | `cc_usage/` (`mod.rs`, `manifest.rs`, `scan.rs`, `pricing.rs`, `report.rs`) | What the agent CLIs consumed over 24 h–30 d, read from their transcripts. Plugin-driven (`usage-plugins/*.json`); twin of `usage_limits` (see below)                    |
| Database                  | `database.rs`                                                               | SQLite schema, PM CRUD (epics, tickets, test cases, goals, requirements, reviews)                                                                                       |
| Excalidraw                | `excalidraw/` (`mod.rs`, `contract.rs`)                                     | Excalidraw integration REST API & scene listing                                                                                                                         |
| Git                       | `git.rs`                                                                    | **All git behaviour** (git2-rs): status, diff, stage/unstage, commit, push, discard, blame, branches, history. `lib.rs` only registers the commands; the logic is here. |
| Machine credentials       | `app_config.rs`                                                             | Machine-wide settings (API keys) that outlive any one project; a project may still override                                                                             |
| Provider policy           | `provider_policy.rs`                                                        | Which agentic providers a project permits. Twin of `src/lib/config/providerPolicy.ts`; both tested against `providerPolicy.fixtures.json`                               |
| LLM & Providers           | `llm.rs`, `providers.rs`                                                    | HTTP calls to LLM APIs, agent CLI provider registry (`RESERVED_PROVIDER_ID` = the built-in `crush`)                                                                     |
| MCP                       | `mcp.rs`                                                                    | Start/stop FastMCP server subprocess (`AURIC_NOTIFICATIONS_DB`, `AURIC_PROJECT_ROOT`)                                                                                   |
| Memory Report             | `memory_report.rs`                                                          | System & process tree memory monitoring for performance metrics                                                                                                         |
| Menu                      | `menu.rs`                                                                   | Native macOS application menu state management                                                                                                                          |
| Notifications & Schedules | `notifications.rs`, `schedules.rs`                                          | Cross-project notification bus, cron & one-shot schedule execution engine                                                                                               |
| Configuration             | `app_config.rs`, `provider_policy.rs`                                       | Application-wide credentials (`app-credentials.json`, mode 0600) and the per-project agent-provider allow/deny list enforced at spawn                                   |
| Project Discovery         | `project_icons.rs`, `project_skills.rs`, `recent_projects.rs`               | Workspace icons ranking, skills discovery, recent & starred projects management                                                                                         |
| Recent creations          | `recent_creations.rs`                                                       | Newest file birth time per directory, maintained from watcher events so `read_directory` dates folders without walking their subtree (see below)                        |
| Themes                    | `themes.rs`                                                                 | Custom theme JSON scanner and theme list API                                                                                                                            |
| Utilities                 | `utf8_stream.rs`, `webview_prefs.rs`                                        | UTF-8 PTY chunk reassembly, cross-origin webview preferences sync                                                                                                       |
| Video import              | `video_import/` (`mod.rs`, `preflight.rs`, `failure.rs`)                    | Transcription and frame extraction; the dependency preflight and the rule that tool output never becomes an error message (see below)                                   |

## Two usage features, two different questions

`usage_limits` and `cc_usage` sit next to each other and are easy to confuse.
They are not two views of one number:

|          | `usage_limits`                              | `cc_usage`                               |
| -------- | ------------------------------------------- | ---------------------------------------- |
| Question | How full is the quota window **right now**? | What did the last 24 h–30 d **consume**? |
| Source   | The CLI's own status line / `codex` CLI     | The CLIs' transcripts on disk            |
| Shape    | A percentage and a reset time               | Tokens, turns, sessions and a cost       |
| Surface  | The status-bar chip                         | The report panel beside it               |

Neither can be derived from the other: a percentage does not say how many
tokens produced it, and a token total does not say how much of an allowance is
left. They also fail independently — quota needs an interactive agent to have
run recently, the report needs only files that are already there.

### The plugin seam

What a usage source _is_ — where its records live and what its tokens cost —
is declared in `usage-plugins/*.json` and read by `manifest.rs`, using the same
five-directory scan as `dynamic-providers/`. Only the reader for the
`claude-jsonl` shape is compiled in. `usage-plugins/README.md` is the schema;
the two things worth knowing here:

- **`claude-code` ships compiled in**, unlike the provider registry where
  users bring their own — a price list nobody wrote is a feature that reports
  nothing. `usage-plugins/*.json` is git-ignored exactly like
  `dynamic-providers/*.json`, so the compiled-in default lives in
  `src-tauri/src/cc_usage/default-manifest.json`: reading it out of an ignored
  directory would make a fresh clone fail to build.
- **Rates are dated.** Each record is priced by the day it happened, so an
  introductory price ending mid-window does not silently rewrite history.

### How the panel reads

Two design rules, both about honesty rather than looks:

- **Every figure is reported against the period before it.** A bare total
  answers "how much" and leaves "compared to what?" unanswered. This is why
  the scan reaches back _twice_ the widest window. Where the transcripts do
  not span the whole earlier period the comparison is withheld
  (`previous: None`) rather than shown as a quiet one — on a real corpus the
  30-day window hits this, and rendering absent as idle would have reported a
  large increase that is only missing data. The coverage test is against the
  oldest turn found, never against the scan range, which is always wide enough
  by construction and would make the check tautological.
- **Each breakdown row carries its own series on one shared scale**
  (`NamedAggregate.series`, aligned index-for-index with the window's
  `buckets`). That makes the breakdown small multiples rather than a ranked
  list: a spike in one row is directly comparable to a spike in another, and a
  quiet row renders quiet. Per-row scaling would stretch a $3 model to the
  same height as a $500 one and invert the finding. Only the drawn rows keep
  a series — several hundred projects times thirty buckets is a lot of JSON
  for bars nobody renders.

### Three rules the numbers depend on

- **A turn is counted once.** The same API call lands in more than one
  transcript when a session is resumed or forked — on a real corpus over half
  of what is read is a duplicate, so counting turns as they are read would
  roughly double every figure. The key is `message.id` + `requestId`; either
  alone would collapse turns that really did both happen.
- **An unpriced model keeps its tokens.** A model missing from the price list
  contributes tokens, contributes no cost, and is named on `unpricedModels`. A
  total that is missing money has to say so rather than look complete.
- **Cost is a list-price equivalent, never a bill.** A transcript records
  tokens, not what the account was charged, so the only rate it can be priced
  at is the published one. On a subscription the real charge is the
  subscription, and the panel says that where the figure is, not in a footnote.

Reading is on demand, cached for 60 seconds, and skips files by modification
time — a file untouched since before the oldest window cannot hold a record
inside it. That last one is the only reason a 30-day report does not read
30 months of transcripts, and it is also the deliberate imprecision: a
transcript whose mtime was rewritten backwards is invisible past a day of
slack. `cargo test cc_usage -- --ignored --nocapture` runs the scanner against
the real machine, which is the only place the transcript format is checked
against what it actually is rather than against our idea of it.

## Depending on tools that come from the machine

Local transcription is a Python tool (`parakeet-mlx`) driven by `uv`, and video
import shells out to `ffmpeg`/`ffprobe`. None of that is ours, and none of it is
pinned — pinning a runtime means owning its upgrades. The cost of not pinning is
that the machine can be wrong, so three rules carry the weight instead:

- **Check before you run.** `preflight::inspect` probes platform, `uv` (with a
  minimum version), a Python ≥3.10, `ffmpeg`, `ffprobe` and the runtime itself,
  and reports each as its own line: requirement, what was found, and the one
  command that fixes it. A machine that cannot run local transcription says so
  in a sentence, before anything is downloaded. Installing is offered only when
  the _sole_ failing check is the runtime — that is what `can_install` means.
- **Tool output never becomes the message.** `failure::describe_failure`
  classifies stdout+stderr into one plain sentence; the output itself is
  stripped of ANSI and box drawing, tail-trimmed, and returned as `details` for
  a fold, with the full text written to a log file. The frontend twin is
  `toolFailure.ts`, which demotes anything traceback-shaped that reaches it by
  another route. A forty-line Python traceback in a `<p role="alert">` is the
  failure mode both sides exist to prevent.
- **Resolve executables, never trust PATH.** Everything is spawned by absolute
  path via `preflight::resolve_executable`, which walks the _login shell's_
  PATH. An app launched from `/Applications` inherits launchd's PATH, which has
  no Homebrew in it. The runtime we install is found at
  `<app_data_dir>/runtime/bin` rather than by name, because `uv tool install`
  exits 0 while only _warning_ that its bin directory is off PATH — a
  PATH-based check reports a perfectly good install as missing.

The tool environment, its executable and the model cache all live under
`<app_data_dir>/runtime/` (`UV_TOOL_DIR`, `UV_TOOL_BIN_DIR`,
`PARAKEET_CACHE_DIR`). Sharing `~/.local/share/uv/tools` with the rest of the
machine means anything else touching it can break a transcription mid-run, and
the way that surfaces is a `ModuleNotFoundError`.

`preflight.rs` has an `#[ignore]`d test, `inspects_this_machine`, that runs the
real probes against the real machine — the only place the probe logic is checked
where it actually acts.

## Dating folders without walking them

The explorer marks a file created in the last five minutes, and marks any folder
that holds one anywhere beneath it. Answering that from the filesystem means
walking a folder's whole subtree on every directory read — on this repo that was
thousands of `stat` calls per watcher event, on the main thread.

`recent_creations.rs` maintains the answer instead of recomputing it. Opening a
project seeds one map of "newest descendant-file birth time" per directory;
after that every watcher event stamps the file's birth time onto each ancestor
directory. A read costs one lookup per child.

Three things hold this together, and breaking any of them makes a folder's date
depend on who answered:

- **Both walks prune identically.** `walk_files_with_birth_time` (seeding) and
  `newest_file_created_at_by_child` (fallback) share `skip_recent_walk_dir` and
  `should_filter_watcher_path`. `the_cache_dates_folders_exactly_as_the_walk_would`
  asserts the two produce the same listing.
- **A root counts as seeded only once its contents are in.** `seed_root` marks
  and fills in one step. Marking first would let a read land mid-walk and
  conclude a folder holds nothing recent — wrong, and nothing would correct it.
  Until seeding lands, `newest_by_child` returns `None` and the caller walks.
- **The five-minute window is not in Rust.** The backend reports a timestamp;
  `src/lib/explorer/recentlyCreated.ts` owns what counts as recent. One
  definition, so the two sides cannot drift.

The deliberate imprecision: a cached timestamp only moves forward. Delete the
one young file in a folder and it keeps glowing for the rest of the window.
That is the price of not walking, and it was taken knowingly.

`read_directory` is `#[tauri::command(async)]` for the same reason — a plain
`fn` command runs on the main thread, and the fallback walk still happens for
any directory outside a seeded root.
