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

| method            | params                                                                                                                                                  | result                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `list_agents`     | —                                                                                                                                                       | `{ agents: AgentSummary[] }`             |
| `read_output`     | `{ agentId, tailBytes?: number (default 16384, max 262144), sinceOffset?: number }`                                                                     | `OutputChunk`                            |
| `send_input`      | `{ agentId \| supervisor, text: string, enter?: boolean (default true) }`                                                                               | `{ agentId, bytesWritten: number }`      |
| `kill`            | `{ agentId }`                                                                                                                                           | `{ agentId, killed: true }`              |
| `spawn`           | `{ projectPath?, prompt, provider?, model?, permissionMode?, headless?: boolean, name?, role?: "supervisor", supervisorKey?, worktree?, modelReason? }` | `{ agentId }`                            |
| `list_projects`   | `{ project?: string }` (a path or a project name; none matching is `unknown_project`)                                                                   | `{ projects: ProjectEntry[], catalog? }` |
| `await_result`    | `{ agentId, waitSeconds?: number (default 0, max 15), untilInput?: boolean, sinceOffset?: number }`                                                     | `AwaitResult`                            |
| `remove_worktree` | `{ agentId }`                                                                                                                                           | `WorktreeRemoval`                        |
| `dismiss`         | `{ agentId }`                                                                                                                                           | `{ agentId, dismissed: true }`           |

`role` and `await_result` belong to the supervisor scope and are described
there; `supervisorKey` and `send_input { supervisor }` under "Several
supervisors". `role: "worker"` is the same as leaving it out. `worktree` and
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
with `enter: true` is a bare Enter nudge.

A message longer than 32 bytes, or with a line break, goes in as one
bracketed paste (`ESC[200~` … `ESC[201~`, then the `\r`) whenever the
agent's TUI has switched bracketed paste on (`ESC[?2004h`, followed from its
raw output in `OutputBuffers`). Written as plain keystrokes, Claude Code takes
such a burst for a paste of its own: the `\r` becomes part of the text and
nothing is submitted, and a burst spanning several reads is cut into several
pastes that lose characters at the seams. Measured in a real PTY against
Claude Code 2.1.302: one line of 59 bytes plus `\r` submits, 119 bytes does
not; unbracketed 3 kB lost words at every 1 kB read; bracketed, 8 kB arrived
exact and submitted. Short answers stay keystrokes, because a menu reads `1`
as a key and not as a paste. One function decides this for every sender:
`agents::terminal_input::compose_message`, also behind the IDE's own
composers (`agent_send_message`). After writing, Rust emits the Tauri
event `agent-input-sent` `{ agentId, text }` so the feed shows the message
like one typed in the UI (`agentSentMessages`); a bare nudge is not recorded,
same as `sendAgentInput`.

Refused with `headless_no_stdin` for a headless agent (the CLI does not read
stdin), `agent_not_running` when the agent exists but is not `running`,
`unknown_agent` when the id is not known at all.

### `spawn`, `kill` and `dismiss` go through the frontend

All three have bookkeeping the UI path already owns (launch defaults per
working directory, ticket/goal bookkeeping, spawn configs for Retry, kill side
effects, the card list). Rust therefore does not call the impls directly. It
emits the Tauri event `control-request`
`{ reqId: string, method: "spawn" | "kill" | "dismiss", params }`
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
  refusal is reported as `provider_denied`. For a worker `projectPath` is
  required and must be an existing directory that is an initialised AuricIDE
  project (`.auric/project.db`, ADR 0002), else `invalid_params` naming which
  is missing. A supervisor (`role: "supervisor"`) needs only `prompt`: it gets
  a run folder of its own and its projects from the supervisor policy. A
  `projectPath` it names anyway is dropped while parsing, never checked or
  passed on.
- `kill` uses the same store action as the UI kill button.
- `dismiss` uses the same store action as a finished card's Dismiss button
  (`dismissFinishedAgent`), then Rust forgets the agent's kept result. A
  running or queued agent is refused (`invalid_params`) in Rust and again in
  the bridge: dismissing is not stopping. A card the human already cleared is
  answered `dismissed: true`. A refusal from the frontend keeps the result, so
  the call can be retried.

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
initialised project, `--tools "Read,Write,Edit,Glob,Grep,Skill,ToolSearch,Bash"` and
`--restricted` (the file tools reach only the run folder, and the user's
settings files with their allow rules are not read), those tools plus
`mcp__auric-supervisor__*` in `--allowedTools`, and `--permission-mode dontAsk`:
what is listed runs without asking, anything else is refused. It has no web
tool, shell access for timer `sleep N` plus approved skills/tools, and Claude in Chrome only when
Settings → Supervisor switches it on (`supervisor.chrome`; `--chrome`, else
`--no-chrome`).

