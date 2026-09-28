# Agent control over MCP

A person working outside the IDE (another Claude Code session, a script) can
see and steer the IDE's agent fleet: list every running agent across all
projects, read an agent's console, type into it, kill it, and start a new one
for a project. This document is the contract both sides are built against;
`src/lib/agents/agentControl.fixtures.json` is its machine-checkable half.

## Shape

```
external MCP client ─stdio─▶ auric-mcp --control ─unix socket─▶ Rust control_socket ─▶ AgentManager / PTY writer
                                                                          └─ spawn/kill ─▶ frontend store (same path as the UI)
```

- **Only external clients get these tools.** `--control` is its own server
  mode with no project binding and only the control tools. Agents the IDE
  spawns are bound with `--project-root` (`src-tauri/src/mcp.rs`) and never see
  them: typing into a console can answer a permission prompt, so one agent
  must not be able to approve another's. Registering `auric-control` at user
  scope means every Claude Code session loads it — including agents the IDE
  starts without a project binding. So `spawn_agent_impl` sets
  `AURIC_IDE_AGENT=1` on every agent process; the MCP servers that agent
  starts inherit it, and `--control` refuses to start while it is set
  (`AURIC_AGENT_CWD`, which only the IDE's own binding carries, is checked
  too). The first draft checked only `AURIC_AGENT_CWD` and QA showed that
  guard never fired.
- **The socket enforces it for every provider.** An env marker only helps
  where the CLI passes its environment to MCP servers — Codex, for one, hands
  them a whitelist. So Rust checks each connection itself: it reads the
  peer's PID (`LOCAL_PEERPID` on macOS, `SO_PEERCRED` on Linux), walks its
  parent chain, and refuses the connection with `forbidden_agent_caller` if
  any ancestor is a running IDE agent. That holds for Claude, Codex,
  OpenCode, Crush or any dynamic provider, and also for an agent that talks
  to the socket straight from its shell. A peer whose PID cannot be read is
  refused too. The IDE's own terminal panel is not an agent, so a person
  running a client there is allowed.
- **What is left open.** The socket is mode 0600, so other users are out. An
  agent that fully detaches a process (double fork, reparented to `launchd`)
  takes that process out of its parent chain, and the check no longer sees it.
  That needs deliberate effort from the agent; it is documented in ADR 0003
  rather than hidden.
  See `docs/adr/0003-agent-control-socket.md`.

## Transport

- Socket: `<app_data_dir>/control.sock`
  (`~/Library/Application Support/com.auricide.ide/control.sock`).
  The client may override it with `AURIC_CONTROL_SOCKET`. Rust removes a stale
  file before binding and sets mode 0600 after.
- Framing: newline-delimited JSON, one request per line, one response per line,
  in order. A connection may carry several requests.
- Request: `{ "id": string|number, "method": Method, "params": object? }`
- Response: `{ "id": <same>, "ok": true, "result": ... }` or
  `{ "id": <same>, "ok": false, "error": { "code": ErrorCode, "message": string } }`.
  A line that is not valid JSON, or has no string `method`, gets
  `{ "id": null, "ok": false, "error": { "code": "invalid_request", ... } }`.

## Methods

All field names are camelCase on the wire.

| method          | params                                                                                   | result                              |
| --------------- | ---------------------------------------------------------------------------------------- | ----------------------------------- |
| `list_agents`   | —                                                                                        | `{ agents: AgentSummary[] }`        |
| `read_output`   | `{ agentId, tailBytes?: number (default 16384, max 262144), sinceOffset?: number }`      | `OutputChunk`                       |
| `send_input`    | `{ agentId, text: string, enter?: boolean (default true) }`                              | `{ agentId, bytesWritten: number }` |
| `kill`          | `{ agentId }`                                                                            | `{ agentId, killed: true }`         |
| `spawn`         | `{ projectPath, prompt, provider?, model?, permissionMode?, headless?: boolean, name? }` | `{ agentId }`                       |
| `list_projects` | —                                                                                        | `{ projects: ProjectEntry[] }`      |

`AgentSummary` = the Rust `AgentInfo` as it already serialises
(`id, name, model, provider, status, currentTask, startedAt, lastActivityAt,
projectPath, repoPath, spawnedByTicketId, spawnedByGoalId, headless`) plus
`outputBytes: number` — the running byte offset of that agent's output, so a
client can poll `read_output { sinceOffset }` for only what is new.
`status` is `running | idle | queued | error`.

`ProjectEntry` = `{ path, name, starred, isOpen, initialized, lastOpenedAt,
runningAgents, description, descriptionSource }`. The list is starred projects first, then recent
ones, then any other folder the IDE currently watches.

- `initialized`: the folder holds `.auric/project.db`. `spawn` refuses a
  project without it, so a client should pick from the initialised ones.
- `lastOpenedAt`: ms since epoch from the recent-projects store, `null` when
  the project is only starred or watched.
- `runningAgents`: agents with status `running` whose `projectPath` is this
  path.
- `description`: what the project is for. A description the user set on a
  starred project wins (`descriptionSource: "user"`). The user sets it by
  right-clicking the tile in Quick Access and choosing "Set description…". It
  is stored in the starred record next to the badge, so unstarring drops it,
  and it is trimmed and capped at 300 characters when saved. Saving it empty
  clears it. Recent-only projects have no settings record, so for them it is
  always derived.
