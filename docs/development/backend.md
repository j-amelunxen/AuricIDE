# Backend, MCP and machine tools

[Developer guide index](README.md) · [Documentation index](../README.md)

Runtime ownership, backend modules, MCP entry points and machine-tool failure handling. See also the [backend specification](../spec/modules/tauri-backend-core.md) and [MCP specification](../spec/modules/fastmcp-server.md).

## MCP Server

`src/mcp/server.ts` (`src/mcp/cli.ts` mode switch) is a FastMCP server that runs in three modes across 26 tool files (~90 tool registrations):

- `--project-root <dir>` (`auric-pm`): project-bound PM tools (epics, tickets, tasks, dependencies, testcases, history, blueprints, context, canvas, requirements, goals, goal launch/reviews, stations, knowledge, reviews, agent usage, plus notifications and agent launch when `AURIC_NOTIFICATIONS_DB` is set).
- `--control` (`auric-control`): outside-client fleet control over `control.sock` (`src/mcp/tools/agentControl.ts`; refused inside IDE agents).
- `--supervisor` (`auric-supervisor`): supervisor-scoped child control and link policy proposals (`src/mcp/tools/supervisor.ts`).

It runs as a subprocess started by Rust (`src-tauri/src/mcp.rs`, bundled into `src-tauri/resources/auric-mcp` by `pnpm mcp:bundle`) and communicates via stdio JSON-RPC. To run it standalone:

```bash
npx tsx src/mcp/server.ts --project-root /path/to/project
```

Tool implementations are in `src/mcp/tools/` — one file per domain. Environment variables `AURIC_NOTIFICATIONS_DB` and `AURIC_PROJECT_ROOT` configure notifications and knowledge/canvas tools.

## Agent launch and completion ownership

Supervisor-specific launch behavior lives in `src-tauri/src/supervisor/launch.rs`:
role admission, CLI/MCP binding, manager booking and child adoption. The shared
child-check input mapping lives in `supervisor/admission.rs`. Each gate captures
fresh inputs at its original read points; running-child counts canonicalize
project paths and must retain their position relative to the provider-mode
callback. A control pre-check never bypasses final process admission.

Agent process and PTY registration identity are grouped in `agents::AgentSession`.
`agents::pty` owns terminal state, writes, resize announcements and session keys.
Published writers are held by the registry and in-flight operations; a session's
registration handle must not retain an extra writer reference after removal.
Keep the publish/liveness recheck for agents that exit immediately. Completion
steps live in `agents::finish`, retaining distinct Exit/Kill/Quit order and effects:
result text before buffer eviction, first-remover bookkeeping, and the shared
shutdown budget with restart anchors preserved.
Native kill errors retain the live session and its PTY and return to the caller.
Only an accepted kill claims the session under the manager lock; release that
lock before dropping the writer. This is an accepted-stop contract, not proof
that every descendant process died. The frontend ends nothing the backend did
not confirm (`src/lib/agents/stop.ts`): a refused kill counts only when a fresh
`list_agents` no longer shows the agent running, and "Stop all" stops exactly
the IDs its confirmation counted, one `kill_agent` each, so a late spawn
survives and a failed member keeps its card.

## Rust Backend Modules

