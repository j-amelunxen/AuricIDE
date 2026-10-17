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

| method            | params                                                                                                                            | result                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `list_agents`     | —                                                                                                                                 | `{ agents: AgentSummary[] }`        |
| `read_output`     | `{ agentId, tailBytes?: number (default 16384, max 262144), sinceOffset?: number }`                                               | `OutputChunk`                       |
| `send_input`      | `{ agentId, text: string, enter?: boolean (default true) }`                                                                       | `{ agentId, bytesWritten: number }` |
| `kill`            | `{ agentId }`                                                                                                                     | `{ agentId, killed: true }`         |
| `spawn`           | `{ projectPath, prompt, provider?, model?, permissionMode?, headless?: boolean, name?, role?: "supervisor", worktree?: boolean }` | `{ agentId }`                       |
| `list_projects`   | —                                                                                                                                 | `{ projects: ProjectEntry[] }`      |
| `await_result`    | `{ agentId, waitSeconds?: number (default 60, max 120) }`                                                                         | `AwaitResult`                       |
| `remove_worktree` | `{ agentId }`                                                                                                                     | `WorktreeRemoval`                   |

`role` and `await_result` belong to the supervisor scope and are described
there. `role: "worker"` is the same as leaving it out. `worktree` and
`remove_worktree` are described under "Worktrees" below.

`AgentSummary` = the Rust `AgentInfo` as it already serialises
(`id, name, model, provider, status, currentTask, startedAt, lastActivityAt,
projectPath, repoPath, spawnedByTicketId, spawnedByGoalId, headless, role,
spawnedByAgentId`) plus
`outputBytes: number` — the running byte offset of that agent's output, so a
client can poll `read_output { sinceOffset }` for only what is new.
`status` is `running | idle | queued | error`. `role` is `worker | supervisor`;
`spawnedByAgentId` names the supervisor that started the agent, else `null`.

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

## Goal start over MCP (not the control socket)

`spawn` above carries no goal or ticket, and agents running inside the IDE are
refused at the socket. Starting an agent _for a goal_ from an agent therefore
goes through the project MCP server (`auric-pm`), the path that books cost on
the goal (`spawnedByGoalId`, `runSource: mcp`) and keeps the trust boundary:

1. `list_goals { parentId }` lists the sub-goals.
2. `get_goal_launch_prompt { goalId, purpose?, unattended? }` returns the exact
   text the Goals panel would put in the spawn dialog (`work`, `plan` or
   `split`) plus the work mode and why. It calls the same builders as the UI
   (`src/lib/goals/goalLaunchPrompt.ts`), and a test compares both outputs for
   one fixture, so the two cannot drift apart.
3. `request_agent_launch { goalId, prompt, ticketId?, purpose?, replace?, ... }`
   writes the inbox request. `ticketId` must be a ticket of the goal's subtree
   and books the run on it as well. An open request is returned untouched;
   `replace: true` swaps its prompt (same uid) as long as no run or claim exists
   for it, otherwise it is refused.

Whether the request starts by itself is still only decided in the IDE by a
launch grant on the mission root. The schema stays strict: an agent cannot send
`permissionMode`, `headless`, `launch`, `note` or a folder, with or without
`replace`. Nothing on the Rust side changes: it reads only the stored folder and
worktree flag of the request.

## Supervisor scope

A supervisor is an agent the IDE starts so that it can start, watch and stop
other agents in other projects. It is the one IDE agent the socket admits. The
reasoning, and the alternatives that were rejected, are in
`docs/adr/0004-supervisor-agent-scope.md`. The fixture `callerScope` is the
machine-checkable half of this section, `src/lib/config/supervisorPolicy.fixtures.json`
the one for the policy.

### Who is asking

The peer PID check above already walks the caller's parent chain. It now
returns the first running IDE agent it meets instead of a yes or no, and the
dispatcher reads that agent's `role`:

| caller       | how Rust recognises it                         | admitted                       |
| ------------ | ---------------------------------------------- | ------------------------------ |
| `external`   | no IDE agent among the ancestors               | yes, every method, every agent |
| `supervisor` | the nearest agent ancestor has role supervisor | yes, in the scope below        |
| `worker`     | the nearest agent ancestor has any other role  | no, `forbidden_agent_caller`   |

A PID that cannot be read is still refused, as before. Nothing the caller
sends can change which row it is in: there is no token, and `role` on a request
is a parameter of the agent being started, never a claim about the caller.

A supervisor reaches the socket through its own MCP server,
`auric-mcp --supervisor`. That mode starts while `AURIC_IDE_AGENT=1` is set
(`--control` still refuses) and registers only the supervisor tools. The
supervisor process is Claude, interactive, in a fresh run folder
`~/.auric/supervisors/<start time>/`, with that one server
(`--strict-mcp-config`) plus one `auric-pm-<folder>` server per permitted,
initialised project, `--tools "Read,Write,Edit,Glob,Grep,Skill,ToolSearch"` and
`--restricted` (the file tools reach only the run folder, and the user's
settings files with their allow rules are not read), those tools plus
`mcp__auric-supervisor__*` in `--allowedTools`, and `--permission-mode dontAsk`:
what is listed runs without asking, anything else is refused. It has no web
tool, a shell only through an approved skill, and Claude in Chrome only when
Settings → Supervisor switches it on (`supervisor.chrome`; `--chrome`, else
`--no-chrome`).

**Approved skills** are the `skills` block of the policy: a skill folder (the
one holding `SKILL.md`) and the `Bash(...)` patterns it may run. Rust links the
approved folders into a per-run plugin under
`<app_data_dir>/supervisor-skills/<run>/` (outside the run folder, so the
supervisor cannot edit a skill it is about to run) and passes `--plugin-dir`.
`Bash` joins `--tools` only while a loaded skill declares a pattern, and only
those patterns are allowed. A skill's `dirs` (its workspace) are passed as
`--add-dir`, so the file tools reach them too. A pattern is the user's statement that the command
is safe unattended: a process such a command detaches is external to the PID
walk (see ADR 0004).

Supervisors are started by the Supervisor tile in Quick Access, or by an
external caller with `spawn { role: "supervisor" }`. A supervisor cannot
start another supervisor.

### Methods for a supervisor caller

| method            | what a supervisor gets                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `list_projects`   | only projects its policy allows, each with a `supervisor` block (below)                       |
| `spawn`           | `provider`, `model` and `headless` required; checked against the policy; the child is its own |
| `list_agents`     | its own children only                                                                         |
| `read_output`     | its own children only                                                                         |
| `await_result`    | its own children only                                                                         |
| `kill`            | its own children only                                                                         |
| `remove_worktree` | its own children only                                                                         |
| `send_input`      | refused, `outside_supervisor_scope`                                                           |

- **Own children only.** Any other agent id, including the supervisor's own,
  an agent the human started and another supervisor's child, is answered with
  `unknown_agent`, the same as an id that does not exist. A supervisor learns
  nothing from an id outside its scope, not even whether it exists.
- **No typing, in v1.** `send_input` is refused even for its own children.
  Typing into a console can answer a permission prompt, which is the reason
  agents were kept off the socket in the first place. When a child waits on a
  question, the supervisor tells the human which window to answer in.
- **Refused parameters.** `role` on a supervisor's `spawn` is `invalid_params`:
  the field does not exist for that caller. `permissionMode` is
  `outside_supervisor_scope`: the policy names the mode, the supervisor does
  not get to pick a different one. A missing `provider`, `model` or `headless`
  is `invalid_params`; nothing is filled in from launch defaults.
