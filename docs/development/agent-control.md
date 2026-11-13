# Agent control and external integrations

[Developer guide index](README.md) · [Documentation index](../README.md)

Control socket, Supervisor Link and externally tracked runs. Contracts: [agent control](../design-agent-control.md), [Supervisor Control API](../supervisor-control-api.md), [external agents](../design-external-agents.md).

## Steering the fleet from outside (`auric-mcp --control`)

A client outside the IDE (another Claude Code session, a script) can list every
agent across all projects, read its console, type into it, kill it and spawn a
new one. The contract is [docs/design-agent-control.md](../design-agent-control.md), the machine-checkable
half `src/lib/agents/agentControl.fixtures.json` (read by Rust and TS — change
it first), the reasoning ADR 0003.

- **Path.** `auric-mcp --control` (tools in `src/mcp/tools/agentControl.ts`)
  talks NDJSON over `<app_data_dir>/control.sock`, served by
  `src-tauri/src/control_socket/`. List, read and type are answered in Rust;
  spawn and kill go to the frontend (`controlBridge.ts`) so they take the same
  store actions as the UI buttons. The bridge reports `control_ready`; requests
  carry `expiresAt` so a timed-out spawn is never carried out late.
- **IDE agents are refused at the socket, whatever the provider.** Rust reads
  the peer PID and walks its parents; a running agent among them gets
  `forbidden_agent_caller`, for every method but `raise_question`, which books a
  question on that same agent (`admit_control`; the supervisor link has no such
  door). The `AURIC_IDE_AGENT=1` marker on every agent only
  makes `--control` stop early — Codex, for one, does not pass arbitrary env
  vars to MCP servers, so the marker alone would not hold.
- **Console text is cleaned on append** (`agents/output_buffer.rs`, stateful
  `AnsiStripper` in `ansi.rs`): 256 KiB per agent, 20 finished kept, offsets
  count cleaned bytes. A redrawing TUI still yields fragments, not a transcript.
- **Enter is `\r`** (`TERMINAL_ENTER`, `src/lib/agents/terminalKeys.ts`). `\n`
  only adds a line in Claude Code's input box and never submits — every UI send
  path used it until the first real run showed it.
- **A message is a bracketed paste, an answer is keystrokes**
  (`agents/terminal_input.rs`). Text over 32 bytes or with a line break, sent
  as plain keystrokes, is a burst Claude Code treats as its own paste: the
  `\r` is swallowed (nothing submits) and text is lost where the burst spans
  two reads. So `send_input` and the IDE composers (`agent_send_message`) wrap
  it in `ESC[200~`…`ESC[201~` when the TUI asked for that (`ESC[?2004h`,
  tracked in `OutputBuffers`). Raw terminal keystrokes stay on `shell_write`.
- **`list_projects` explains each project**: `initialized` (spawn needs
  `.auric/project.db`), `runningAgents`, and a `description` — the one the
  user set on a starred tile ("Set description…" in Quick Access), else the
  README's first paragraph, `package.json`, `Cargo.toml`.
- **Dev and installed build share the socket path.** Whoever starts first
  serves it; the second logs and runs without one. Real-app checks:
  `node scripts/probe-agent-control.mjs`, and
  `cargo test control_socket_against_running_app -- --ignored --nocapture`.

## The supervisor link — the Supervisor Control API (`supervisor_link/`)

A client (any local app) holds one WebSocket to the IDE instead of a set of
MCP tools: start a supervisor, see the supervisor tree and its consoles live,
type and submit, stop agents, read and propose JSON documents, and run jobs in
projects. Integrators read [docs/supervisor-control-api.md](../supervisor-control-api.md) (setup, every
method, limits, a minimal client). The contract is
[docs/design-supervisor-link.md](../design-supervisor-link.md), the
machine-checkable half `src/lib/agents/supervisorLink.fixtures.json` — change
it first. AuricIDE knows no client, no document format and no job kind: all of
that is per-project configuration.

Job cancellation records intent before the dispatcher stop. A rejected stop
is returned and reported to the inbox; ticks retry it while the agent remains
live. A launched job without a worktree stays tracked until an ending is
observed, then fails `internal`. Its null worktree is immutable launch evidence.
App restart still marks active jobs `interrupted`; dispatcher observation does
not establish a stronger native process-termination guarantee.

