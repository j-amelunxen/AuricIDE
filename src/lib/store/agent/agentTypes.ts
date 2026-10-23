import type { AgentColor } from '@/lib/agents/colors';
import type { HeartbeatBucket } from '@/lib/agents/events/heartbeat';
import type { StreamLine } from '@/lib/agents/events/streamCapture';
import type { GridCells } from '@/lib/agents/terminalGrid';
import type { AgentEvent } from '@/lib/agents/events/types';
import type { PersistedAgentEvent } from '@/lib/tauri/agentLog';
import type { AgentConfig, AgentInfo, InterruptedAgent } from '@/lib/tauri/agents';

export const MAX_AGENT_LOGS = 5_000;
export const MAX_AGENT_LOG_BYTES = 2_000_000;
export const MAX_FINISHED_AGENTS = 20;
export const MAX_AGENT_EVENTS = 2_000;
export const MAX_RECALLED_PROMPTS = 25;
export const MAX_SENT_MESSAGES = 200;
export const MAX_LOADED_HISTORY = 2_000;

/**
 * Bucket for agents that carry no repo path. It is a label the panel groups
 * under, never a path — anything matching on it has to test for the absence of
 * a repoPath instead of comparing against this string.
 */
export const UNGROUPED_REPO_KEY = 'Unknown';

/** One message a user typed to a running agent through the console's composer. */
export interface SentMessage {
  text: string;
  at: number;
  /** Monotonic per agent, starting at 0 — the feed's tiebreaker at a shared
   * timestamp, and what keeps a sent row's identity from colliding with an
   * event's once both land in the same merged feed (see `feed.ts`). */
  seq: number;
}

export interface AgentLogMeta {
  /** Total chunks ever appended for this agent — survives trimming, so
   * consumers (e.g. the terminal) can use it as a replay cursor. */
  seq: number;
  /** Bytes currently retained in agentLogs for this agent. */
  bytes: number;
}

/**
 * Chunks per agent, in arrival order, with each chunk's arrival time. Without
 * times (a direct `appendAgentLog`), a chunk is stamped when it is appended.
 */
export type AgentLogBatch = ReadonlyArray<
  readonly [agentId: string, chunks: readonly string[], arrivedAt?: readonly number[]]
>;

/** The main window's agents plus the error digest of each failed one. */
export interface AgentRoster {
  agents: AgentInfo[];
  errorDigests: Record<string, string>;
}

export type LogRecords = Pick<AgentSlice, 'agentLogs' | 'agentLogMeta'>;

export type AgentRuntimeRecords = Pick<
  AgentSlice,
  | 'agentEvents'
  | 'agentHeartbeat'
  | 'agentStreamLines'
  | 'mutedAgentIds'
  | 'laneSeenAt'
  | 'agentSentMessages'
>;

/** What pressing the Supervisor tile came to. */
export interface SupervisorSkillLaunch {
  task: string;
  model?: string;
  provider?: string;
  /**
   * Work in this earlier run's folder instead of a new one. Always a new
   * supervisor, refused while a live one already works in that folder.
   */
  resumeRunDir?: string;
  /**
   * Open this Project Manager: its live
   * supervisor when there is one, else a resume of its folder. Refused for a key
   * the registry does not know or one that is archived.
   */
  managerKey?: string;
  /** Start a new supervisor even without a task, rather than open the running one. */
  forceNew?: boolean;
  /**
   * Nobody clicked: a launch that would need a dialog (the provider choice)
   * answers `cancelled` instead of opening it.
   */
  automatic?: boolean;
}

/** `supervisors.spawn` over the supervisor link (`docs/design-supervisor-link.md`). */
export interface LinkedSupervisorLaunch {
  task?: string | null;
  provider?: string | null;
  model?: string | null;
  /** The address the client chose (`AgentConfig.supervisorKey`); Rust checks it. */
  key?: string | null;
  /** A card name instead of "Supervisor" (control socket `spawn.name`). */
  name?: string | null;
}

export type LinkedSupervisorSpawn =
  | { kind: 'spawned'; agent: AgentInfo }
  | { kind: 'nothing-visible' }
  | { kind: 'provider-not-allowed'; provider: string; allowed: string[] }
  | { kind: 'provider-unsupported'; provider: string; supported: readonly string[] };