- **The policy decides the spawn.** Rust runs `checkSpawn` from
  `supervisorPolicy.fixtures.json` in the dispatcher before the request reaches
  the frontend, and `spawn_agent_impl` runs it again for any agent whose parent
  is a supervisor. A refusal is `supervisor_denied` with a stable `reason` key
  on the error body (`model_not_allowed`, `project_limit_reached`, …; the list
  is in the fixture). The project's provider policy still applies on top: the
  supervisor's provider list is intersected with it, never a way around it.

The policy lives in `<app_data_dir>/supervisor-policy.json`, mode 0600, written
by Rust and read on every check. It is not in `webview-prefs.json`, because
either build can win that reconciliation, which is wrong for a security
setting. A missing or unreadable file, an unlisted project or a project with
`allowed: false` allows nothing. `bypassPermissions` is rejected when the file
is read. Any mode that skips the prompts for its provider (marked `unattended`
in the provider config, or launching with a skip flag) cannot be saved, and a
spawn whose mode, or whose provider's default when the policy names none, is
one is refused with `permission_mode_unattended`.

`ProjectEntry.supervisor`, present only in a supervisor's `list_projects`:

```
{ providers: [{ id, permissionMode: string | null,
                models: [{ id, label, rank: number | null }] }],
  allowInteractive: boolean, runningChildren: number, maxRunning: number,
  balancing: null | { windowDays: number, next: string | null,
                      providers: [{ id, weight, spawns, targetPercent,
                                    actualPercent: number | null }] } }
```

`rank` orders models by size within a provider (higher is bigger); `null` is
a model without a known size, which the supervisor does not pick by default.

**Load balancing is advisory.** A project entry may carry `providerWeights`
(provider id → a whole number 0..99, Settings: "Load-balancing share"), e.g.
`{ claude: 2, codex: 1 }` for twice as many Claude Code agents as Codex.
`checkSpawn` never reads it, so a spawn is never refused for its provider's
share. `balancing` reports, over the providers the supervisor may use there,
each one's target share against the agents actually started in that project
in the last `windowDays` (7): the finished runs in `pm_agent_usage` plus the
agents still running, whoever started them. It counts agents, not tokens or
cost: one provider's tokens say nothing about another's allowance, and cost is
only known once a run ends. `next` is the provider with the fewest agents per
share (a tie goes to the larger share, then the first id). The launch prompt
tells the supervisor to take `next`, then the smallest model there that fits,
and to pick another provider only when the task needs a model `next` does not
have, saying why. The rules for the field itself are `providerWeightsRules` in
`supervisorPolicy.fixtures.json`; the arithmetic is `policy::balancing` in Rust
only, since nothing in TypeScript computes it.

### Children

A child is an ordinary worker. The IDE spawns it through the frontend like
any other `spawn`, with the usual per-project MCP binding, `role: "worker"`,
`spawnedByAgentId` set to the supervisor and `runSource: "supervisor"`
(`docs/design-agent-usage.md`). It is not a descendant of the supervisor's
process, so if it ever reached the socket it would be refused as a worker.
There is no recursion. The bridge passes provider, model and permission mode
through unchanged for these requests.

When a supervisor is killed, its children keep running. Their results stay
readable, to external callers and in the UI, until the supervisor's card is
cleared.

### `await_result`

Waits up to `waitSeconds` for the agent to finish, then answers:

```
{ done: false, agentId, status, outputBytes }      // still running when the wait ended
{ done: true, result: RunResult }                  // finished, now or earlier
```

`RunResult` = `{ agentId, status: "idle" | "error", exitCode: number | null,
answer: string | null, isError, source: "cli_result" | "console_tail",
finishedAt, costUsd: number | null }`.

- `answer` is the CLI's own result text when it reports one (headless Claude,
  `source: "cli_result"`), otherwise the last 8 KiB of the cleaned console
  (`source: "console_tail"`). `costUsd` is `null` where the CLI states no cost.
