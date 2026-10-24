# AuricIDE external interfaces — where something can dock on

Status: written 2026-10-23 against `main` at `10878a8f`, verified in code. Companion to
[`README.md`](README.md) (modules) and the scene
[`auricide-interfaces.scene.json`](auricide-interfaces.scene.json).

Stability words used below, taken from what the code and docs promise, not from taste:

- **contract** — a fixture file or a versioned protocol pins it; change the fixture first.
- **internal** — shared between our own two halves; may change with the app.
- **convention** — documented, but nothing enforces it.

## 0. Overview

| #   | Kind                    | Door                                                             | Who uses it                               | Direction     | Stability                      |
| --- | ----------------------- | ---------------------------------------------------------------- | ----------------------------------------- | ------------- | ------------------------------ |
| 1   | Tauri IPC               | `invoke` commands, events                                        | our own webviews (`main`, `agent-window`) | both          | internal                       |
| 2   | MCP                     | `auric-mcp` in three modes (`project`, `control`, `supervisor`)  | agent CLIs, outside MCP hosts             | client → IDE  | contract (control, supervisor) |
| 3   | Supervisor Link         | WebSocket over `supervisor-link.sock`, path `/v1`                | a local companion app (its backend)       | client ↔ IDE  | contract, protocol 1           |
| 4   | Control socket          | NDJSON over `control.sock`                                       | `auric-mcp --control`, supervisor MCP     | client → IDE  | contract                       |
| 5   | Agent CLIs / providers  | PTY child processes, JSON provider configs, per-agent MCP config | Claude Code, Codex, Gemini CLI, Crush, …  | IDE → CLI     | convention (CLIs change)       |
| 6   | File contracts          | `.auric/`, app-data JSON, `.commit-guard.json`, scene files      | humans, scripts, clients through the link | both          | mixed                          |
| 7   | Native menu automation  | macOS menu items, generated list                                 | `axbridge`, UI automation                 | client → IDE  | generated                      |
| 8   | Hooks and sidecars      | Claude `--settings` statusLine, husky, MCP guard                 | Claude Code, git                          | CLI → IDE     | internal                       |
| 9   | Environment variables   | `AURIC_*`                                                        | agents, MCP servers, probes               | IDE → child   | mixed                          |
| 10  | Outbound HTTP and tools | LLM APIs, Excalidraw+, push delivery; `ffmpeg`, `uv`, `okf`      | IDE                                       | IDE → outside | third party                    |

The three ways in for a program **outside** the IDE are 2 (`--control` mode), 3 and 4.
They differ in power: the control socket can spawn any worker agent in any project the
policy allows; the link is narrower (supervisor tree only, plus documents and jobs).
The last section compares link and MCP.

## 1. Tauri IPC (frontend ↔ Rust)

- **Direction:** webview calls Rust with `invoke(cmd, args)`; Rust pushes events.
- **Defined in:** `src-tauri/src/lib.rs:318` (one `generate_handler![…]`, about 220
  commands; 225 `#[tauri::command]` attributes exist in the tree, a few are helpers or
  test-only). Implementations: `commands/` (fs 17, db 26, app 42, agent 13, inbox 11,
  terminal 3, watcher 2), `git/commands.rs` (44), `recent_projects/commands.rs` (9),
  `supervisor/` (15 incl. managers), `supervisor_link/` (6), `video_import/` (5),
  `webview_prefs.rs`, `app_config.rs`, `agent_window.rs`, `usage_limits/`, `cc_usage/`,
  `agent_usage/`, `ui_watchdog.rs`, `clipboard.rs`, `machine/`, `menu_bar.rs`.
- **Frontend side:** wrappers in `src/lib/tauri/*.ts` over one helper, `invoke.ts`
  (lazy import, throws `Tauri IPC is unavailable (<cmd>)` instead of calling undefined).
- **Who may call:** capability files `src-tauri/capabilities/default.json` (window
  `main`) and `agent-window.json`. Permissions: `core:default`, dialog, notification,
  `opener:allow-reveal-item-in-dir`, `opener:allow-open-path` only under
  `$HOME/.auric/supervisors/**`, `opener:allow-open-url` for `https://*`. There is no
  network listener for IPC; a browser cannot reach it.