export type SupervisorLaunch =
  /** A plain open while supervisors run: the newest one, brought forward. */
  | { kind: 'running'; agent: AgentInfo }
  | { kind: 'spawned'; agent: AgentInfo }
  /** The run folder to resume is where this live supervisor already works. */
  | { kind: 'run_in_use'; agent: AgentInfo }
  | { kind: 'cancelled' }
  | { kind: 'nothing-visible' };

export interface AgentSlice {
  agents: AgentInfo[];
  agentLogs: Record<string, string[]>;
  agentLogMeta: Record<string, AgentLogMeta>;
  /**
   * Structured events distilled from each agent's raw output — one entry per
   * tool call, permission prompt or notable line. Capped at
   * `MAX_AGENT_EVENTS`, oldest dropped first, same reasoning as `agentLogs`.
   */
  agentEvents: Record<string, AgentEvent[]>;
  /**
   * Each agent's readable output, line by line — what it *said*, as opposed
   * to `agentEvents`' what it *did*. This is what the console's feed shows in
   * "All output" mode; the curated event list only ever holds lines a
   * provider matcher recognised, which is why it reads as incomplete on its
   * own. Redraw chrome and consecutive repeats are already filtered out (see
   * `createStreamCapture`); capped at `MAX_STREAM_LINES` per agent.
   */
  agentStreamLines: Record<string, StreamLine[]>;
  /**
   * The on-disk activity history, newest first, as last read back.
   *
   * Kept apart from `agentEvents` rather than folded into it: that record is
   * keyed by agents that are currently running, and stored history is mostly
   * from agents that have long exited. A row folded in there would simply not
   * render. The two are merged at display time, by `mergeFeedRows`.
   */
  agentLogHistory: PersistedAgentEvent[];
  /**
   * Per-agent activity, bucketed by minute and counted per kind of work —
   * the fleet's activity chart. Counts events rather than output bytes: bytes
   * made an agent printing a long file look busier than one making a careful
   * edit, which is the opposite of what a reader needs.
   */
  agentHeartbeat: Record<string, HeartbeatBucket[]>;
  selectedAgentId: string | null;
  /** Agents from a previous app run that died with the app (restart persistence). */
  interruptedAgents: InterruptedAgent[];
  /**
   * Agents parked out of the way: still running, still streaming, just folded
   * down to one line so a fleet you'll come back to later stops eating the
   * panel. Session-scoped — nothing about the agent itself changes.
   */
  minimizedAgentIds: string[];
  /**
   * Which agents the terminal shows side by side, one id per quadrant
   * (`terminalGrid.ts`). Null is the plain single terminal. View state like
   * parking; ids of agents that are gone are dropped where it is read
   * (`reconcileGrid`), so nothing has to clear it.
   */
  terminalGridCells: GridCells | null;
  /**
   * Repo groups folded shut in the agents panel. Keyed by repo path (or
   * 'Unknown'), session-scoped like the parked list.
   */
  collapsedAgentRepos: string[];
  /**
   * Marker colours the user put on agents, to group them or flag the ones
   * worth coming back to. Session-scoped, like the other view state — the
   * marker lives exactly as long as the agent it marks.
   */
  agentColors: Record<string, AgentColor>;
  /**
   * Stopped agents whose outcome the user has opened. The complement drives
   * the "unseen outcome" badge and the all-quiet celebration check.
   */
  reviewedAgentIds: string[];
  /**
   * Full launch configs kept across a run so a failed agent can be retried
   * with one click.
   */
  agentSpawnConfigs: Record<string, AgentConfig>;
  /**
   * Recent start prompts recalled from the project DB.
   */
  promptHistory: string[];
  /**
   * Lanes muted in the console: their audio/desktop alerts stay silent and
   * their activity stays off the quiet-summary counter. Session-scoped, like
   * minimizedAgentIds.
   */
  mutedAgentIds: string[];
  /**
   * High-water mark of what the user has seen in each lane's feed (epoch
   * ms). Drives the "N new" pill on inactive tabs.
   */
  laneSeenAt: Record<string, number>;
  /**
   * Messages the user sent to each agent through the console's composer,
   * interleaved into that agent's feed at display time. Session-scoped.
   */
  agentSentMessages: Record<string, SentMessage[]>;
  /**
   * Main window: the agent terminals are detached into their own OS window
   * (`docs/design-agent-window.md`). Told by Rust, never assumed — while it is
   * true the terminal modal stays shut and selecting an agent goes there.
   */
  agentWindowOpen: boolean;
  /**
   * Agent window: the agent its terminal shows. Its own field rather than
   * `selectedAgentId`, whose setter also books a finished agent as reviewed —
   * bookkeeping that belongs to the main window.
   */
  agentWindowActiveAgentId: string | null;
  /**
   * Agent window: the last error line of each failed agent, as the main
   * window derived it. The full log it is read from exists only over there.
   */
  agentWindowErrorDigests: Record<string, string>;

