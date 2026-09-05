# The console feed as lanes — design and contract

Status: contract for the build (2026-09-05). Sections marked _rule_ are the
invariants the tests hold; everything else is the reasoning.

## The problem

The Agent Console's activity feed interleaves every agent of every project
into one newest-first stream. With seven agents on three repositories it reads
like a log file scrolling past: every row re-states its sender, the sender's
name is cut exactly where it becomes distinguishable, a permission question
weighs the same as "Read file…", and the row being read moves down on every
tick. The reader has to demultiplex it in their head, which is the one cost
the console exists to remove.

## What we take from messaging, and what we leave

Group chats solved this shape of problem years ago. Three of their mechanisms
apply directly; the rest of the metaphor does not.

| Taken                                                       | Why                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Sender runs** — one header per run of consecutive rows    | Nine rows from one agent become one block with one name and one monogram                                                 |
| **Message hierarchy** — prose, system line, mention         | What the agent _says_ reads as a message; a tool call is a small system line; a question is the one thing that may shout |
| **Conversation list** — a rail with a live summary per lane | The "summary per lane that keeps changing" is the Messages sidebar: name, last line, unread, question badge              |
| **Mute**                                                    | Six translation agents flood everything; muting folds a lane to its summary while a question still gets through          |
| **Newest at the bottom, follow stops when you scroll**      | Reading direction and growth direction agree; a "N new ↓" pill brings you back                                           |
| **A composer** — talk to one agent                          | The wire to an agent's stdin already exists (`sendAgentInput`); the feed is the natural place to use it                  |

| Left out                            | Why                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Bubbles for agent output            | Bubbles separate _me_ from _them_. Only the human's own messages get one.                                                   |
| Faces                               | HIG: non-people get a monogram or symbol. Two letters on the identity colour.                                               |
| One column per agent as the default | Column layouts stop working past four columns; the fleet is regularly seven.                                                |
| A rolling LLM summary               | A wrong summary is worse than a raw line. The model speaks only at the two moments a human acts: a question and an outcome. |
| Monospace for prose                 | Prose wraps in the UI face at a readable measure; only paths and commands stay monospace.                                   |

## Vocabulary

- **Lane** — one agent's stream in the feed, identified by `agentId`. Its
  visual identity is a **monogram** (`agentMonogram`) on the agent's identity
  colour (`streamColorFor`, so a user marker still wins).
- **Sender run** — consecutive rows of the oldest-first feed from one agent.
  A run also breaks after `SENDER_RUN_MAX_GAP_MS` (5 min) of silence so a
  header reappears after a pause.
- **Tier** of a row — how much visual weight it gets:

  | Tier      | Event kinds           | Reads as                                        |
  | --------- | --------------------- | ----------------------------------------------- |
  | `mention` | `ask`                 | The agent needs you. Amber, bold, with an icon. |
  | `outcome` | `done`, `error`       | Finished / failed, with an icon.                |
  | `prose`   | `note`                | What the agent said. UI face, wraps, ≤ 3 lines. |
  | `system`  | `read`, `edit`, `run` | Small, muted, monospace, one line.              |
  | `you`     | `sent`                | Your message. The only bubble, right-aligned.   |

## Rules

### Feed

1. _rule_ — The feed renders **oldest first, newest at the bottom**. Both
   modes (`activity`, `output`).
2. _rule_ — **Follow** is on while the pane is scrolled within `FOLLOW_SLACK_PX`
   (24) of the bottom. New rows keep the pane pinned to the bottom. Once the
   reader scrolls up, follow is off; rows arriving while off are counted and
   shown in a "N new ↓" button that scrolls to the bottom and resumes follow.
   Pause (explicit freeze) stays as it is and is independent of follow.
3. _rule_ — Rows are **grouped into sender runs**; a run's header shows the
   monogram, the agent name (never truncated below 40 characters) and the
   project label muted. Each row carries its own clock time in the left
   column, so the header carries none. Rows inside the run do not repeat the
   sender.
4. _rule_ — Row order inside the feed never differs between the two modes for
   the same `(at, seq)`.
5. _rule_ — Rows carry the **tier** styling above. Colour is never the only
   signal: `mention` and `outcome` rows carry an icon with an accessible name.
