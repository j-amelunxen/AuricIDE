# The agent terminals in a window of their own — design and contract

Status: contract for the build (2026-10-12). Sections marked _rule_ are the
invariants the tests hold; everything else is the reasoning. The
machine-checkable half is `src/lib/agents/agentWindow.fixtures.json`, read by
Rust and TypeScript — **change it first**.

## The problem

The agent terminals (tab strip plus the 2×2 grid) are a modal inside the one
window the app has. With two monitors there is no way to put the fleet on the
second one and keep the editor on the first. Stretching one window across both
displays depends on a macOS setting ("Displays have separate Spaces") the app
cannot control, and it would run the bezel through the middle of the grid.

So the terminals can be **detached into a second OS window**, and docked back.

Out of scope: dragging a single tab out of a window, more than one agent
window, remembering the window's position across launches.

## What makes this harder than opening a window

A second webview is a second JavaScript heap. Three facts follow, and the
design is the answer to them:

- **The store is not shared.** Zustand lives in memory per webview.
- **The terminal is fed from the store, not from Rust.** `AgentXterm` reads
  `agentLogs` and the headless mirror (`agentMirror.ts`); both live in the
  main window's heap.
- **Rust does not keep the raw stream.** `output_buffer.rs` holds cleaned
  text only. A window that opens late can get the screen so far from nowhere
  but the main window.

And four places assumed one window: `WindowEvent::Destroyed` booked every
agent as killed whichever window closed, `ui_pong` carried no window identity,
Cmd+W was a global event, and PTY geometry was agreed through an in-process
listener.

## Shape

The main window stays the single source of truth. The agent window is a thin
view of it.

```
              agent-output (global broadcast, stamped with endOffset)
  Rust ──────────────────────────────┬───────────────────────────┐
    ▲   shell_write / shell_resize   ▼                           ▼
    │                         main window                  agent window ("agents")
    └───────────────────────   store (truth)   ── roster ─▶  own store (view)
                               agentWindowHost ── snapshot ▶ agentWindowClient
                                               ◀── action ──
```

| What                                   | Comes from              | Why                                                         |
| -------------------------------------- | ----------------------- | ----------------------------------------------------------- |
| Agent list, status, names, attention   | main window (roster)    | One classification of every agent, finished ones included   |
| The screen so far                      | main window (snapshot)  | The only place the raw history exists                       |
| Live output                            | Rust (`agent-output`)   | Already a global broadcast; no relay, no extra hop          |
| Typing, PTY resize                     | straight to Rust        | No bookkeeping attached                                     |
| Stop, clear, merge offer, save scratch | main window (action)    | They touch tickets, goals, worktrees and the project folder |
| Grid layout                            | each window's own store | View state; handed over once on detach and once on dock     |

## Vocabulary

- **Host** — the main window's side (`agentWindowHost.ts`).
- **Client** — the agent window's side (`agentWindowClient.ts`).
- **Roster** — the host's `agents` array plus the error digest of each failed
  agent.
- **Snapshot** — one agent's serialized screen with the geometry it was laid
  out for and the offset it reaches.
- **Offset** — raw UTF-8 bytes an agent has emitted, counted in Rust.
  `endOffset` on an `agent-output` batch is the count including that batch.
- **Synced** — the client has a screen for an agent that live batches can be
  appended to.

## Rules

1. _rule_ — **One writer per field.** In the agent window only the roster
   writes `agents`. The client derives neither `awaitingInput` nor
   `currentActivity` nor a status of its own; it lacks the output from before
   it opened and would classify the same agent differently.
2. _rule_ — **History is a picture, not a replay.** The client seeds its own
   mirror from the host's snapshot (`seedAgentMirror`) and from then on writes
   live batches only. `attachAgentStream` takes its snapshot path for a seeded
   mirror, exactly as it does for a resized one.
3. _rule_ — **Nothing twice, nothing lost at the seam.** Until an agent is
   synced the client buffers its batches. A snapshot reaching offset `S`
   discards every buffered batch with `endOffset ≤ S` and applies the rest.
   An agent whose first batch seen starts at offset 0 is synced without a
   snapshot. Before answering a snapshot request the host flushes its output
   batcher, so the screen it serializes really does reach the offset it names.
4. _rule_ — **Detached means one place.** While the agent window is open the
   main window does not open the terminal modal. Selecting an agent there —
   panel, console, Cmd+Shift+A — brings the agent window forward and shows
   that agent in it.
5. _rule_ — **Closing a window ends no work.** Closing the agent window
   removes a view: no confirm, no kill, no number in the main window changes.
   Only the main window's `Destroyed` cleans up agents, and it takes the agent
   window with it.