  setAgentColor: (agentId: string, color: AgentColor | null) => void;
  toggleAgentMuted: (agentId: string) => void;
  markLaneSeen: (agentId: string, at: number) => void;
  toggleAgentRepoCollapsed: (repoPath: string) => void;
  setAgentMinimized: (agentId: string, minimized: boolean) => void;
  setTerminalGridCells: (cells: GridCells | null) => void;
  loadPromptHistory: (projectPath: string | null) => Promise<void>;
  spawnNewAgent: (config: AgentConfig) => Promise<AgentInfo>;
  /**
   * Starts the one supervisor agent (ADR 0004), or hands back the one already
   * running. Spawns nothing when the supervisor policy allows no project: the
   * caller sends the user to Settings → Supervisor instead.
   */
  /**
   * Starts the supervisor, one at a time. With a skill's `task` it is the
   * first task of a new one, or a message to the one already running.
   */
  spawnSupervisor: (skill?: SupervisorSkillLaunch) => Promise<SupervisorLaunch>;
  /** A new supervisor for the supervisor link: no picker, no reuse of a running one. */
  spawnLinkedSupervisor: (launch: LinkedSupervisorLaunch) => Promise<LinkedSupervisorSpawn>;
  /** Re-spawns a failed agent with its original config and dismisses the failure. */
  retryFailedAgent: (agentId: string) => Promise<AgentInfo | null>;
  killRunningAgent: (agentId: string) => Promise<void>;
  renameRunningAgent: (agentId: string, name: string) => Promise<void>;
  /**
   * Appends a message to this agent's sent log and forwards it to the PTY
   * stdin. Used for human interaction from the feed composer in the Agent
   * Console. The caller decides the exact bytes; this is only the wire.
   */
  sendAgentInput: (
    agentId: string,
    text: string,
    options?: { automatic?: boolean }
  ) => Promise<void>;
  /**
   * The bookkeeping half of `sendAgentInput`: records what was typed in the
   * feed without writing it. For input that already reached the PTY another
   * way (the control socket's `agent-input-sent`). A bare nudge is not recorded.
   */
  recordAgentSentMessage: (agentId: string, text: string) => void;
  dismissFinishedAgent: (agentId: string) => void;
  updateAgentStatus: (agentId: string, status: AgentInfo['status']) => void;
  appendAgentLog: (agentId: string, log: string) => void;
  /** Several agents' chunks in one store update; see `handleAppendAgentLogBatch`. */
  appendAgentLogBatch: (batch: AgentLogBatch) => void;
  /**
   * The agent window's write path: raw chunks into `agentLogs` and
   * `agentLogMeta`, and nothing else. See `handleAppendAgentTerminalChunks`.
   */
  appendAgentTerminalChunks: (agentId: string, chunks: readonly string[]) => void;
  setAgentWindowOpen: (open: boolean) => void;
  setAgentWindowActiveAgentId: (agentId: string | null) => void;
  /**
   * The agent window's only writer of `agents`: takes the main window's list
   * as it is, and drops the logs of agents that are no longer on it.
   */
  applyAgentRoster: (roster: AgentRoster) => void;
  /**
   * Trims the stored history to its configured bounds, then reads it back.
   * A no-op while persistence is off — nothing was written, so there is
   * nothing to trim or show.
   */
  loadAgentLogHistory: () => Promise<void>;
  refreshAgents: () => Promise<void>;
  selectAgent: (agentId: string | null) => void;
  /**
   * Marks a finished agent's outcome reviewed without changing what is
   * selected — `selectAgent`'s side effect of moving `selectedAgentId` also
   * relocates the bottom terminal panel's active tab, which "I've seen this
   * one" from a list (the Agent Console) must not do.
   */
  markAgentReviewed: (agentId: string) => void;
  killAgentsForRepoPath: (repoPath: string) => Promise<void>;
  loadInterruptedAgents: () => Promise<void>;
  resumeInterruptedAgent: (agentId: string) => Promise<AgentInfo>;
  discardInterruptedAgent: (agentId: string) => Promise<void>;
}