**Resuming a run.** A spawn may carry `resumeRunDir`, an earlier run's folder.
Rust (`supervisor/runs.rs`) then reuses that folder instead of making a new one,
but only if it resolves, symlinks followed, to a direct child of
`~/.auric/supervisors/`: never the root, never a subfolder of a run, never
anything outside. Everything else about the launch stays as above. The launch
prompt adds "Picking up an earlier run": read the folder newest first, report
where the run stopped, wait for the go-ahead. The earlier run's children are adopted: their `spawnedByAgentId` moves to
the new supervisor's id (see "Several supervisors"), so they are in its scope
again. A supervisor restored after an app restart resumes its own folder the same
way. Listing is `supervisor_runs_list` / `supervisor_run_files` (Tauri only,
not on any socket).

**Image attachments** entered in the supervisor terminal are made durable before
they reach Claude. Dropped image files, image clipboard data, and absolute PNG,
JPG/JPEG, GIF, WEBP or HEIC paths in a submitted terminal line are copied (never
moved) to `<run>/attachments/`; their message path is rewritten to that copy.
The backend limits each image to 25 MB and disambiguates duplicate filenames.
This keeps transient macOS screenshot paths usable under Claude's restricted
file-tool scope. The terminal shows the normal success toast after a copy.

**Approved skills** are the `skills` block of the policy: a skill folder (the
one holding `SKILL.md`) and the `Bash(...)` patterns it may run. Rust links the
approved folders into a per-run plugin under
`<app_data_dir>/supervisor-skills/<run>/` (outside the run folder, so the
supervisor cannot edit a skill it is about to run) and passes `--plugin-dir`.
`Bash` always has the timer rule `Bash(sleep *)`; a loaded skill adds only
the patterns it declares. A skill's `dirs` (its workspace) are passed as
`--add-dir`, so the file tools reach them too. A pattern is the user's statement that the command
is safe unattended: a process such a command detaches is external to the PID
walk (see ADR 0004).