| Module                    | File                                                                                                       | Responsibility                                                                                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commands                  | `lib.rs`, `commands/`                                                                                      | `lib.rs` registers `#[tauri::command]` handlers; a feature's commands live in its own `commands.rs` (notifications, schedules, missions, mcp, llm, excalidraw, themes, crashlog, agent_log, providers, …), `commands/` holds fs, db, agent, inbox, terminal, watcher and the menu |
| Agents                    | `agents/`, `agent_persistence.rs`, `agent_log.rs`, `agent_window.rs`                                       | Spawn/kill AI agent processes, stream PTY output, persist run history (`agent_persistence.rs` and `agents/persistence.rs`), detached agent window                                                                                                                                 |
| Supervisor & Control      | `supervisor/`, `supervisor_link/`, `control_socket/`                                                       | Supervisor policy, run folders & named managers; Supervisor Control API WebSocket (`supervisor-link.sock`); NDJSON `control.sock` and shared dispatcher                                                                                                                           |
| Crashlog                  | `crashlog.rs`, `ui_watchdog.rs`                                                                            | Rust panic hook, frontend crash log reporting, and UI responsiveness watchdog                                                                                                                                                                                                     |
| CLI & Agent Usage         | `cc_usage/` (`mod.rs`, `manifest.rs`, `scan.rs`, `pricing.rs`, `report/`), `usage_limits/`, `agent_usage/` | Historical CLI transcript usage (`usage-plugins/*.json`), live quota window (`usage_limits/`), and per-run ticket/goal cost (`agent_usage/`; see [usage](usage.md))                                                                                                               |
| Database                  | `database/`                                                                                                | SQLite schema, migrations, PM CRUD (epics, tickets, test cases, goals, goal dependencies, requirements, reviews)                                                                                                                                                                  |
| Excalidraw                | `excalidraw/` (`mod.rs`, `contract.rs`)                                                                    | Excalidraw integration REST API & scene listing                                                                                                                                                                                                                                   |
| Git                       | `git/`, `ignored_repos.rs`                                                                                 | **All git behaviour** (git2-rs): status, diff, stage/unstage, commit, push, discard, blame, branches, graph, merge, worktrees. `lib.rs` only registers the commands.                                                                                                              |
| Inbox & Missions          | `inbox/`, `missions/`                                                                                      | App-level GTD inbox (`inbox.db`, assigning writes a ticket into `.auric/project.db`) and repository-owned markdown missions (`.auric/missions/`)                                                                                                                                  |
| Machine & Connectors      | `machine/` (including `shell_env.rs`), `connectors.rs`                                                     | Shared login-shell environment cache, executable/PATH resolution, declared machine dependencies (`ffmpeg`, `ffprobe`, `go`, `okf`), and owner-approved stdio MCP connectors                                                                                                       |
| Machine credentials       | `app_config.rs`                                                                                            | Machine-wide settings (API keys) that outlive any one project; a project may still override                                                                                                                                                                                       |
| Quota blocks              | `quota_blocks/`, `agents/quota_detection.rs`                                                               | Temporary provider/model-family blocks after quota exhaustion; refuses a supervisor's spawn                                                                                                                                                                                       |
| Provider policy           | `provider_policy.rs`                                                                                       | Which agentic providers a project permits. Twin of `src/lib/config/providerPolicy.ts`; both tested against `providerPolicy.fixtures.json`                                                                                                                                         |
| LLM & Providers           | `llm.rs`, `providers/`                                                                                     | HTTP calls to LLM APIs, agent CLI provider registry (`RESERVED_PROVIDER_ID` = the built-in `crush`, plus `dynamic-providers/*.json`)                                                                                                                                              |
| MCP                       | `mcp.rs`, `node_runtime.rs`                                                                                | Write per-agent MCP configs (absolute Node matching the bundle ABI) and start/stop FastMCP server subprocess (`AURIC_NOTIFICATIONS_DB`, `AURIC_PROJECT_ROOT`)                                                                                                                     |
| Memory Report             | `memory_report.rs`                                                                                         | System & process tree memory monitoring for performance metrics                                                                                                                                                                                                                   |
| Menu                      | `menu.rs`, `menu_bar.rs`                                                                                   | Native macOS application menu and supervisor menu-bar icon / global shortcuts                                                                                                                                                                                                     |
| Notifications & Schedules | `notifications/`, `schedules/`, `delivery/`                                                                | Cross-project notification bus, cron & one-shot schedule execution engine, and outbound push delivery                                                                                                                                                                             |
| Configuration             | `app_config.rs`, `provider_policy.rs`                                                                      | Application-wide credentials (`app-credentials.json`, mode 0600) and the per-project agent-provider allow/deny list enforced at spawn                                                                                                                                             |
| Project Discovery         | `project_icons.rs`, `project_skills.rs`, `recent_projects/`                                                | Workspace icons ranking, skills discovery, recent & starred projects management                                                                                                                                                                                                   |
| Recent creations          | `recent_creations.rs`                                                                                      | Newest file birth time per directory, maintained from watcher events so `read_directory` dates folders without walking their subtree (see [explorer timestamps](frontend.md#dating-folders-without-walking-them))                                                                 |
| Themes                    | `themes.rs`                                                                                                | Custom theme JSON scanner and theme list API                                                                                                                                                                                                                                      |
| Shared foundations        | `json_store.rs`, `file_lock.rs`, `project_path.rs`                                                         | Atomic JSON writes and explicit unreadable-file policies; advisory file locks; shared project identity with caller-specific missing-path fallbacks                                                                                                                                |
| Utilities                 | `utf8_stream.rs`, `ansi.rs`, `clipboard.rs`, `webview_prefs.rs`                                            | UTF-8 PTY chunk reassembly, ANSI stripping, clipboard image helpers, cross-origin webview preferences sync                                                                                                                                                                        |
| External agents           | `external_agents/`, `control_socket/external_agents.rs`                                                    | Runs the IDE tracks without a process (`external-agents.json`); books them into `pm_agent_usage` and the task log. See [external agents](agent-control.md#external-agents-runs-the-ide-tracks-but-does-not-run)                                                                   |
| Video import              | `video_import/` (`mod.rs`, `preflight.rs`, `failure.rs`)                                                   | Transcription and frame extraction; the dependency preflight and the rule that tool output never becomes an error message (see [machine tools](#depending-on-tools-that-come-from-the-machine))                                                                                   |

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