- **Events from Rust** (names found in code): `file-events`, `terminal-out-{id}`,
  `terminal-err-{id}`, `agent-output` (carries `endOffset`), `agent-pty-resized`,
  `agent-window-state`, `agent-window:hello` (from the agent window), `menu:command`,
  `menu:close-tab`, `ui-ping`, `notifications-changed`, `usage-limits-changed`,
  `supervisor-children-adopted`, `menu-bar-launch`, `video-import-setup-progress`,
  `control-request` and `agent-input-sent` (control bridge, fixture
  `agentControl.fixtures.json` → `events`).
- **Stability:** internal. Rules that must hold across the seam are in `CLAUDE.md`
  (agent window: one writer per field, offsets; webview prefs mirror).

## 2. MCP servers — `auric-mcp`

One packaged Node runtime, `src-tauri/resources/auric-mcp/` (build output of
`pnpm mcp:bundle`, not in git; `tauri.conf.json` bundles it as `auric-mcp`). Source
`src/mcp/` (FastMCP, `zod`, `better-sqlite3`). The mode is picked by
`src/mcp/cli.ts: resolveMcpCliMode`.

| Mode (server name)                  | Started by                                                                                                         | Tools                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Caller rule                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--project-root <dir>` (`auric-pm`) | the IDE, for every agent it spawns with a binding (`mcp.rs: write_agent_mcp_configs`, Claude/Codex/Crush variants) | about 75 tools in 22 domains (counted by registration, not exact): epics, tickets, tasks, dependencies, test cases, history, blueprints, context, canvas, requirements (10), goals (incl. `decompose_goal`, `evaluate_goal`), goal launch, stations (`mark_station_done`, `request_human_check`), knowledge, reviews, agent usage, and — only when `AURIC_NOTIFICATIONS_DB` is set — `notify`, `notify_ask`, `schedule_*`, `request_agent_launch`, `list_agent_providers`, `get_agent_run` | Bound to one project by `realpath`; DB derived from the root, never passed separately. Blank-project and escaping DB paths are refused.                                                            |
| `--control` (`auric-control`)       | an outside MCP host (another Claude Code session, a script)                                                        | `list_projects`, `list_agents`, `spawn_agent`, `read_agent_output`, `send_agent_input`, `kill_agent`, `await_agent_result`, `remove_worktree`, `dismiss_agent` (`tools/agentControl.ts`); talks to `control.sock`                                                                                                                                                                                                                                                                          | Refuses to start when `AURIC_IDE_AGENT` or `AURIC_AGENT_CWD` is set (typing into a console could answer another agent's permission prompt). The socket checks the caller's process ancestry again. |
| `--supervisor` (`auric-supervisor`) | the IDE, inside a supervisor agent only                                                                            | scoped copies of the above (`list_my_agents`, `read_agent_output`, `await_agent_result`, `send_agent_input`, `kill_agent`, `remove_worktree`, `dismiss_agent`, `list_projects`, `spawn_agent`) plus `link_policy_get`, `link_policy_propose` (`tools/supervisor.ts`)                                                                                                                                                                                                                       | Admitted by the socket because the process's nearest agent ancestor has the supervisor role (ADR 0004); sees only its own children. Policy changes are **proposed**, never applied.                |

- **Transport:** stdio JSON-RPC. The supervisor additionally gets one `auric-pm-<folder>`
  server per permitted, initialised project (`--strict-mcp-config`).
- **Node binary:** every generated MCP config (`command`) is the absolute path of a
  Node whose ABI matches `manifest.json` `nodeModuleVersion` (`node_runtime.rs`).
  A bare `node` on PATH may be a different major and then `better-sqlite3` dies
  before `initialize`. Codex `-c` overrides carry the same path. If none matches,
  the config falls back to `node` and the problem is logged.
- **Stability:** `--control` and `--supervisor` have fixtures and docs
  (`docs/design-agent-control.md`, `agentControl.fixtures.json`); `--project-root` tools
  are documented in `docs/spec/modules/fastmcp-server.md` (stale, see README gap 12) and
  tested per tool file.
- **Config bridge:** CLIs with only a global MCP config (Antigravity) bind through
  `AURIC_MCP_CONFIG={mcpConfigPath}` and one global entry running
  `auric-mcp/bridge.mjs` (`src/mcp/configBridge.ts`). Unbound, the bridge answers as a
  server with no tools, so it never blocks the CLI.
- **Guard:** Claude Code can disable a server per folder in `~/.claude.json`; spawn is
  refused with the fix instead of running an agent without `auric-pm`
  (`agents/claude_mcp_guard.rs`).

## 3. Supervisor Link (Supervisor Control API)

Integrator guide: [`../supervisor-control-api.md`](../supervisor-control-api.md). Contract:
[`../design-supervisor-link.md`](../design-supervisor-link.md). Machine-checkable half:
`src/lib/agents/supervisorLink.fixtures.json` (fixtures win over both docs). Code:
`src-tauri/src/supervisor_link/`.

### 3.1 Transport and handshake

| Item        | Value                                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport   | WebSocket (RFC 6455, `tungstenite`, sync) over unix socket `<app_data_dir>/supervisor-link.sock`, mode 0600. macOS and Linux only.                                                                                                        |
| Path        | `/v1`; anything else gets HTTP 404                                                                                                                                                                                                        |
| Frames      | text, one JSON object each; binary → `invalid_request`; inbound limit 1 MiB (close code 1009)                                                                                                                                             |
| Keep-alive  | server ping every 30 s                                                                                                                                                                                                                    |
| Auth        | **none by login.** The socket file mode, plus a peer-PID check (3.3). No tokens.                                                                                                                                                          |
| Handshake   | optional `session.hello` → `{protocol: 1, server: "AuricIDE", methods[18], events[8], features: ["supervisorKeys"]}`                                                                                                                      |
| Versioning  | every message carries `"v": 1`; other → `unsupported_version`. `/v1` and `v` change together, only on a breaking change. New things inside protocol 1 appear under `features`; an old build refuses unknown params with `invalid_params`. |
| Limits      | 16 connections, 64 pending requests per connection, 10 s handshake and write timeouts; over a limit → `busy` with `reason`                                                                                                                |
| Client hint | `AURIC_LINK_SOCKET` env override is a client convention (the probe honours it); the server does not read it.                                                                                                                              |

A browser cannot connect (no TCP). The client's backend holds the connection and
relays to its own UI.

### 3.2 Methods (18, fixture `methods`, equal to `METHODS` in `protocol.rs:19`)

| Group       | Methods                                                                                                                | What they do                                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session     | `session.hello`                                                                                                        | Protocol, method and event list, features                                                                                                                                                                                                                       |
| Supervisors | `supervisors.spawn`, `supervisors.list`                                                                                | Start a supervisor through the Quick Access tile's path (launch prompt, instructions, policy; never the provider picker). Optional `key`, `if: "existing"` makes it idempotent.                                                                                 |
| Agents      | `agents.list`, `agents.read`, `agents.send`, `agents.kill`                                                             | Only the supervisor tree. `agents.send` is a bracketed paste for long text, plus Enter; `read` returns `startOffset`/`endOffset`. A `supervisor: "<key>"` param replaces `agentId`.                                                                             |
| Events      | `events.subscribe`, `events.unsubscribe`                                                                               | Push: `agent.added/updated/removed/output`, `job.started/progress/finished/failed`; polled and diffed every 250 ms per connection                                                                                                                               |
| Documents   | `documents.projects`, `documents.search`, `documents.get`, `documents.resolve`, `documents.asset`, `documents.propose` | List shared projects with their types and job kinds; find, read, resolve a pointer, read a binary asset; propose a changed document as a git branch `auric/proposal/…` built from `HEAD` with git2, checked against `baseHash`, never touching the working tree |
| Jobs        | `jobs.create`, `jobs.list`, `jobs.cancel`                                                                              | A headless agent in its own worktree under the supervisor policy; result stays on a branch for a human to merge                                                                                                                                                 |

Error codes (fixture `errorCodes`, 31): `invalid_request`, `unsupported_version`,
`unknown_method`, `invalid_params`, `forbidden_agent_caller`, `unknown_agent`,
`agent_not_running`, `headless_no_stdin`, `supervisor_unavailable`, `provider_denied`,
`provider_unsupported`, `frontend_unavailable`, `document_not_visible`,
`document_not_found`, `document_invalid`, `document_conflict`, `not_a_git_repo`,
`supervisor_denied`, `job_kind_not_allowed`, `quota_exceeded`, `unknown_job`, `busy`,
`supervisor_key_invalid`, `supervisor_key_in_use`, `unknown_supervisor`,
`manager_archived`, `manager_key_mismatch`, `manager_key_foreign_folder`,
`instructions_too_large`, `registry_unreadable`, `internal`.

### 3.3 Caller rules and what the client cannot do

- **Every IDE agent is refused at the socket, supervisors included.** The server reads
  the peer PID and walks its parents; a running agent among them gets one `error`
  message with `forbidden_agent_caller` and close 1008. A walk that cannot finish
  (unreadable parent, loop) is refused too, never treated as "external"
  (`control_socket/caller.rs`, `Ancestry::{Agent, NoAgent, Untraceable}`).
- **Scope:** after the check, agent work goes through the shared `Dispatcher` as an
  external caller, narrowed to the **supervisor tree** (role supervisor,
  `spawnedByAgentId` set, or a job's agent). Agents a human started are `unknown_agent`.
  The link can never do more than `control.sock` already lets the same process do.
- **Cannot:** start a plain worker, choose provider, model or permission mode for a job,
  read any file that is not a document of a configured type, write into a working tree,
  merge, act in an unshared project, exceed the job counter.

### 3.4 Policy — what the human configures

File `<app_data_dir>/supervisor-link.json` (version 3, `POLICY_VERSION` in
`policy.rs:36`; v1 and v2 migrate on read), Rust-owned, mode 0600, **fails closed**
(missing or broken file shares nothing). Edited in Settings → Supervisor → Supervisor
link; a supervisor may only _propose_ a change (`link_policy_propose`, 24 h expiry,
Apply/Discard in the inbox, audit log).

| Part             | Fields                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `defaults`       | document types and job kinds every shared project inherits                                                                                       |
| `projects{path}` | per starred project: shared or not; own types and kinds override (same name), extend, disable, or `inherit: false`                               |
| Document type    | `name`, `globs`, optional `index {path, entriesKey}`, `nameField`, `descriptionField`, `schema`, `assets` globs, `maxAssetBytes` (default 2 MiB) |
| Job kind         | `kind`, `instructions` (project file wins over a global instructions file under `<app_data_dir>/job-kinds/`), `writes` globs                     |
| `jobs`           | `dailyLimit` (default 20; 0 = off), optional `perProjectDailyLimit`                                                                              |

Merged result: `policy::resolve` (fixture `resolution`). Jobs additionally need the
project open to supervisors in `supervisor-policy.json` and a provider with a ranked
model; provider and model are the supervisor's rule (load-balancing `next`, smallest
ranked model), never the client's. A `rev` is a commit id, branch or tag, never a
revision expression. Asset reads must match an asset glob after symlink resolution.

### 3.5 Documents and jobs in one picture

A client calls `documents.projects`, gets each shared project's document types
(`name`, `globs`, `nameField`, `descriptionField`) and job kinds, then
`documents.search { type, query }`, `documents.get`, `documents.resolve` (follows a
pointer like a scene's `detail` to the file that exists), `documents.asset` (for
`.glb`). To create something that does not exist yet it calls `jobs.create { project,
kind, payload }`, follows `job.*` events and reads the result with `documents.get { rev }`
(`merged: false` = unmerged preview). The payload (at most 16 KiB) is fenced in the
agent's prompt and named as data, so a client cannot turn it into instructions.

AuricIDE knows no client, no document format and no job kind; the example document type
in the docs is `scene`, because one companion app stores 3D scenes. That is
configuration, not a method.

## 4. Control socket

- **Transport:** NDJSON over `<app_data_dir>/control.sock` (`control_socket/`). Dev and
  installed build share the path; whoever starts first serves it, the second logs and
  runs without one.
- **Methods** (`protocol.rs`, fixture `agentControl.fixtures.json` → `requests`):
  `list_agents`, `list_projects`, `read_output`, `send_input`, `spawn`, `kill`,
  `await_result`, `remove_worktree`, `dismiss`, `link_policy_get`, `link_policy_propose`,
  and the internal `spawn_supervisor` (link only). `link_policy_apply` deliberately
  does not exist on the socket; only the Tauri command behind the inbox button applies.
- **Caller classes:** outside process (`--control`), supervisor (admitted with its own
  scope), any other IDE agent → `forbidden_agent_caller`. Spawn rules: a worker spawn
  needs `projectPath` and passes provider and supervisor policy; a model of rank 3 or
  more needs `modelReason`; every spawn that goes ahead lands in
  `<app_data_dir>/supervisor-spawns.jsonl`.
- **Frontend half:** spawn, kill and dismiss go to the frontend (`controlBridge.ts`,
  events `control-request`, commands `control_respond` / `control_ready`) so they take
  the same store actions as the UI buttons; requests carry `expiresAt`.
- **Limits:** console buffer 256 KiB per agent, 20 finished kept, `await_result` wait
  capped at 15 s. Enter is `\r`. Stability: contract.

## 5. Agent CLIs and providers (IDE → outside)

- **Provider registry:** `providers/`. Only `crush` is compiled in (reserved id).
  Everything else is JSON the user supplies: `dynamic-providers/*.json` (git-ignored),
  scanned from five directories in order, or imported in Settings → Agent into
  `<app_data_dir>/dynamic-providers/`. Schema and examples:
  `dynamic-providers/README.md`. Fields used elsewhere: `info.models[].rank`, `useFor`,
  `relativeCost`, `usage` capture block, optional `writeSandbox` (macOS Seatbelt,
  `agents/write_sandbox.rs`; refused on other platforms), `projectBinding.environment`.
- **Process model:** PTY children via `portable-pty`; headless runs (`claude -p`) for
  conductor, jobs and supervisors' children as configured. Output stream cleaned on
  append (`agents/output_buffer.rs`).
- **Provider policy** per project `{allow, deny}` — two implementations,
  `providerPolicy.ts` and `provider_policy.rs`, one fixture; enforced at
  `agents::resolve_permitted_provider` inside `spawn_agent_impl`.
- **Usage plugins:** `usage-plugins/*.json` (manifest per usage source; compiled-in
  default `cc_usage/default-manifest.json`; schema in `usage-plugins/README.md`).
- **Stability:** convention. The CLIs are third-party; their flags and transcript
  formats are checked by ignored real-machine tests (`cargo test … -- --ignored`).

## 6. File-based contracts

| File or folder                                                                            | Owner                                               | Content / purpose                                                                                                                                                                                                                                                                                                                                                                                                                                               | Who else reads or writes it                                           |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `<project>/.auric/project.db` (SQLite, WAL)                                               | Rust `database/`                                    | epics, tickets, goals, stations, requirements, reviews, `pm_agent_usage`, `kv_store` (project config)                                                                                                                                                                                                                                                                                                                                                           | MCP `auric-pm` (`better-sqlite3`), twin migrations in `src/mcp/db.ts` |
| `<project>/.auric/{missions,inbox-attachments,video-imports,worktree-include,.gitignore}` | Rust                                                | markdown missions, attachments, video import output, extra files for worktrees                                                                                                                                                                                                                                                                                                                                                                                  | humans, agents                                                        |
| `<app_data_dir>` = `~/Library/Application Support/com.auricide.ide`                       | Rust                                                | `app-credentials.json` (0600), `webview-prefs.json`, `supervisor-policy.json` (0600), `supervisor-link.json` (0600), `supervisor-managers.json`, `supervisor-spawns.jsonl`, `supervisor-link-jobs.json`, `inbox.db`, `notifications.db`, `agent-log.db`, `task-logs/tasks-YYYY-MM.jsonl` (or custom folder), `usage-limits*.json`, `dynamic-providers/`, `themes/`, `job-kinds/`, `runtime/` (local transcription tool), `control.sock`, `supervisor-link.sock` | the IDE only, except the two sockets                                  |
| `~/.auric/supervisors/<start time>/`                                                      | Rust `supervisor/runs.rs`                           | run folders of supervisors (their file tools reach only this folder), `INSTRUCTIONS.md` and `knowledge/` for managers                                                                                                                                                                                                                                                                                                                                           | opener capability allows opening them                                 |
| `.commit-guard.json` (repo root)                                                          | the commit scan (`commit` skill, outside this repo) | `{ "audience": "shared" }` in this repo: scan treats the repo as public                                                                                                                                                                                                                                                                                                                                                                                         | not read by AuricIDE code                                             |
| `docs/**/*.scene.json`                                                                    | humans, `scene.draw` jobs                           | 3D architecture scenes, `@archscene/core` format v1; discovered through the `scene` document type                                                                                                                                                                                                                                                                                                                                                               | link clients                                                          |
| Fixture files `src/lib/**/*.fixtures.json`                                                | both halves                                         | the contract of every twin (section 4 of README)                                                                                                                                                                                                                                                                                                                                                                                                                | Rust tests via `include_str!`                                         |
| `docs/automation-surface.md`                                                              | generated by script                                 | menu automation list; `automation-surface:check` fails when stale                                                                                                                                                                                                                                                                                                                                                                                               | UI automation                                                         |
| `verification/contracts/*.json(l)`                                                        | verification                                        | goal-satisfaction, launch-gate, provider-policy contracts shared with the Lean model                                                                                                                                                                                                                                                                                                                                                                            | tests                                                                 |

Run folders live under `~/.auric/supervisors` (capability and `supervisor/runs.rs`), not
in the project's `.auric/`.

## 7. Native menu automation

`docs/automation-surface.md` (generated by `scripts/generate-automation-surface.mjs`)
lists 46 menu commands with path, command id, shortcut and whether a project is needed.
They are real `AXMenuItem`s, addressable with `axbridge menu com.auricide.ide "Agent >
Start Agent"`. The window title mirrors the "needs attention" count, e.g. `(2) AuricIDE`.
`menu:command` is the event the frontend reacts to (`menu.rs`, `menu_bar.rs`). The
macOS menu-bar icon can launch supervisor skills and global shortcuts.

## 8. Hooks and sidecars

- **Claude `--settings` statusLine sidecar** (`usage_limits/claude.rs`,
  `agents/manager.rs`): AuricIDE's own Claude agents get a settings file whose
  `statusLine.command` drops the rate-limit JSON where the IDE can read it, then
  delegates to the user's own status line (read from `~/.claude/settings.json` only,
  never from project settings).
- **Husky pre-commit** (`.husky/pre-commit`): `lint-staged`, `knip`, `jscpd`; with Rust
  staged also `cargo fmt --check`, `clippy -D warnings`, `cargo test`, `cargo machete`.
- **Commit scan:** `.commit-guard.json` + the commit skill (outside the repo).
- **Notification actions:** `notify` can carry a button (kinds `spawn-agent`, `run-skill`,
  `run-combo`, `open-manager`, `run-conductor`, `answer`, `open`, `command`,
  `policy-proposal`; `src/lib/notifications/types.ts`); trust is decided by the dispatcher (`system`/`ui`
  user-authored vs `agent`/`mcp` model-authored), so an agent cannot widen its own
  permission mode (`notifications/trust.ts`).
- **Stop-hook for goals:** conductor goal agents run unattended without `/goal` because
  its stop hook refuses to let an agent end while a human station is open
  (`CLAUDE.md`).

## 9. Environment variables

Set by the IDE on child processes (found in `src-tauri/src/agents`, `mcp.rs`):

| Variable                                                            | Meaning                                                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `AURIC_IDE_AGENT=1`                                                 | marks every IDE agent; `--control` refuses to start when set; not trusted alone by the socket |
| `AURIC_AGENT_CWD`                                                   | the agent's own folder (launch requests are bound to it); only on agents with a binding       |
| `AURIC_PROJECT_ROOT`, `AURIC_MCP_DB_PATH`, `AURIC_NOTIFICATIONS_DB` | project binding for `auric-pm`; the inbox DB switches the notify tools on                     |
| `AURIC_AGENT_PROVIDERS`                                             | providers that support an isolated MCP project binding                                        |
| `AURIC_MCP_CONFIG`                                                  | path of the MCP config for CLIs with only a global config (`bridge.mjs`)                      |
| `AURIC_CONTROL_SOCKET`                                              | control socket path handed to a supervisor's MCP server                                       |
| `AURIC_PROJECT_NAME`                                                | substitution allowed in connector args (with `AURIC_PROJECT_ROOT`)                            |

Test and probe switches: `AURIC_EXCALIDRAW_MOCK=1`, `AURIC_DENY_CONTROL`,
`AURIC_DENY_MODEL`, `AURIC_PROBE_*`, `AURIC_SPIKE_CODEX_PROVIDER`,
`AURIC_REPRICE_PROJECT`, `AURIC_USAGE_BENCH_N`. Client convention only:
`AURIC_LINK_SOCKET`. Read from the host: `CLAUDE_CONFIG_DIR`, `HOME`, `PATH`,
`TMPDIR`.

## 10. Outbound

LLM HTTP calls (`llm.rs`), Excalidraw+ REST (`excalidraw/`, only `fetch_json` touches
the network), push delivery (`delivery/`, driven from `app_config.rs`), owner-approved
stdio connectors (`connectors.rs`), the project's own `.mcp.json` (read at spawn by `extra_mcp.rs`; names picked per project in Settings → Supervisor → Projects, definitions passed to the agent's private config only, Tauri command `extra_mcp_inspect` returns names and transports, never values), machine tools resolved by absolute path through the
login shell (`machine/`: `ffmpeg`, `ffprobe`, `go`, `okf`, plus `uv` and the
transcription runtime for video import). Third-party drift cannot be ruled out; the
policy in this repo is a hard check at the boundary (`video_import/failure.rs` never
turns tool output into a message).

---

## Supervisor Link vs. MCP

### Why the link exists — stated rationale

One rationale was found, in the commit that introduced it (`f590ce9d`, 2026-10-17):

> A companion app reached the IDE's agents through a handful of MCP tools (load
> projects, search, plan, spawn), which was fiddly. It now holds one bidirectional
> WebSocket straight to the supervisors instead, decided in a live review on 2026-10-17.
> A parallel 3D-scene feature in the companion needs to load and save scenes through the
> IDE, so scene access ships in v1.

`docs/design-supervisor-link.md` restates the shape ("one bidirectional WebSocket
instead of a handful of MCP tools", "a narrower door, not a new one", "the client's
backend is the client, not a browser"), but gives no further comparison. No ADR covers
it (ADR 0004 is the supervisor scope and only mentions link keys). Anything beyond this
quote below is my reading of the code.

### Pros and cons

|                      | Link                                                                               | MCP (`--control`)                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Push                 | `events.subscribe` streams output and job state; 250 ms poll behind it             | request/response; the client polls `read_agent_output` and `await_agent_result` (wait capped at 15 s) |
| Scope                | supervisor tree only, plus documents and jobs                                      | any worker in any allowed project                                                                     |
| Documents and jobs   | yes (`documents.*`, `jobs.*`, counter, worktree, branch)                           | not offered                                                                                           |
| Fits in an LLM       | no; a program, not a model, calls it                                               | yes, the natural form for an agent host                                                               |
| Setup for a client   | WebSocket over a unix socket; a path with a space needs care (`ws+unix://` breaks) | any MCP host, stdio                                                                                   |
| Versioning           | `/v1`, `v`, `features`, fixtures                                                   | tool schemas; no protocol number                                                                      |
| Spec surface to keep | 18 methods, 8 events, 31 error codes, one fixture                                  | tool list in `tools/agentControl.ts` and `supervisor.ts`                                              |

### Assessment: a thin generic MCP adapter over the link

**Feasible and small.** There is a precedent: `auric-mcp --control` already is an MCP
adapter over `control.sock`. An adapter over the link would be a stdio server that holds
one WebSocket, sends `session.hello`, and registers tools from the `methods` list the
server returns (one tool per method, parameters passed through as JSON, results returned
as JSON). That keeps it generic: no tool knows what a "scene" is; `documents.search`
takes a `type` string like the link does.

What it would be good for: an MCP host that is **not** an IDE agent (Claude Desktop,
another Claude Code session, a script) that wants documents and jobs without writing
a WebSocket client.

What does not map well, and what to decide before building it:

1. **Events.** `events.subscribe` has no clean MCP form. Options: omit it and offer a
   `events.poll` shaped on `agents.read`'s offsets; or use MCP notifications, whose
   support varies by host. Recommendation: omit push in v1, expose `agents.read` with
   `sinceOffset` and `jobs.list`.
2. **Caller rule.** It must run outside the IDE. The link refuses any caller whose
   ancestry contains an IDE agent, so an adapter started inside an agent would be
   rejected, which is correct. It should refuse to start inside an agent early, like
   `--control` does with `AURIC_IDE_AGENT`, to give a clear message.
3. **Who owns it.** Either a fourth mode in `cli.ts` (consistent with the three that
   exist, but a mode that is only valid outside the IDE, like `--control`) or a separate
   small package. A fourth mode shares the bundled runtime and needs no new install.
4. **Two surfaces to keep honest.** If tools are generated from `session.hello` there is
   nothing to drift. If hand-written they must be checked against
   `supervisorLink.fixtures.json`, as the Rust side already is.
5. **Size limits.** `agents.read` output and documents up to `maxDocumentBytes` may be
   large for a model's context; the adapter should pass limits through, not hide them.

The adapter must not gain client- or scene-specific endpoints; anything of that kind
stays configuration (document types and job kinds) in `supervisor-link.json`.

Not verified: no MCP host was run against any such adapter; nothing of it exists.