**Approved tools** are the `tools` block: a CLI tool, keyed by a bare command
name (`umi`, found by the shell's PATH) or by the absolute path of its binary,
with optional `dirs` (passed as `--add-dir`, like a skill's). Each tool becomes
exactly two rules, `Bash(<tool>)` and `Bash(<tool> *)`, so only a command that
starts with that tool is allowed; Claude Code judges each part of a chained
command (`&&`, `|`) on its own. These rules extend the built-in timer grant. A key that is neither shape, or holds whitespace, brackets, quotes,
`*` or a control character, is refused alone (`invalid_entry`, or
`path_not_absolute` for a relative path) and listed as
`{ project: null, tool, reason }`; a bare name needs a letter or digit, because
`.` would be the `source` builtin. A path whose binary is gone at launch is
left out. Tool keys are not canonicalised: the rule is matched against the
command text, not a file identity. Settings warns about tools that run any code
they are given (`unrestrictedTools` in the fixtures: shells, interpreters,
`env`, `xargs`, `sudo`), but does not block them; that is the user's call.

Supervisors are started by the Supervisor tile in Quick Access, the menu
bar, the supervisor link, or by an external caller with
`spawn { role: "supervisor" }`. A supervisor cannot start another supervisor.

### Several supervisors

Any number of supervisors may run at once. Nothing in the scope above changes:
the PID walk names the one asking, and its scope is its own children, so two
supervisors never see each other's children (`unknown_agent` across).
Limits stay per supervisor: `maxRunning` counts one supervisor's children,
so two supervisors may each fill it in the same project. The machine-checkable
half is `supervisors` in `agentControl.fixtures.json`
(`supervisor::several`).

- **A key is an address.** `spawn { role: "supervisor", supervisorKey }`
  (also the link's `supervisors.spawn { key }` and the frontend's
  `AgentConfig.supervisorKey`) names a supervisor. Format
  `^[a-z0-9][a-z0-9-]{0,47}$`, not shaped like an agent id (`agent-<n>`)
  (`supervisor_key_invalid`), unique among live
  supervisors (`supervisor_key_in_use`); a worker spawn carrying one is
  `invalid_params`. `list_agents` shows `supervisorKey` on every entry, and
  `send_input { supervisor: key }` instead of `agentId` reaches the live
  supervisor carrying it, resolved at the call (`unknown_supervisor` when none
  does). A supervisor caller using a key still ends at `ensure_child`.
- **One run folder, one live supervisor.** Resuming a run folder a live
  supervisor works in (its `repoPath`) is refused in `admit_spawn` with a
  sentence the frontend recognises (fixture `supervisors.runDirInUse`), for
  every route: the tile, the runs panel, a restored agent
  (`resume_interrupted_agent`, which then keeps its offer). The frontend checks
  the same before it calls Rust; Rust is the backstop.
- **The key survives a resume.** `admit_spawn` writes `<run>/supervisor.json`
  (`{ "key": … }`) on every launch, and a resume without a key of its own takes
  the run's. The key and the run folder are checked again when the started
  process is entered into the manager, so two launches in the same moment
  cannot both win.
- **A Project Manager's key is bound to its folder.** A promoted run
  has its key and folder in the Rust-owned
  registry `<app_data_dir>/supervisor-managers.json`, not only in
  `supervisor.json`, which the manager itself can write. `admit_supervisor`
  makes the two one thing: resuming the folder runs under the manager's key,
  another key is `manager_key_mismatch`, a new supervisor naming the key
  becomes a resume of the folder, and an archived manager is
  `manager_archived`. The rules above still apply after that, so one folder
  still has one live supervisor. Fixture `launchKey` in
  `supervisorManagers.fixtures.json`.
- **Children follow a resumed supervisor.** It adopts the children of every
  earlier supervisor of its run folder (from the restart file, the kept run
  results, and for a restored agent the id it had): `spawnedByAgentId` old →
  new on the live agents, in the restart file and in the run results, then the
  Tauri event `supervisor-children-adopted` `{ fromIds, toId }` for the
  frontend's list. Without this a resumed supervisor saw none of its earlier
  children.
- **Shared files are written under a lock.** The run's skill plugin folder is
  rebuilt from today's approvals on every launch (a resume found the old links
  and failed), and the trust entries in `~/.claude.json` are written under one
  process-wide lock, so two supervisors starting together keep both.

### Methods for a supervisor caller

| method            | what a supervisor gets                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `list_projects`   | only projects its policy allows, each with a `supervisor` block, plus one model `catalog` |
| `spawn`           | `headless` required; provider and model default (below); checked against the policy       |
| `list_agents`     | its own children only, live and finished                                                  |
| `read_output`     | its own children only                                                                     |
| `await_result`    | its own children only                                                                     |
| `kill`            | its own children only                                                                     |
| `remove_worktree` | its own children only                                                                     |
| `dismiss`         | its own finished children only                                                            |
| `send_input`      | its own children only                                                                     |

- **Own children only.** Any other agent id, including the supervisor's own,
  an agent the human started and another supervisor's child, is answered with
  `unknown_agent`, the same as an id that does not exist. A supervisor learns
  nothing from an id outside its scope, not even whether it exists.
- **Typing reaches its own children only.** Typing into a console can answer
  a permission prompt, which is the reason agents were kept off the socket in
  the first place. v1 refused `send_input` outright, and the human ended up
  copying every question and every correction between the supervisor's window
  and the child's. Now a supervisor types into its own interactive children
  (headless ones still answer `headless_no_stdin`), and the launch prompt
  (`supervisorLaunchPrompt.ts`, "Working with your agents") draws the line:
  read-only commands, the project's tests, lint and build, and edits in the
  child's own folder it answers itself; anything destructive, outward-facing,
  costly, a change of scope or a design choice goes to the human first, in the
  supervisor's own conversation, and the supervisor types the answer in. That
  line is an instruction to a model, not a check in Rust: what a child may do
  at all is still decided by the permission mode the policy gives it.
- **Refused parameters.** `role` on a supervisor's `spawn` is `invalid_params`:
  the field does not exist for that caller. `permissionMode` is
  `outside_supervisor_scope`: the policy names the mode, the supervisor does
  not get to pick a different one. A missing `headless` is `invalid_params`.
  Nothing is filled in from launch defaults.
- **Provider and model default to what the supervisor is told to pick.**
  Without `provider`, the project's `balancing.next` is taken, else the
  supervisor's own provider when the project allows it, else the first one it
  allows (`Dispatcher::preferred_provider`, shared with link jobs). Without
  `model`, the allowed model with the smallest `rank` is taken, the first in
  the provider's order on a tie; unranked models are never picked, and none
  ranked is `supervisor_denied` with `no_ranked_model`
  (`policy::smallest_ranked_model`, also what a link job runs).
- **A large model needs a stated reason.** A resolved model of rank 3 or more
  (`reasonRequiredFromRank`) without a non-blank `modelReason` is
  `supervisor_denied` with `model_reason_required`, and the message names the
  smaller allowed models. This runs before `checkSpawn`, on models the policy
  allows only; a model outside it gets `checkSpawn`'s own reason. The rules
  are `modelChoiceRules` / `modelChoice` in `supervisorPolicy.fixtures.json`,
  twinned in `policy::resolve_model` and `resolveSupervisorModel`. It exists
  because a supervisor picked the second-largest model for driving a browser
  and reading text: the old prompt mapped "hard" to "large", and nothing on
  the server asked. Every spawn that goes ahead is appended to
  `<app_data_dir>/supervisor-spawns.jsonl` (0600): supervisor, agent, project,
  provider, model, rank, `picked` (the server chose) and `modelReason`, so the
  choice can be read afterwards. The frontend never sees the reason.
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
{ balancing: null | { windowDays: number, next: string | null,
                      providers: [{ id, weight, spawns, targetPercent,
                                    actualPercent: number | null }] },
  providers: [{ id, permissionMode?: string, models: "all" | string[] }],
  allowInteractive: boolean, runningChildren: number, maxRunning: number }
```

and beside `projects`, once per answer:

```
catalog: { [provider]: [{ id, label, rank: number | null,
                          useFor?: string, relativeCost?: number }] }
```

The catalog holds every model the listed projects allow, each described once;
a project names its models by id, or `"all"` when it allows every model the
catalog lists for that provider. `permissionMode` is left out for the
provider's own default. This replaced a shape that repeated every model's
label and rank in every project: with fifteen projects it reached 64 KB, was
cut off before `balancing` (then the last key), and the supervisor chose
without it. Now fifteen projects with six providers of ten models each stay
under 16 KB (`a_full_supervisor_project_list_stays_small`), `project` narrows
the answer to one entry, and the MCP server sends it as compact JSON. Keys are
sorted on the wire, so `balancing` precedes `providers` and `catalog` precedes
`projects`.

`rank` orders models by size within a provider (higher is bigger); `null` is
a model without a known size, which the supervisor does not pick by default.
`useFor` and `relativeCost` come from the provider config
(`dynamic-providers/README.md`) and go into the launch prompt as well.

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
tells the supervisor to take `next`, then the smallest model there that fits
the kind of task,
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

**Finished children stay in its list.** A finished agent leaves the manager's
live list at once. A supervisor's `list_agents` therefore adds its finished
children whose result is still kept (`runResultsKept`), after the live ones,
newest first, with `status: done|error`, `finishedAt` and `answerPreview` (the first
300 Unicode characters of the last ANSWER line, or null when absent). The
`await_result` result retains its existing `idle|error` status. Before
this, a supervisor whose children had all finished saw an empty list and
concluded the IDE had restarted. A child leaves the list when the supervisor
calls `dismiss`, when the result falls out of the store, or when the
supervisor's card is cleared. External callers still get the live list only.

### Pingback

A supervisor is an interactive CLI: it acts on input. `await_result` wakes it
while it waits on a child, but once it has handed its turn back to the human
nothing told it that a child ended. So Rust types a notice into its console
when its children finish (`control_socket/pingback.rs`), through the same
path as `send_input` (bracketed paste when the TUI asked for it, then `\r`):

```
[AuricIDE] Finished: agent-27 "Fix parser" (idle), agent-35 "Docs pass" (error). Read each
result with await_agent_result, remove its worktree with remove_worktree if it ran in one,
then clear it with dismiss_agent. This notice comes from the IDE, not from the human.
```

- **Batched per wave.** Every notice costs the supervisor a turn, and a
  fan-out of headless children ends within seconds. One notice per supervisor
  once no further child has finished for `pingbackQuietMs` (3 s), or
  `pingbackMaxDelayMs` (15 s) after the first finish at the latest.
- **Only to a listening supervisor.** Running, interactive, still in the
  manager. A finished, queued or headless supervisor gets none; its children
  stay in its `list_agents` for whoever asks.
- **The source is the result store.** `RunResults::record_finished` hands
  every booked result of a supervisor's child to its subscribers, exactly
  once per agent (a kill's verdict stands, the later exit is not news).
- **Not into a half-typed message.** Typed while the human has a draft in
  the supervisor's input box, the notice would join it and the Enter would
  submit both. So the human's own keystrokes (`shell_write`,
  `agent_send_message`) are observed in `agents/human_draft.rs`: printable
  text opens a draft, Enter or Ctrl-C closes it. While a draft is open the
  wave waits, and what finishes meanwhile joins it. The draft is read from
  keystrokes, not from the screen, so one cleared another way (Esc, deleting
  it) is not seen; a draft holds for `pingbackDraftHoldMs` (3 min) after its
  last keystroke at most, so a forgotten one cannot keep the supervisor
  uninformed.

### `await_result`

**Look, do not loop waiting.** Default waitSeconds is 0; the socket clamps it
at 15 seconds. For headless children, the supervisor ends its turn and waits
for the existing IDE finish pingback. For interactive children or as a fallback,
it runs Bash `sleep N` with `run_in_background: true`, ends its turn, and on the
completion notification calls `await_agent_result` with `waitSeconds: 0`.
If neither done nor waiting for input, it starts another background timer.
Interactive checks also use `untilInput: true` and the last read `outputBytes`
as `sinceOffset`. Silence is measured since the last cleaned console output,
across checks, so `waitSeconds: 0` can detect a turn that has gone quiet.
The supervisor's restricted Claude launch always exposes
Bash with `Bash(sleep *)`; other commands still need explicit skill/tool grants.

The existing finish subscriber sends process exits directly into the supervisor
session; it does not observe interactive input pauses. Follow-up ticket
`88d571fd` records the missing event path, delivery failure handling, and the
design for per-turn input notifications. The older
headless notification targets the human inbox and excludes supervisor children;
it was never a message into the supervisor session.

Waits up to `waitSeconds` for the agent to finish, then answers:

```
{ done: false, agentId, status, outputBytes, waitingForInput }  // still running when the wait ended
{ done: true, result: RunResult }                               // finished, now or earlier
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
- `untilInput: true` also ends the wait, unfinished, once an interactive agent
  waits on an answer: its last clean console lines show a prompt
  (`awaitingInput.fixtures.json`, the same patterns the attention model uses,
  read by `agents/awaiting_input.rs` and `awaitingInput.ts`), or its console
  has been silent for `inputQuietSeconds` (**20**) — an agent that ends its turn
  on a question in prose prints nothing more. Then `waitingForInput` is `true`.
  Only output past `sinceOffset` can wake the call, so a caller that passes
  the `outputBytes` it last read is not woken twice for the same question. A
  headless agent never wakes it. The silence check counts from the start of
  the call, so a console that was already quiet takes those 20 s to report.

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

### Tools (`auric-mcp --supervisor`)

| tool                 | socket method     |
| -------------------- | ----------------- |
| `list_projects`      | `list_projects`   |
| `spawn_agent`        | `spawn`           |
| `list_my_agents`     | `list_agents`     |
| `read_agent_output`  | `read_output`     |
| `await_agent_result` | `await_result`    |
| `send_agent_input`   | `send_input`      |
| `kill_agent`         | `kill`            |
| `remove_worktree`    | `remove_worktree` |
| `dismiss_agent`      | `dismiss`         |

## Error codes

`invalid_request`, `unknown_method`, `invalid_params`, `unknown_agent`,
`agent_not_running`, `headless_no_stdin`, `provider_denied`,
`frontend_unavailable`, `forbidden_agent_caller`, `supervisor_denied`,
`outside_supervisor_scope`, `unknown_project`, `supervisor_key_invalid`,
`supervisor_key_in_use`, `unknown_supervisor`, `internal`.

- `supervisor_denied`: the supervisor policy refuses this spawn. The error
  body carries `reason`, a stable key from `supervisorPolicy.fixtures.json`.
- `outside_supervisor_scope`: a supervisor asked for something its scope never
  includes (a `permissionMode` of its own).
- `unknown_project`: `list_projects { project }` matched nothing the caller
  may see. For a supervisor that includes a project its policy does not allow.
- `supervisor_key_invalid`, `supervisor_key_in_use`, `unknown_supervisor`: see
  "Several supervisors".

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
| `dismiss_agent`      | `dismiss`         |

Each tool returns the result as JSON text; a socket error becomes a tool error
whose message names the code and the message, e.g.
`headless_no_stdin: agent-3 runs headless and does not read input`.

Register it for Claude Code with:

```bash
claude mcp add --scope user auric-control -- node <app resources>/auric-mcp/server.mjs --control
```
