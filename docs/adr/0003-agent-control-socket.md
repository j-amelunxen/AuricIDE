# ADR 0003: Agent control for external clients over a local socket

## Status

Accepted

## Context

The agent fleet could only be steered from inside the IDE window. Someone
working in another Claude Code session, or a script, had no way to see which
agents run, read what they print, answer them, stop them or start a new one.
The one MCP tool near this, `request_agent_launch`, only puts a button in the
inbox. It needs a goal, and it needs a click or a grant.

Three facts made this more than a missing tool:

- Agents live in the Rust `AgentManager`, app-wide. The MCP server is a
  separate process, and its only link to the app was SQLite files the app
  watches.
- Rust did not keep any console output. It sent each batch to the webview and
  dropped it. Only the frontend store held logs.
- Every MCP server is bound to exactly one project (ADR 0002). A fleet view
  spans all of them.

## Decision

- **Rust serves a unix socket** at `<app_data_dir>/control.sock` (mode 0600,
  NDJSON). It answers list, read, type and list-projects itself. It routes spawn
  and kill through the frontend store, so they take the same path as the UI
  buttons.
- **Rust keeps a bounded output buffer per agent**: 256 KiB, plus the buffers of
  the 20 most recently finished agents. The socket reads from that buffer.
- **A separate MCP mode, `auric-mcp --control`**, has no project binding and
  offers only the control tools. External clients register it themselves
  (`claude mcp add --scope user auric-control …`).
- **IDE-spawned agents never get it.** Their bindings stay `--project-root`,
  and `--control` refuses to start when `AURIC_IDE_AGENT` (set on every agent
  process) or `AURIC_AGENT_CWD` is set. Typing into a
  console can answer a permission prompt, so one agent must not be able to
  approve another agent's actions.

A command queue in SQLite, like the notification inbox, was the alternative.
It was rejected for two reasons. It cannot answer a read directly, and serving
console output through it would mean mirroring every agent's output into a
database all the time.

## Consequences

- The gate sits at the socket, not only in MCP. Rust reads each peer's PID
  and refuses the connection if a running IDE agent is among its ancestors.
  That works whatever the provider does with the environment. Codex, for
  example, does not pass arbitrary variables to MCP servers, so the
  `AURIC_IDE_AGENT` marker alone would not reach them. The marker remains as
  the early refusal in `--control`.
- What the check cannot see is a process an agent has fully detached (double
  fork, reparented to `launchd`). Doing that takes deliberate evasion. The
  socket is mode 0600, which keeps other users out.
- Spawn and kill need a live webview. Without one, they time out after 30 s
  with `frontend_unavailable`. List, read and type work without one.
- The console text is cleaned as it is appended: escape sequences are removed
  even when split across output batches, stray control characters are dropped
  and carriage returns become line breaks. It is still not a transcript,
  because a TUI that redraws itself produces repeated fragments.
- The protocol is twinned: `src/lib/agents/agentControl.fixtures.json` is read
  by both the Rust parser and the TypeScript client. Change the fixtures first.

## Verification boundary

Unit and socket tests on both sides run against the fixtures. The TS client is
also tested against a mock socket server. Only
`scripts/probe-agent-control.mjs` and the ignored Rust test
`control_socket_against_running_app` touch a running app, and neither can
drive the Tauri window itself.