6. _rule_ — Only the newest `FEED_RENDER_LIMIT` (300) shown rows are in the
   DOM; a "Show N earlier" control at the top reveals the next 300. Prose
   wraps, so row heights are not uniform and the old fixed-height window is
   retired.
7. _rule_ — The existing kind filters (All / Questions / Changes /
   Completions) keep their semantics. `sent` rows are visible under All only.
8. _rule_ — The `hint` prop keeps its place in the feed header.

### Lanes and the rail

9. _rule_ — The rail lists one lane per agent in `agents`, sorted by
   `CONSOLE_STATE_RANK` (yours, error, stalled, working, done), then name.
   The top row is **All lanes** with the fleet's total unread.
10. _rule_ — A lane row shows: monogram, name, project label, the phase chip
    (`consoleStateLabel`), the summary line, an unread badge, a question badge
    when the agent is `yours`, and a mute toggle.
11. _rule_ — The **summary line** is `laneSummaries[agentId].text` when one
    exists and is not stale, otherwise `describeRightNow(...)`. A summary
    of kind `ask` is stale once the agent is no longer awaiting input.
12. _rule_ — **Unread** = events with `at > laneSeenAt[agentId]`; with no seen
    mark every event counts. Selecting a lane marks it seen; while a lane is
    selected and follow is on, new rows are marked seen as they arrive.
13. _rule_ — Selecting a lane **filters the feed to that lane** and makes it
    the composer's target. Selecting it again, or All lanes, clears it.
14. _rule_ — A **muted** lane contributes only `mention` and `outcome` rows
    to the All-lanes feed. Selecting a muted lane shows all of its rows. Mute
    never changes any count the header states and never touches the process.
    Muted, selected, seen are session view state, like parking.

### Composer

15. _rule_ — With a running agent's lane selected, Enter sends the trimmed
    text plus `\n` through `sendAgentInput`; Shift+Enter inserts a newline; an
    empty send is a no-op. The sent text appears in the feed as a `you` row.
16. _rule_ — Without a lane, or with a stopped agent, the composer is disabled
    and says why in visible text ("Select a lane to message one agent" /
    "<name> has stopped").
17. _rule_ — `sendAgentInput` records a sent message only when the text,
    trimmed of whitespace and trailing newlines, is non-empty — a bare Enter
    nudge is not a message. Sent messages are session-only, capped at
    `MAX_SENT_MESSAGES` (200) per agent.

### Summaries

18. _rule_ — A lane summary is produced on exactly two transitions: an agent
    starts awaiting input (`ask`), and an agent stops (`done` / `failed`).
    One request per transition, never re-fired for the same transition.
19. _rule_ — The extract is always computed first and shown; the LLM polish
    (when `llmConfigured`) replaces it if it returns within the timeout
    (4 s). Failure or slowness leaves the extract in place.
20. _rule_ — An `ask` summary is cleared when the agent stops awaiting input.

### Extractor noise

21. _rule_ — In the generic matcher a `>`-prefixed line is a `run` only when it
    is **command-shaped** (`isCommandShaped`): first token is an executable-like
    token (`/^[\w.\/~@:+-]+$/`), the line has no `, ` and does not end in
    `.`, `?` or `!`. `$`-prefixed lines keep the old behaviour. The Claude TUI
    echoes the user's prompt as `> …`; that echo is not a command.
22. _rule_ — In the generic matcher `Read …`/`Reading …`/`Edited …` lines yield
    an event only when `extractPath` finds a path. "Read file…" is a spinner.
23. _rule_ — `resolveMatcher` picks by **family**: an id containing `claude`
    gets the Claude matcher, one containing `codex` the Codex matcher,
    case-insensitively; everything else the generic one.

## Types (frozen)