- **A narrower door, not a new one.** WebSocket (`tungstenite`, sync) over
  `<app_data_dir>/supervisor-link.sock`, 0600. Agent work goes through the
  control socket's `Dispatcher` as an external caller after `Link` narrowed it
  to the **supervisor tree** (role supervisor, `spawnedByAgentId` set, or a
  job's agent). Agents the human started are `unknown_agent`. Both sockets
  share one dispatcher (`control_socket::dispatcher`).
- **Every IDE agent is refused at the socket**, supervisors included: same
  PID walk as `control.sock`, then one `error` message and close 1008.
- **Limits are a contract, not tuning** (fixture `limits`): 16 connections,
  64 waiting requests per connection, 10 s handshake and write timeouts; over
  one the answer is `busy` with the limit as `reason`. A `rev` is a commit id,
  branch or tag name only (fixture `revs`), never a revision expression.
- **`supervisors.spawn` is the tile's path**, and so is the control
  socket's `spawn { role: "supervisor" }` (which used to skip it):
  Rust sends the control request `spawn_supervisor`, the bridge calls
  `spawnLinkedSupervisor` (launch prompt, instructions, policy; never the
  provider picker). Its codes pass through raw (`via_frontend_raw`).
- **Several supervisors are addressed by key.** `supervisors.spawn { key,
if: "existing" }` is idempotent (a lost race answers the winner);
  `agents.read/send/kill { supervisor: key }` resolve at call time;
  `events.subscribe { supervisors }` follows a whole subtree, later children,
  grandchildren and the jobs it requested (`jobs.create { supervisor }`,
  which also pings that supervisor when the job ends) included;
  `supervisors.list` and `LinkAgent.rootSupervisorId` spare clients the
  chain walk. A key is an address, not a permission. Fixtures
  `supervisorKeys` and `subtree`.
- **Events are polled, not hooked**: a per-connection loop diffs the tree, the
  output buffers and the job register every 250 ms (`subscription.rs`).
  Requests run in order on a worker thread, so a 30 s spawn does not hold
  events back; a subscription takes effect when its response is sent.
- **Documents are files in the projects**, described as document types
  (name, globs, optional index file, name/description fields, schema path) in
  `<app_data_dir>/supervisor-link.json` (Settings → Supervisor → Supervisor
  link, Rust-owned, version 3, fails closed; versions 1 and 2 migrate on
  read). Types and job kinds are global `defaults` every listed project
  inherits; a project entry only overrides (same name), extends, disables or
  sets `inherit: false`. The link acts on the merged result
  (`policy::resolve`, fixture `resolution`), never on the raw file. The content is
  opaque JSON. The link never writes into a working tree:
  `documents.propose` commits on a new branch `auric/proposal/…` built from
  `HEAD` with git2, checked against `baseHash`, and drops one inbox
  notification. `documents.get` with `rev` reads a branch and says
  `merged: false` for a preview. Binary files a document refers to are a
  type's `assets` globs, read-only through `documents.asset` (`assets.rs`,
  base64, `maxAssetBytes` default 2 MiB); the path a symlink resolves to must
  match an asset glob too, or one visible name would open any file.
- **Jobs are headless agents in a worktree, under the supervisor policy**
  (`jobs.create { project, kind, payload }`, `job_runner.rs`,
  `control_socket/link_spawn.rs`). Only kinds the project lists run; the agent
  follows the kind's instructions file (the project's own wins; else a
  `globalInstructions` file under `<app_data_dir>/job-kinds/`, read by Rust
  into the prompt, `instructions.rs`) and may write only its `writes` globs.
  Provider and model are the supervisor's rule (balancing `next`, smallest
  ranked model), never the client's. The payload goes into the prompt fenced
  and named as data. A 2 s tick follows each job to `job.finished`/`failed`,
  committing leftovers in writable paths. How the agent ended comes from the
  booked run result, not the agent list (a finished agent leaves it at once):
  an error exit or an outside kill is `agent_failed`. A runaway counter
  (default 20 per 24 h, optional per project; 0 is `reason: disabled`)
  answers `quota_exceeded`; the register (`supervisor-link-jobs.json`)
  survives restarts.
- **Policy changes are proposed, never made, by a supervisor.** MCP
  `link_policy_get` / `link_policy_propose` (control socket, supervisor
  callers only; external callers and so the link socket are refused) store a
  pending proposal with a diff and raise an inbox ask with Apply / Discard
  (`proposals.rs`, fixture `proposals`). Only the Tauri command
  `supervisor_link_proposal_decide` behind that button applies it, onto the
  policy it was made against; 24 h expiry; every outcome in an audit log.
- Real-app check: `node scripts/probe-supervisor-link.mjs [--watch 20]`.

## External agents: runs the IDE tracks but does not run

A supervisor can tell the IDE about a run it has no process for, such as a
sandbox: `register_external_agent`, `stop_external_agent`, `list_external_agents`.
The run shows on the supervisor's timeline and books into the usual two records.
The contract is [docs/design-external-agents.md](../design-external-agents.md), the machine-checkable half
`src/lib/agents/externalAgents.fixtures.json` (read by Rust and TS — change it
first).

- **Not in the agent list, on purpose.** `<app_data_dir>/external-agents.json`
  (`external_agents/`, serialised by a file lock, so two builds cannot lose an
  entry) holds them. No limit, watchdog, attention count, kill or
  console needs an exception, and a restart cannot mark them interrupted.
- **Owned by the run folder**, not the agent id, so a resume keeps them with no
  adoption. Only a supervisor calls these, only for its own entries.
- **The key is `externalId` + `runId`,** so a sync can repeat every call. A
  stopped key stays stopped; the first stop wins and books once. `booked: false`
  means the entry is final but the history write failed; every later call and the
  next app start try again, and the row id comes from the entry, so that cannot
  double-book.
- **`durationMs` is registered time on these rows.** The real runtime is
  `activeMs`, as reported, absent when unknown and never 0. Anything that sums time
  goes through `usageRunMs`; a billing reader needs the same rule.
- **Stale is a reading, not a state:** 26 h on or 72 h off with no call reads
  "Stale?". The human can close a live entry from its row, which books it with no
  runtime; a stale one is closed at its last sign of life, not now (without force, so a
  stop that lands meanwhile is never overwritten).
- **A detached process stops a run with a token, not a PID.** `external_register`
  returns a capability token (`capability_tokens/`, [docs/design-capability-tokens.md](../design-capability-tokens.md),
  fixtures `capabilityTokens.fixtures.json`): random, shown once, stored as a SHA-256
  only, scoped to `external_stop` of that one run, revoked when the run ends. Any
  external caller may send it; it never registers, lists, touches another run or
  forces. The module is generic: a new scope is a `kind` and action names, no new
  plumbing.
- **`force` corrects, audited.** The owner (stop) or the human (close) may close a
  stale run or correct a final run's end; each change appends the old values to
  `corrections`, the usage row is replaced and the task log gets a `corrected`
  line (last line per `agentId` wins). Without `force` a second stop is a no-op.