- `waitSeconds: 0` only looks. Rust keeps the result of the last **200**
  finished agents (`run_results.rs`). A wait in progress
  does not count against the connection's idle timeout, which only applies
  while the socket waits for the next request line.
- The client allows `waitSeconds + 5` s before it reports `timeout`.
- External callers may await any agent; a supervisor only its children.

### Tools (`auric-mcp --supervisor`)

| tool                 | socket method     |
| -------------------- | ----------------- |
| `list_projects`      | `list_projects`   |
| `spawn_agent`        | `spawn`           |
| `list_my_agents`     | `list_agents`     |
| `read_agent_output`  | `read_output`     |
| `await_agent_result` | `await_result`    |
| `kill_agent`         | `kill`            |
| `remove_worktree`    | `remove_worktree` |

## Error codes

`invalid_request`, `unknown_method`, `invalid_params`, `unknown_agent`,
`agent_not_running`, `headless_no_stdin`, `provider_denied`,
`frontend_unavailable`, `forbidden_agent_caller`, `supervisor_denied`,

### Worktrees

`spawn` with `worktree: true` runs the agent in a git worktree of its own:
the bridge sets `AgentConfig.useWorktree`, so the frontend creates an Auric
worktree (`<repo>.auric-wt/<name>`, branch `auric/<name>`) before the Rust
spawn, exactly as the spawn dialog's worktree option does. The bridge also
appends one fixed paragraph to the task (`WORKTREE_CHILD_NOTE`): commit all
work on that branch, do not merge it, do not remove the worktree. Without the
commit, finished work and leftovers look the same.

`remove_worktree { agentId }` is the cleanup. The folder is always the agent's
own working directory (live from the agent list, else what the socket noted
at spawn), never a path the caller names, and there is no `force`:

- A running or queued agent is refused (`invalid_params`): await or kill it
  first. An agent that ran in the project folder itself is refused too.
- No uncommitted change and no commit the source checkout lacks: the worktree
  and its `auric/` branch are removed, `removed: true`.
- Otherwise it stays, `removed: false` with `dirty` and `branchAhead` saying
  why. That is an answer, not an error: the work waits for a person to merge
  or discard it in the Git panel. Nothing here merges.

`WorktreeRemoval` = `{ agentId, path, branch: string | null, sourceRepo,
removed, dirty, branchAhead }`.

The supervisor's launch prompt makes cleanup its duty: remove after reading
the result, hand over on `removed: false`, and sweep its finished children
before it ends. The socket's spawn note lives in memory only, so a worktree
from before an app restart is found through the agent list or not at all; it
stays in the Git panel's worktree list for a person.

`outside_supervisor_scope`, `internal`.

- `supervisor_denied`: the supervisor policy refuses this spawn. The error
  body carries `reason`, a stable key from `supervisorPolicy.fixtures.json`.
- `outside_supervisor_scope`: a supervisor asked for something its scope never
  includes (`send_input`, a `permissionMode` of its own).

The client adds three of its own: `app_not_running` when the socket does not
exist or refuses the connection, `timeout` when no answer arrives in time, and
`contract_violation` when a response does not match the fixture shapes.

## MCP tools (`auric-mcp --control`)

| tool                 | socket method     |
| -------------------- | ----------------- |
| `list_agents`        | `list_agents`     |
| `read_agent_output`  | `read_output`     |
| `send_agent_input`   | `send_input`      |
| `kill_agent`         | `kill`            |
| `spawn_agent`        | `spawn`           |
| `list_projects`      | `list_projects`   |
| `await_agent_result` | `await_result`    |
| `remove_worktree`    | `remove_worktree` |

Each tool returns the result as JSON text; a socket error becomes a tool error
whose message names the code and the message, e.g.
`headless_no_stdin: agent-3 runs headless and does not read input`.

Register it for Claude Code with:

```bash
claude mcp add --scope user auric-control -- node <app resources>/auric-mcp/server.mjs --control
```