- Otherwise it is derived, because AuricIDE stores nothing else about a
  project's purpose. The first choice is the first prose paragraph of
  `README.md` (`"readme"`): the title, badges and HTML are skipped, and
  Markdown emphasis, links and code ticks are flattened. Then `description`
  from `package.json` (`"package"`), then from `Cargo.toml` (`"cargo"`).
  Whitespace is collapsed, and the text is cut at a word boundary to at most
  200 characters including the `…`. If nothing is found, both fields are
  `null`. Only these three files are read, and only their first 64 KiB.
- The cases are in the fixture `projectDescription`.

`OutputChunk` = `{ agentId, status, text, startOffset, endOffset, truncated }`.

- `text` is the PTY output cleaned **as it is appended**, by a stateful
  stripper per agent: escape sequences (CSI, OSC, charset designations such
  as `ESC ( B`) removed even when a PTY batch splits them, other C0 control
  characters dropped except `\n` and `\t`, `\r\n` and a lone `\r` become
  `\n`. Cleaning at append rather than per read is what keeps a sequence split
  across two polls from leaking into the second one. It is still the console
  of a TUI that redraws itself — repeated fragments, not a transcript.
- Offsets count bytes of that cleaned text since the agent started.
  `endOffset` equals the agent's current `outputBytes`.
- With `sinceOffset`, `text` covers `[sinceOffset, endOffset)`; if the buffer
  no longer holds `sinceOffset`, it starts at the oldest kept byte and
  `truncated` is `true`. Without it, the last `tailBytes` are returned and
  `truncated` says whether older output existed.
- Rust keeps the last **256 KiB** per agent, and the buffers of the **20**
  most recently finished agents.

### `send_input`

Writes `text` and, when `enter` is true, a trailing `\r` — what a terminal
sends for the Enter key (fixture `enter`). The first draft used `\n`, copied
from the console composer; the real run against Claude Code showed `\n` only
inserts a line break in its input box and never submits, so the composer, the
Enter nudge and the menu buttons were changed to the same `\r`. An empty `text`
with `enter: true` is a bare Enter nudge. After writing, Rust emits the Tauri
event `agent-input-sent` `{ agentId, text }` so the feed shows the message
like one typed in the UI (`agentSentMessages`); a bare nudge is not recorded,
same as `sendAgentInput`.

Refused with `headless_no_stdin` for a headless agent (the CLI does not read
stdin), `agent_not_running` when the agent exists but is not `running`,
`unknown_agent` when the id is not known at all.

### `spawn` and `kill` go through the frontend

Both have bookkeeping the UI path already owns (launch defaults per working
directory, ticket/goal bookkeeping, spawn configs for Retry, kill side
effects). Rust therefore does not call the impls directly. It emits the Tauri
event `control-request` `{ reqId: string, method: "spawn" | "kill", params }`
and waits up to **30 s** for the frontend to call the command
`control_respond { reqId, ok: boolean, result?: any, error?: { code, message } }`.
No answer in time → `frontend_unavailable`.

- **Readiness.** The socket comes up during Rust setup, before the webview has
  mounted its listener; an event emitted then is lost. The bridge calls
  `control_ready` once it listens. Until then Rust holds spawn/kill requests
  (inside the same 30 s) and emits them when the bridge reports ready.
- **Expiry.** The event carries `expiresAt` (ms since epoch, the moment Rust
  stops waiting). The bridge refuses a request that arrives after it, so a
  caller who got `frontend_unavailable` and retries does not end up with two
  agents.
- **Kill is checked.** After the frontend answers a kill, Rust confirms the
  agent is no longer running; otherwise it answers `internal`.

- `spawn` runs in `projectPath` without switching the open project (the same
  way a custom-agent notification launch does). Provider/model/permission mode
  default to the launch defaults stored for that working directory; the
  provider policy still applies in Rust (`resolve_permitted_provider`) and a
  refusal is reported as `provider_denied`. `projectPath` must be an existing
  directory that is an initialised AuricIDE project (`.auric/project.db`,
  ADR 0002), else `invalid_params` naming which of the two is missing.
- `kill` uses the same store action as the UI kill button.

## Error codes

`invalid_request`, `unknown_method`, `invalid_params`, `unknown_agent`,
`agent_not_running`, `headless_no_stdin`, `provider_denied`,
`frontend_unavailable`, `forbidden_agent_caller`, `internal`. The client adds three of its own: `app_not_running` when the socket does not
exist or refuses the connection, `timeout` when no answer arrives in time, and
`contract_violation` when a response does not match the fixture shapes.

## MCP tools (`auric-mcp --control`)

| tool                | socket method   |
| ------------------- | --------------- |
| `list_agents`       | `list_agents`   |
| `read_agent_output` | `read_output`   |
| `send_agent_input`  | `send_input`    |
| `kill_agent`        | `kill`          |
| `spawn_agent`       | `spawn`         |
| `list_projects`     | `list_projects` |

Each tool returns the result as JSON text; a socket error becomes a tool error
whose message names the code and the message, e.g.
`headless_no_stdin: agent-3 runs headless and does not read input`.

Register it for Claude Code with:

```bash
claude mcp add --scope user auric-control -- node <app resources>/auric-mcp/server.mjs --control
```
