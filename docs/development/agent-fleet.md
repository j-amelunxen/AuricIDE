# Agent fleet and terminal UI

[Developer guide index](README.md) · [Documentation index](../README.md)

Fleet visibility, attention, detached windows and console behavior. See also the [module specification](../spec/modules/agent-fleet.md).

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
- **Headless runs are silent by nature.** `claude -p` (every conductor
  agent) prints nothing until it ends, so for `agent.headless` the clock is
  runtime since launch against `HEADLESS_STALL_MS` (45 min), not silence.
  Below it the card reads "Working · headless"; past it "Long run?", and
  never an Enter nudge — the CLI does not read stdin.
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

## The terminals in a window of their own

The terminal modal can be detached into a second OS window (label `agents`,
route `/agents`) and docked back, so the fleet can sit on a second monitor. A
second webview is a second JavaScript heap: its own store, its own terminal
mirrors, and none of the raw output from before it opened. The contract is
[docs/design-agent-window.md](../design-agent-window.md), the machine-checkable half
`src/lib/agents/agentWindow.fixtures.json` (read by Rust and TS — change it
first).

- **The main window stays the truth.** The agent window gets the agent list
  and the screen so far from it (`agentWindowHost.ts` → `agentWindowClient.ts`),
  live output straight from Rust's `agent-output` broadcast, and sends typing
  and resizes straight to Rust. Stop, clear, the merge offer and saving a
  scratch go back to the main window as an action, because they touch tickets,
  goals, worktrees and the project folder.
- **One writer per field.** In the agent window only the roster writes
  `agents`. It derives no `awaitingInput` or status of its own — it lacks the
  output from before it opened and would classify the same agent differently.
  Its log path is `appendAgentTerminalChunks`, never `appendAgentLogBatch`.
- **Nothing twice, nothing lost at the seam.** Rust stamps every
  `agent-output` batch with `endOffset`. A snapshot names the offset it
  reaches; the client buffers batches until it has one and drops everything at
  or below that offset (`agentWindowGate.ts`). The host flushes its output
  batcher before it serializes, or the offset would claim more than the screen
  holds.
- **Detached means one place.** While the window is open the modal does not
  open in the main window; selecting an agent there brings the agent window
  forward on that agent.
- **Closing a window ends no work.** Only the main window's `Destroyed` cleans
  up agents, and it takes the agent window along. Before this, any window
  closing booked every running agent as killed.
- **Three things are scoped to `main` on purpose:** `ui_pong` (a healthy
  second window must not hide a stalled main one), Cmd+W (closes the focused
  agent window, never an editor tab from there), and the control bridge (a
  second listener would carry out every spawn and kill twice).
- **PTY geometry crosses the window boundary.** Rust emits `agent-pty-resized`
  only on a real change; a size that arrived that way is never sent back as
  `shell_resize`.

## The console feed reads like a group chat, on purpose

The Agent Console's feed (`ActivityFeed.tsx`) interleaves every agent, and with
seven agents on three repositories that was a log file scrolling past. It now
borrows exactly the mechanisms messaging apps use to keep a busy channel
readable, and nothing else — the full reasoning and the numbered rules are in
[docs/design-console-lanes.md](../design-console-lanes.md). What to keep straight when touching it:

- **Oldest first, newest at the bottom, follow stops when you scroll.** Rows
  arriving while the reader is scrolled up are counted into a "N new ↓" pill;
  Pause is a separate, explicit freeze. Reading direction and growth direction
  must agree, or the row being read moves under the eye.
- **One header per sender run** (`groupBySender`, `lanes.ts`), the identity
  colour on the monogram only. A user's marker still wins the hue
  (`streamColorFor`); status colours stay with status.
- **Rows have a tier** (`feedTier`): a question is the only row that may
  shout, an outcome carries an icon, prose wraps in the UI face, a tool call is
  a quiet monospace line, and the human's own messages are the only bubbles.
- **Lanes are view state, not process state.** `mutedAgentIds`, `laneSeenAt`
  and `agentSentMessages` live in `agentSlice` beside parking, are cleared
  wherever parking is, and never change a count the header states. A muted
  lane still surfaces its questions and outcomes.
- **The rail's summary is heuristic first.** `describeRightNow` is the
  default; `laneSummaries` (a model's one sentence) exists only for the two
  moments a human acts — an agent starting to wait on input and an agent
  stopping — and the extract is shown before any polish lands
  (`laneSummarySubscriber.ts`). A rolling LLM summary was rejected: a wrong
  line is worse than a raw one.
- **The composer is the same wire as everywhere else.** `sendAgentInput` is
  the one path to an agent's stdin; it records the sent text itself, so every
  caller's message shows up in the feed and a bare Enter nudge does not.