6. _rule_ — **Stopping asks where it was clicked.** "Stop this agent?" is
   asked in the agent window. The merge offer that may follow belongs to the
   project and is asked in the main window, which comes forward for it.
7. _rule_ — **PTY geometry crosses the window boundary.** Rust remembers each
   session's size and emits `agent-pty-resized` only on a real change. Both
   windows feed it into `resizeAgentMirror`; a size that arrived this way is
   never sent back as `shell_resize`. "Last fit wins" is unchanged — it now
   reaches across windows.
8. _rule_ — **The second window is not watched for freezes.** `ui_pong`
   counts only for `main`; a healthy agent window must not hide a stalled main
   window.
9. _rule_ — **Cmd+W closes what is focused.** With the agent window focused it
   closes that window and no editor tab.

## Messages (frozen)

Names and example payloads are in the fixtures; `agentWindow.contract.ts` is
the validator both windows use (`parseWindowMessage`).

| Direction     | Event                           | Payload                                       |
| ------------- | ------------------------------- | --------------------------------------------- |
| Rust → all    | `agent-output`                  | existing fields plus `endOffset`              |
| Rust → all    | `agent-pty-resized`             | `{ agentId, rows, cols }`                     |
| Rust → all    | `agent-window-state`            | `{ open }`                                    |
| client → host | `agent-window:hello`            | none                                          |
| host → client | `agent-window:welcome`          | roster plus `activeAgentId`, `gridCells`      |
| host → client | `agent-window:roster`           | `{ agents, errorDigests }`, throttled         |
| client → host | `agent-window:snapshot-request` | `{ agentId }`                                 |
| host → client | `agent-window:snapshot`         | `{ agentId, data, rows, cols, endOffset }`    |
| host → client | `agent-window:show`             | `{ agentId }`                                 |
| host → client | `agent-window:host-ready`       | none; the client answers with a fresh `hello` |
| client → host | `agent-window:action`           | `kill`, `dismiss`, `save-scratch`, `dock`     |

Commands: `open_agent_window` (creates, or shows and focuses),
`focus_agent_window`, `focus_main_window`.

The window is created in Rust (`WebviewWindowBuilder`), which needs no ACL
permission; its label is covered by `capabilities/agent-window.json` so the
webview may listen to events at all.

## What is deliberately not solved

- **Memory.** The agent window keeps its own raw log (same caps as the main
  window) and its own mirrors. Measure with `memory_report` before slimming.
- **Scrollback before the snapshot.** The snapshot carries the mirror's
  scrollback (1000 lines), not the 2 MB raw log.
- **A reloaded main window** (a dev reload, or the crash boundary's reload)
  re-announces itself with `host-ready` and the client asks again. The main
  window comes back with no agents — nothing re-reads the running ones from
  Rust — and the roster is the only writer of the list, so the agent window
  empties with it, screens included. The agents keep running. Batches of an
  agent the roster does not name are dropped rather than buffered, so this
  costs screens, not memory. Making the main window re-adopt running agents
  after a reload would fix both windows at once and is its own change.
- **A snapshot that never arrives** does not hold the others up: the request
  times out (`snapshotTimeoutMs`), the next agent is asked for, and the one
  that timed out is asked for again later.
- **Other menu shortcuts** still act on the main window while the agent window
  has focus. Only Cmd+W is routed by focus.

## File ownership for the build

| Package      | Files                                                                                                                                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract     | this document, `agentWindow.fixtures.json`, `agentWindow.contract.ts`                                                                                                                                                                                            |
| Rust         | `src-tauri/src/agent_window.rs`, `lib.rs`, `ui_watchdog.rs`, `agents/manager.rs`, `agents/types.rs`, `commands/terminal_commands.rs`, `capabilities/agent-window.json`                                                                                           |
| Frontend lib | `agentWindowHost.ts`, `agentWindowClient.ts`, `store/agent/agentLogOperations.ts`, `store/agentSlice.ts`, `store/agent/agentTypes.ts`, `terminal/agentMirror.ts`, `tauri/terminal.ts`, `tauri/agentEvents.ts`, `tauri/agentWindow.ts`, `hooks/useAgentEvents.ts` |
| UI           | `AgentTerminalModal.tsx`, `AgentTerminalWorkspace.tsx`, `app/agents/page.tsx`, `IDEOverlays.tsx`, `hooks/ide/useAgentAndCommandHandlers.ts`, `hooks/useIDEActions.ts`                                                                                            |
