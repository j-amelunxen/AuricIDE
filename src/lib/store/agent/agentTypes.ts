import type { AgentColor } from '@/lib/agents/colors';
import type { HeartbeatBucket } from '@/lib/agents/events/heartbeat';
import type { StreamLine } from '@/lib/agents/events/streamCapture';
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

  setAgentColor: (agentId: string, color: AgentColor | null) => void;
  toggleAgentMuted: (agentId: string) => void;
  markLaneSeen: (agentId: string, at: number) => void;
  toggleAgentRepoCollapsed: (repoPath: string) => void;
  setAgentMinimized: (agentId: string, minimized: boolean) => void;
  loadPromptHistory: (projectPath: string | null) => Promise<void>;
  spawnNewAgent: (config: AgentConfig) => Promise<AgentInfo>;
  /** Re-spawns a failed agent with its original config and dismisses the failure. */
  retryFailedAgent: (agentId: string) => Promise<AgentInfo | null>;
  killRunningAgent: (agentId: string) => Promise<void>;
  renameRunningAgent: (agentId: string, name: string) => Promise<void>;
  /**
   * Appends a message to this agent's sent log and forwards it to the PTY
   * stdin. Used for human interaction from the feed composer in the Agent
   * Console. The caller decides the exact bytes; this is only the wire.
   */
  sendAgentInput: (agentId: string, text: string) => Promise<void>;
  dismissFinishedAgent: (agentId: string) => void;
  updateAgentStatus: (agentId: string, status: AgentInfo['status']) => void;
  appendAgentLog: (agentId: string, log: string) => void;
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