```ts
// src/lib/agents/events/feed.ts
export interface FeedRow {
  agentId: string;
  agentName: string;
  repoPath?: string;
  kind: AgentEventKind | 'sent';
  label: string;
  path?: string;
  at: number;
  seq?: number;
}
export function toSentFeedRows(sent: Record<string, SentMessage[]>, agents: AgentInfo[]): FeedRow[];
// mergeFeedRows(live, history, limit) — unchanged signature, still newest first.

// src/lib/agents/lanes.ts
export type FeedTier = 'mention' | 'outcome' | 'prose' | 'system' | 'you';
export function feedTier(kind: AgentEventKind | 'sent'): FeedTier;
export const SENDER_RUN_MAX_GAP_MS = 5 * 60_000;
export interface FeedGroup { agentId: string; agentName: string; repoPath?: string; at: number; rows: FeedRow[] }
export function groupBySender(rowsOldestFirst: FeedRow[]): FeedGroup[];
export function oldestFirst<T extends { at: number; seq?: number }>(rows: T[]): T[];
export function isVisibleUnderMute(row: FeedRow, mutedAgentIds: readonly string[]): boolean;
export function laneUnread(events: readonly AgentEvent[], seenAt: number | undefined): number;
export interface Lane {
  agentId: string; agentName: string; repoPath?: string; projectLabel: string;
  monogram: string; color: string;
  state: ConsoleAgentState; phaseLabel: string; rightNow: string;
  unread: number; hasQuestion: boolean; muted: boolean; running: boolean;
}
export function buildLanes(input: {
  agents: AgentInfo[]; agentEvents: Record<string, AgentEvent[]>;
  agentColors: Record<string, AgentColor>; reviewedAgentIds: readonly string[];
  mutedAgentIds: readonly string[]; laneSeenAt: Record<string, number>; now: number;
}): Lane[];
export const FOLLOW_SLACK_PX = 24;
export function isNearBottom(scrollTop: number, clientHeight: number, scrollHeight: number): boolean;

// src/lib/agents/naming.ts
export function agentMonogram(name: string): string; // "Wiki lint" → "WL", "Waitlist" → "WA", "" → "?"

// src/lib/store/agentSlice.ts (additions)
export interface SentMessage { text: string; at: number; seq: number }
export const MAX_SENT_MESSAGES = 200;
mutedAgentIds: string[];            toggleAgentMuted: (agentId: string) => void;
laneSeenAt: Record<string, number>; markLaneSeen: (agentId: string, at: number) => void;
agentSentMessages: Record<string, SentMessage[]>;   // written by sendAgentInput

// src/lib/store/laneSummariesSlice.ts
export interface LaneSummary { kind: 'ask' | 'done' | 'failed'; text: string; at: number; source: 'llm' | 'extract' }
export interface LaneSummariesSlice {
  laneSummaries: Record<string, LaneSummary>;
  setLaneSummary: (agentId: string, summary: LaneSummary) => void;
  clearLaneSummary: (agentId: string) => void;
}
// src/lib/agents/laneSummary.ts
export function extractAskSummary(chunks: string[]): string | null;
export async function resolveLaneSummary(input: {
  kind: 'ask' | 'done' | 'failed'; logs: string[]; task?: string;
  llmConfigured: boolean; projectPath: string | null; timeoutMs?: number;
}): Promise<LaneSummary | null>;
// src/lib/agents/laneSummarySubscriber.ts
export function installLaneSummarySubscriber(): () => void; // idempotent per store

// src/lib/agents/events/providers/shared.ts
export function isCommandShaped(text: string): boolean;
```

## File ownership for the build

| Package | Owns                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WP1     | `src/lib/agents/events/providers/{generic,index,shared}.ts`, their tests, `src/lib/agents/events/extract.test.ts` if touched, fixtures under `fixtures/agent-events`                       |
| WP2     | `src/lib/agents/events/feed.ts`, `src/lib/agents/lanes.ts`, `src/lib/agents/naming.ts`, `src/lib/store/agentSlice.ts`, their tests                                                         |
| WP4     | `src/lib/agents/laneSummary.ts`, `src/lib/agents/laneSummarySubscriber.ts`, `src/lib/store/laneSummariesSlice.ts`, `src/lib/store/index.ts`, `src/lib/hooks/useIDEActions.ts`, their tests |
| WP3     | `src/app/components/console/{ActivityFeed,LaneRail,FeedComposer,Monogram}.tsx`, their tests, `AgentConsole.tsx` only if the pane needs it                                                  |

Nobody else touches a file outside their row.
