import type { StateCreator } from 'zustand';
import type { AgentConfig, AgentInfo, InterruptedAgent } from '../tauri/agents';
import {
  discardInterruptedAgent,
  killAgent,
  killAgentsForRepo,
  listAgentPromptHistory,
  listAgents,
  listInterruptedAgents,
  recordAgentPromptHistory,
  renameAgent,
  resumeInterruptedAgent,
  sendToAgent,
  spawnAgent,
} from '../tauri/agents';
import { deriveAgentActivity } from '../agents/activity';
import { detectAwaitingInput } from '../agents/awaitingInput';
import type { AgentColor } from '../agents/colors';
import { deriveErrorDigest } from '../agents/errorDigest';
import { pushHeartbeat, type HeartbeatBucket } from '../agents/events/heartbeat';
import {
  accumulateHeartbeatBytes,
  drainHeartbeatBytes,
  extractorForAgent,
  pruneAgentRuntime,
} from '../agents/events/registry';
import type { AgentEvent } from '../agents/events/types';
import { isFinishedAgent } from '../agents/fleet';
import { AGENT_ACTIVITY_BUMP_MS } from '../agents/liveness';
import { uniqueAgentName } from '../agents/naming';
import { MAX_TICKET_ATTEMPTS } from './conductorSlice';
import type { GoalsSlice } from './goalsSlice';
import type { NotificationInput } from '../tauri/notifications';
import type { PmGoalRun } from '../tauri/goals';
import type { EndedStep } from './skillComboSlice';

export const MAX_AGENT_LOGS = 5_000;
// Chunks can be up to 16KB PTY batches, so a count cap alone still allows
// ~80MB per agent. Bound retained log memory by bytes as well (UTF-16 code
// units approximate bytes closely for terminal output).
export const MAX_AGENT_LOG_BYTES = 2_000_000;
// Finished agents (idle/error) stay visible so their output can be reviewed,
// but without a bound they and their logs accumulate for the app's whole
// lifetime. Cap how many finished agents are retained, evicting the oldest.
export const MAX_FINISHED_AGENTS = 20;
// A feed row per event, not per PTY chunk — a long run's structured history
// still needs the same kind of bound agentLogs has, for the same reason.
export const MAX_AGENT_EVENTS = 200;
// The project DB keeps 100 start prompts; the dialog only ever recalls the
// freshest slice of them, so loading the whole tail is wasted work.
export const MAX_RECALLED_PROMPTS = 25;

export interface AgentLogMeta {
  /** Total chunks ever appended for this agent — survives trimming, so
   * consumers (e.g. the terminal) can use it as a replay cursor. */
  seq: number;
  /** Bytes currently retained in agentLogs for this agent. */
  bytes: number;
}

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
  /** Per-agent output volume, bucketed by minute — the fleet's activity sparkline. */
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
   * the unseen marker: a finished agent stays visibly unreviewed until its
   * logs were looked at, so nothing slips silently off the review pile.
   */
  reviewedAgentIds: string[];
  /**
   * The exact config each agent was launched with, kept for one-click retry.
   * AgentInfo alone cannot reconstruct a launch — permission mode and
   * headless are not display fields.
   */
  agentSpawnConfigs: Record<string, AgentConfig>;
  /** Previously used start prompts for the open project, newest first. */
  promptHistory: string[];
  setAgentMinimized: (agentId: string, minimized: boolean) => void;
  toggleAgentRepoCollapsed: (repoPath: string) => void;
  setAgentColor: (agentId: string, color: AgentColor | null) => void;
  loadPromptHistory: (projectPath: string) => Promise<void>;
  spawnNewAgent: (config: AgentConfig) => Promise<AgentInfo>;
  /** Relaunches a failed agent with its original config; null if not failed. */
  retryFailedAgent: (agentId: string) => Promise<AgentInfo | null>;
  killRunningAgent: (agentId: string) => Promise<void>;
  renameRunningAgent: (agentId: string, name: string) => Promise<void>;
  /**
   * Writes straight to an agent's PTY stdin — a permission-menu answer, a
   * stalled agent's Enter nudge, or a free-text instruction from the Agent
   * Console. The caller decides the exact bytes; this is only the wire.
   */
  sendAgentInput: (agentId: string, text: string) => Promise<void>;
  dismissFinishedAgent: (agentId: string) => void;
  updateAgentStatus: (agentId: string, status: AgentInfo['status']) => void;
  appendAgentLog: (agentId: string, log: string) => void;
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

/** Close the still-running goal run of an agent, if any (cross-slice, optional). */
function completeRunForAgent(
  state: AgentSlice,
  agentId: string,
  outcome: 'completed' | 'failed' | 'killed'
): void {
  const goalsSlice = state as AgentSlice & Partial<GoalsSlice>;
  if (!goalsSlice.completeGoalRun || !goalsSlice.goalRunsDraft) return;
  const run = goalsSlice.goalRunsDraft.find(
    (r) => r.agentId === agentId && r.outcome === 'running'
  );
  if (run) goalsSlice.completeGoalRun(run.id, outcome);
}

/** Drops the entries of a per-agent record for agents that no longer exist —
 * marker colours, event history, heartbeat buckets, all shaped the same way. */
function withoutAgentIds<T>(
  record: Record<string, T>,
  gone: (agentId: string) => boolean
): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => !gone(id)));
}

type LogRecords = Pick<AgentSlice, 'agentLogs' | 'agentLogMeta'>;

/**
 * The log records with one agent's entry removed — the shared shape behind
 * killing and dismissing a single agent, which otherwise differ only in what
 * else they clean up around it.
 */
function withoutAgentRecords(state: LogRecords, agentId: string): LogRecords {
  const { [agentId]: _logs, ...agentLogs } = state.agentLogs;
  const { [agentId]: _meta, ...agentLogMeta } = state.agentLogMeta;
  return { agentLogs, agentLogMeta };
}

type AgentRuntimeRecords = Pick<AgentSlice, 'agentEvents' | 'agentHeartbeat'>;

/**
 * Drops event history, heartbeat buckets, and the out-of-store extractor
 * registry for any id not present in `keepAgentIds`. Deliberately a sweep
 * rather than a single-id removal: an id can accumulate these records
 * (`appendAgentLog`) without ever landing in `agents` at all — Tauri does
 * not order PTY output against the spawn result — so removing exactly the
 * one agent a caller has in mind would miss that orphan. Passing the
 * post-removal `agents` id list here catches both in one pass.
 */
function reconcileAgentRuntimeState(
  state: AgentRuntimeRecords,
  keepAgentIds: Iterable<string>
): AgentRuntimeRecords {
  const keep = new Set(keepAgentIds);
  pruneAgentRuntime(keep);
  return {
    agentEvents: withoutAgentIds(state.agentEvents, (id) => !keep.has(id)),
    agentHeartbeat: withoutAgentIds(state.agentHeartbeat, (id) => !keep.has(id)),
  };
}

/** Drops marker colours for agents that no longer exist. */
function withoutColors(
  colors: Record<string, AgentColor>,
  gone: (agentId: string) => boolean
): Record<string, AgentColor> {
  return withoutAgentIds(colors, gone);
}

/**
 * Bucket for agents that carry no repo path. It is a label the panel groups
 * under, never a path — anything matching on it has to test for the absence of
 * a repoPath instead of comparing against this string.
 */
export const UNGROUPED_REPO_KEY = 'Unknown';

export function groupAgentsByRepo(agents: AgentInfo[]): Record<string, AgentInfo[]> {
  const groups: Record<string, AgentInfo[]> = {};
  for (const agent of agents) {
    const key = agent.repoPath ?? UNGROUPED_REPO_KEY;
    if (!groups[key]) groups[key] = [];
    groups[key].push(agent);
  }
  return groups;
}

/**
 * True when the conductor manages this agent's ticket and still has attempts
 * left — it will requeue the work itself, so a failure toast would interrupt
 * the user for something the system is about to handle. Only the final,
 * given-up failure earns the interrupt.
 */
function willConductorRetry(state: AgentSlice, agentId: string): boolean {
  const cross = state as AgentSlice &
    Partial<{
      conductorAssignments: Record<string, string>;
      conductorReviewAssignments: Record<string, string>;
      conductorFailedTickets: Record<string, number>;
    }>;
  const entry =
    Object.entries(cross.conductorAssignments ?? {}).find(([, a]) => a === agentId) ??
    Object.entries(cross.conductorReviewAssignments ?? {}).find(([, a]) => a === agentId);
  if (!entry) return false;
  return (cross.conductorFailedTickets?.[entry[0]] ?? 0) + 1 < MAX_TICKET_ATTEMPTS;
}

export const createAgentSlice: StateCreator<AgentSlice> = (set, get) => ({
  agents: [],
  agentLogs: {},
  agentLogMeta: {},
  agentEvents: {},
  agentHeartbeat: {},
  selectedAgentId: null,
  interruptedAgents: [],
  minimizedAgentIds: [],
  collapsedAgentRepos: [],
  agentColors: {},
  reviewedAgentIds: [],
  agentSpawnConfigs: {},
  promptHistory: [],

  setAgentColor: (agentId, color) => {
    const { [agentId]: _cleared, ...rest } = get().agentColors;
    set({ agentColors: color ? { ...rest, [agentId]: color } : rest });
  },

  toggleAgentRepoCollapsed: (repoPath) => {
    const current = get().collapsedAgentRepos;
    set({
      collapsedAgentRepos: current.includes(repoPath)
        ? current.filter((p) => p !== repoPath)
        : [...current, repoPath],
    });
  },

  setAgentMinimized: (agentId, minimized) => {
    const current = get().minimizedAgentIds;
    if (minimized === current.includes(agentId)) return;
    set({
      minimizedAgentIds: minimized ? [...current, agentId] : current.filter((id) => id !== agentId),
    });
  },

  loadPromptHistory: async (projectPath) => {
    if (!projectPath) {
      set({ promptHistory: [] });
      return;
    }
    try {
      const entries = await listAgentPromptHistory(projectPath, MAX_RECALLED_PROMPTS);
      const seen = new Set<string>();
      const prompts: string[] = [];
      for (const entry of entries) {
        const prompt = entry.prompt?.trim();
        if (!prompt || seen.has(prompt)) continue;
        seen.add(prompt);
        prompts.push(entry.prompt);
      }
      set({ promptHistory: prompts });
    } catch {
      // Browser mode or a project without a DB — recall is a convenience only.
    }
  },

  spawnNewAgent: async (config) => {
    const agent = await spawnAgent(config);
    // Two agents started from the same instruction would otherwise be
    // indistinguishable in the panel.
    const name = uniqueAgentName(
      agent.name,
      get().agents.map((a) => a.name)
    );
    const named = name === agent.name ? agent : { ...agent, name };
    set({
      agents: [...get().agents, named],
      // Kept verbatim for one-click retry — permission mode and headless
      // cannot be reconstructed from the agent's display fields.
      agentSpawnConfigs: { ...get().agentSpawnConfigs, [agent.id]: config },
    });

    // Keep the backend's copy in step so the name survives a restart-resume.
    // Guarded: a label is cosmetic and must never take a spawn down with it.
    if (name !== agent.name) {
      try {
        renameAgent(agent.id, name).catch(() => {});
      } catch {
        // No backend at all (browser/test mode).
      }
    }

    // Remember the start prompt in the project DB (last 100). Fire-and-forget:
    // history bookkeeping must never fail or delay the spawn itself.
    const { rootPath } = get() as AgentSlice & { rootPath?: string | null };
    const remembered = config.historyPrompt ?? config.task;
    if (rootPath && remembered.trim()) {
      recordAgentPromptHistory(rootPath, {
        id: crypto.randomUUID(),
        prompt: remembered,
        agentName: name,
        model: config.model,
        provider: config.provider ?? agent.provider,
        cwd: config.cwd ?? agent.repoPath ?? null,
        source: config.runSource ?? 'ui',
      }).catch(() => {});
    }

    // If this agent works toward a goal, persist the launch (with its exact
    // prompt) as a goal run — the prompt is a first-class artifact.
    const goalId = agent.spawnedByGoalId ?? config.spawnedByGoalId;
    if (goalId) {
      const goalsSlice = get() as AgentSlice & Partial<GoalsSlice>;
      if (goalsSlice.recordGoalRun) {
        const run: PmGoalRun = {
          id: crypto.randomUUID(),
          goalId,
          agentId: agent.id,
          ticketId: agent.spawnedByTicketId ?? config.spawnedByTicketId ?? null,
          prompt: config.task,
          model: config.model,
          provider: agent.provider,
          source: config.runSource ?? 'ui',
          outcome: 'running',
          summary: '',
          startedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          finishedAt: null,
        };
        goalsSlice.recordGoalRun(run);
      }
    }
    return named;
  },

  retryFailedAgent: async (agentId) => {
    const state = get();
    const failed = state.agents.find((a) => a.id === agentId);
    // Only a failure earns a retry — rerunning a clean result silently would
    // double its side effects.
    if (!failed || failed.status !== 'error') return null;

    const config = state.agentSpawnConfigs[agentId] ?? {
      name: failed.name,
      model: failed.model,
      task: failed.currentTask ?? 'wait',
      cwd: failed.repoPath,
      provider: failed.provider,
      spawnedByTicketId: failed.spawnedByTicketId,
      spawnedByGoalId: failed.spawnedByGoalId,
    };
    const replacement = await get().spawnNewAgent(config);
    // A combo step's retry is the same step with a new agent — rebind before
    // dismiss, or dismissing would start the next skill as well.
    const combo = get() as AgentSlice & {
      rebindSkillComboAgent?: (fromAgentId: string, toAgentId: string) => void;
    };
    combo.rebindSkillComboAgent?.(agentId, replacement.id);
    // The failed run is answered by its retry — it leaves the review pile.
    get().dismissFinishedAgent(agentId);
    return replacement;
  },

  killRunningAgent: async (agentId) => {
    const agent = get().agents.find((a) => a.id === agentId);
    try {
      await killAgent(agentId);
    } catch {
      // Agent may have already terminated naturally — Rust side already cleaned up
    }
    // Read before the removal below: if this was a combo step, its output is
    // the only thing the next step inherits, and the state drops it here.
    const endedLogs = get().agentLogs[agentId] ?? [];

    const conductor = get() as AgentSlice & {
      conductorAssignments?: Record<string, string>;
      conductorReviewAssignments?: Record<string, string>;
      conductorHandleAgentKilled?: (agentId: string) => void;
    };
    // A conductor agent is either an implementer OR a review agent. Missing the
    // review map here would fall through to the manual-kill branch below and
    // mark the reviewed ticket DONE — a silent false approval.
    const isConductorAgent =
      (!!conductor.conductorAssignments &&
        Object.values(conductor.conductorAssignments).includes(agentId)) ||
      (!!conductor.conductorReviewAssignments &&
        Object.values(conductor.conductorReviewAssignments).includes(agentId));

    if (isConductorAgent) {
      // Killing conductor work is NOT success: the conductor reopens the
      // ticket and excludes it from this run instead of marking it done.
      conductor.conductorHandleAgentKilled?.(agentId);
    } else if (agent?.spawnedByTicketId) {
      // Manually launched ticket agent: killing it means "I'm done with it"
      const pmSlice = get() as AgentSlice & {
        updateTicket?: (id: string, updates: { status: string }) => void;
      };
      if (pmSlice.updateTicket) {
        pmSlice.updateTicket(agent.spawnedByTicketId, { status: 'done' });
      }
    }

    completeRunForAgent(get(), agentId, 'killed');

    const remainingAgents = get().agents.filter((a) => a.id !== agentId);
    set({
      agents: remainingAgents,
      ...withoutAgentRecords(get(), agentId),
      ...reconcileAgentRuntimeState(
        get(),
        remainingAgents.map((a) => a.id)
      ),
      minimizedAgentIds: get().minimizedAgentIds.filter((id) => id !== agentId),
      agentColors: withoutColors(get().agentColors, (id) => id === agentId),
    });

    // Ending this agent is ending this step, not the combo — the next skill
    // starts here. Awaited so a test (and a user who immediately looks) sees
    // the successor already in the fleet.
    const combo = get() as AgentSlice & {
      skillComboHandleAgentEnded?: (agentId: string, ended: EndedStep) => Promise<void>;
    };
    await combo.skillComboHandleAgentEnded?.(agentId, {
      logs: endedLogs,
      failed: agent?.status === 'error',
    });
  },

  sendAgentInput: async (agentId, text) => {
    await sendToAgent(agentId, text);
  },

  renameRunningAgent: async (agentId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    set({
      agents: get().agents.map((a) => (a.id === agentId ? { ...a, name: trimmed } : a)),
    });

    try {
      await renameAgent(agentId, trimmed);
    } catch {
      // Browser mode, or the agent already exited on the Rust side. The name
      // is a label for the human — keep it rather than snapping it back.
    }
  },

  /**
   * Clears a stopped agent out of the panel once its output has been read.
   * This is tidying up, not stopping: an agent still doing something is left
   * alone, and no ticket or goal bookkeeping is touched.
   */
  dismissFinishedAgent: (agentId) => {
    const { agents, agentLogs, minimizedAgentIds } = get();
    const agent = agents.find((a) => a.id === agentId);
    if (!agent || !isFinishedAgent(agent)) return;

    // Read before the removal below — a combo step's successor inherits it.
    const endedLogs = agentLogs[agentId] ?? [];
    const { [agentId]: _config, ...remainingConfigs } = get().agentSpawnConfigs;
    const remainingAgents = agents.filter((a) => a.id !== agentId);
    set({
      agentSpawnConfigs: remainingConfigs,
      agents: remainingAgents,
      ...withoutAgentRecords(get(), agentId),
      ...reconcileAgentRuntimeState(
        get(),
        remainingAgents.map((a) => a.id)
      ),
      minimizedAgentIds: minimizedAgentIds.filter((id) => id !== agentId),
      agentColors: withoutColors(get().agentColors, (id) => id === agentId),
      reviewedAgentIds: get().reviewedAgentIds.filter((id) => id !== agentId),
    });

    // Dismissing a finished combo step is "I'm done reviewing" — start the next.
    const combo = get() as AgentSlice & {
      skillComboHandleAgentEnded?: (agentId: string, ended: EndedStep) => Promise<void>;
    };
    void combo.skillComboHandleAgentEnded?.(agentId, {
      logs: endedLogs,
      failed: agent.status === 'error',
    });
  },

  updateAgentStatus: (agentId, status) => {
    // A failure is the one transition worth interrupting for — it reaches the
    // user even with the agents panel closed. Clean finishes stay silent:
    // they are represented by the unseen marker and the all-quiet signal.
    // Guarded on the *transition* so a duplicate stop event cannot stack.
    if (status === 'error') {
      const failing = get().agents.find((a) => a.id === agentId);
      if (failing && failing.status !== 'error' && !willConductorRetry(get(), agentId)) {
        const toaster = get() as AgentSlice & {
          showToast?: (message: string, variant?: 'error' | 'success' | 'info') => number;
        };
        toaster.showToast?.(`${failing.name} failed · see row output`, 'error');
        // The toast is the alarm and it interrupts once; this is the record
        // that survives looking away, and it carries the repo so a failure in
        // a project you are not currently in is still findable. Same guards on
        // purpose — one failure, one entry, and nothing at all while the
        // conductor is about to retry by itself.
        const inbox = get() as AgentSlice & {
          dispatchNotification?: (input: NotificationInput) => Promise<unknown>;
        };
        void inbox.dispatchNotification?.({
          source: 'system',
          origin: failing.name,
          severity: 'error',
          title: `${failing.name} failed`,
          body: deriveErrorDigest(get().agentLogs[agentId] ?? []),
          projectPath: failing.repoPath ?? null,
          projectName: failing.repoPath?.split('/').pop() ?? null,
          refKind: 'agent',
          refId: agentId,
          // One row per failed run, so a duplicate stop event cannot stack.
          dedupeKey: `agent:${agentId}:error`,
          actions: [
            { id: 'logs', label: 'Open logs', kind: 'open', target: { type: 'agent', agentId } },
          ],
        });
      }
    }
    if (status === 'idle' || status === 'error') {
      completeRunForAgent(get(), agentId, status === 'idle' ? 'completed' : 'failed');
      const conductor = get() as AgentSlice & {
        conductorHandleAgentStatus?: (agentId: string, status: AgentInfo['status']) => void;
      };
      conductor.conductorHandleAgentStatus?.(agentId, status);
    }
    const { agentLogs, agentLogMeta } = get();
    const stopped = status === 'idle' || status === 'error';
    const updatedAgents = get().agents.map((a) =>
      a.id === agentId
        ? {
            ...a,
            status,
            // Stamped once: the first stop is when it stopped, and a late
            // duplicate event must not shuffle the review order.
            finishedAt: stopped ? (a.finishedAt ?? Date.now()) : a.finishedAt,
          }
        : a
    );

    const finished = updatedAgents.filter((a) => a.status === 'idle' || a.status === 'error');
    const excess = finished.length - MAX_FINISHED_AGENTS;
    if (excess <= 0) {
      set({ agents: updatedAgents });
      return;
    }

    const oldestFirst = [...finished].sort((a, b) => a.startedAt - b.startedAt);
    const evictedIds = new Set(oldestFirst.slice(0, excess).map((a) => a.id));
    const remainingAgents = updatedAgents.filter((a) => !evictedIds.has(a.id));

    set({
      agents: remainingAgents,
      agentLogs: Object.fromEntries(
        Object.entries(agentLogs).filter(([id]) => !evictedIds.has(id))
      ),
      agentLogMeta: Object.fromEntries(
        Object.entries(agentLogMeta).filter(([id]) => !evictedIds.has(id))
      ),
      ...reconcileAgentRuntimeState(
        get(),
        remainingAgents.map((a) => a.id)
      ),
      minimizedAgentIds: get().minimizedAgentIds.filter((id) => !evictedIds.has(id)),
      agentColors: withoutColors(get().agentColors, (id) => evictedIds.has(id)),
      reviewedAgentIds: get().reviewedAgentIds.filter((id) => !evictedIds.has(id)),
      agentSpawnConfigs: Object.fromEntries(
        Object.entries(get().agentSpawnConfigs).filter(([id]) => !evictedIds.has(id))
      ),
    });
  },

  appendAgentLog: (agentId, log) => {
    const state = get();
    const existing = state.agentLogs[agentId] ?? [];
    const meta = state.agentLogMeta[agentId] ?? { seq: 0, bytes: 0 };
    let updated = [...existing, log];
    let bytes = meta.bytes + log.length;

    // Trim oldest chunks past either cap, but always keep the newest chunk.
    let drop = 0;
    while (
      updated.length - drop > 1 &&
      (updated.length - drop > MAX_AGENT_LOGS || bytes > MAX_AGENT_LOG_BYTES)
    ) {
      bytes -= updated[drop].length;
      drop++;
    }
    if (drop > 0) {
      updated = updated.slice(drop);
    }

    // Throttle lastActivityAt bumps: replacing the agents array on every
    // streamed chunk forces every agents-derived memo (orchestration graph,
    // fleet panel, goal badges) to recompute many times per second. The
    // liveness window is sized around this interval — see agents/liveness.ts.
    const agent = state.agents.find((a) => a.id === agentId);
    const now = Date.now();
    const shouldBumpActivity =
      agent !== undefined && now - (agent.lastActivityAt ?? 0) > AGENT_ACTIVITY_BUMP_MS;

    // The event extractor sees every chunk, not just the throttled ones — it
    // buffers partial lines internally, so skipping a chunk here would lose
    // whatever line it was about to complete. `agent?.provider` is passed
    // as-is (never defaulted here) so the registry can tell "genuinely a
    // generic-matcher agent" apart from "not resolved yet" and rebuild once
    // a real provider shows up — Tauri does not order PTY output against the
    // spawn result, so a chunk can arrive before this agent exists in
    // `agents` at all.
    const newEvents = extractorForAgent(agentId, agent?.provider).push(log, now);

    // Heartbeat bytes accumulate on every chunk so none are lost, but the
    // store write itself rides the same throttle as the activity bump — a
    // fresh object per chunk would cost the fleet's activity sparkline a
    // recompute many times a second for no visible change.
    accumulateHeartbeatBytes(agentId, log.length);

    set({
      agentLogs: {
        ...state.agentLogs,
        [agentId]: updated,
      },
      agentLogMeta: {
        ...state.agentLogMeta,
        [agentId]: { seq: meta.seq + 1, bytes },
      },
      // Only replace the record when a chunk actually produced an event — a
      // fresh object on every redraw-only chunk would cost every
      // agentEvents-derived memo a recompute for nothing.
      ...(newEvents.length > 0
        ? {
            agentEvents: {
              ...state.agentEvents,
              [agentId]: [...(state.agentEvents[agentId] ?? []), ...newEvents].slice(
                -MAX_AGENT_EVENTS
              ),
            },
          }
        : {}),
      // Distilling "what is it doing right now" — and flushing the
      // heartbeat's pending bytes — rides the same throttle: both only run
      // when the agents array is being replaced anyway, so neither costs
      // additional renders. A tail of pure redraw noise leaves the previous
      // activity line standing rather than blanking it.
      ...(shouldBumpActivity
        ? {
            agentHeartbeat: {
              ...state.agentHeartbeat,
              [agentId]: pushHeartbeat(
                state.agentHeartbeat[agentId] ?? [],
                drainHeartbeatBytes(agentId),
                now
              ),
            },
            agents: state.agents.map((a) =>
              a.id === agentId
                ? {
                    ...a,
                    lastActivityAt: now,
                    currentActivity: deriveAgentActivity(updated) ?? a.currentActivity,
                    // Rides the same throttle as the activity line; unlike it,
                    // this clears as soon as the prompt scrolls away.
                    awaitingInput: detectAwaitingInput(updated),
                  }
                : a
            ),
          }
        : {}),
    });
  },

  refreshAgents: async () => {
    const agents = await listAgents();
    set({
      agents,
      ...reconcileAgentRuntimeState(
        get(),
        agents.map((a) => a.id)
      ),
    });
  },

  selectAgent: (agentId) => {
    const state = get();
    // Opening a *stopped* agent is reviewing its outcome; peeking at a
    // running one is not — there is no outcome yet, so the unseen marker
    // must survive that visit.
    const agent = agentId ? state.agents.find((a) => a.id === agentId) : undefined;
    const nowReviewed =
      agent && isFinishedAgent(agent) && !state.reviewedAgentIds.includes(agent.id)
        ? [...state.reviewedAgentIds, agent.id]
        : state.reviewedAgentIds;
    set({ selectedAgentId: agentId, reviewedAgentIds: nowReviewed });
  },

  markAgentReviewed: (agentId) => {
    const state = get();
    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent || !isFinishedAgent(agent) || state.reviewedAgentIds.includes(agentId)) return;
    set({ reviewedAgentIds: [...state.reviewedAgentIds, agentId] });
  },

  loadInterruptedAgents: async () => {
    try {
      const interrupted = await listInterruptedAgents();
      set({ interruptedAgents: interrupted });
      // A restored chain is only alive if the agent it points at came back
      // with the app — either still running, or waiting to be resumed.
      const combo = get() as AgentSlice & {
        reconcileSkillCombos?: (reachableAgentIds: string[]) => void;
      };
      combo.reconcileSkillCombos?.([
        ...interrupted.map((a) => a.id),
        ...get().agents.map((a) => a.id),
      ]);
    } catch {
      // Browser/test mode — no Tauri backend, nothing to restore
    }
  },

  resumeInterruptedAgent: async (agentId) => {
    // The backend consumes the persisted entry and re-spawns; only drop the
    // local entry once that succeeded, so a failed resume stays retryable.
    const interrupted = get().interruptedAgents.find((a) => a.id === agentId);
    const agent = await resumeInterruptedAgent(agentId);
    set({
      interruptedAgents: get().interruptedAgents.filter((a) => a.id !== agentId),
      agents: [...get().agents, agent],
      selectedAgentId: agent.id,
      // The persisted record carries permission mode and headless — keep the
      // resumed agent one-click-retryable without downgrading either.
      ...(interrupted
        ? {
            agentSpawnConfigs: {
              ...get().agentSpawnConfigs,
              [agent.id]: {
                name: interrupted.name,
                model: interrupted.model,
                task: interrupted.task,
                cwd: interrupted.cwd ?? undefined,
                permissionMode: (interrupted.permissionMode ?? undefined) as
                  AgentConfig['permissionMode'] | undefined,
                dangerouslyIgnorePermissions: interrupted.dangerouslyIgnorePermissions,
                autoAcceptEdits: interrupted.autoAcceptEdits,
                provider: interrupted.provider,
                headless: interrupted.headless,
                spawnedByTicketId: interrupted.spawnedByTicketId ?? undefined,
                spawnedByGoalId: interrupted.spawnedByGoalId ?? undefined,
              },
            },
          }
        : {}),
    });
    // Resuming spawns a new process under a new id. A combo waiting on the old
    // one has to follow it across, or the chain points at a corpse.
    const comboResume = get() as AgentSlice & {
      rebindSkillComboAgent?: (fromAgentId: string, toAgentId: string) => void;
    };
    comboResume.rebindSkillComboAgent?.(agentId, agent.id);
    return agent;
  },

  discardInterruptedAgent: async (agentId) => {
    try {
      await discardInterruptedAgent(agentId);
    } catch {
      // Already gone on the backend — removing it locally is still correct
    }
    set({ interruptedAgents: get().interruptedAgents.filter((a) => a.id !== agentId) });
    // Throwing away the step throws away the chain that was waiting on it.
    const combo = get() as AgentSlice & {
      cancelSkillCombosForAgents?: (agentIds: string[]) => void;
    };
    combo.cancelSkillCombosForAgents?.([agentId]);
  },

  killAgentsForRepoPath: async (repoPath) => {
    const ungrouped = repoPath === UNGROUPED_REPO_KEY;
    const belongs = (a: AgentInfo) => (ungrouped ? !a.repoPath : a.repoPath === repoPath);
    if (ungrouped) {
      // The backend matches on a real repo path, so it would find none of these.
      // End them one by one instead of reporting a kill that never happened.
      await Promise.all(
        get()
          .agents.filter(belongs)
          .map((a) => killAgent(a.id).catch(() => undefined))
      );
    } else {
      await killAgentsForRepo(repoPath);
    }
    const { agents, agentLogs, agentLogMeta, minimizedAgentIds } = get();
    const killedIds = new Set(agents.filter(belongs).map((a) => a.id));
    const combo = get() as AgentSlice & {
      cancelSkillCombosForAgents?: (agentIds: string[]) => void;
    };
    combo.cancelSkillCombosForAgents?.([...killedIds]);
    const remainingAgents = agents.filter((a) => !killedIds.has(a.id));
    set({
      agents: remainingAgents,
      agentLogs: Object.fromEntries(Object.entries(agentLogs).filter(([id]) => !killedIds.has(id))),
      agentLogMeta: Object.fromEntries(
        Object.entries(agentLogMeta).filter(([id]) => !killedIds.has(id))
      ),
      ...reconcileAgentRuntimeState(
        get(),
        remainingAgents.map((a) => a.id)
      ),
      minimizedAgentIds: minimizedAgentIds.filter((id) => !killedIds.has(id)),
      agentColors: withoutColors(get().agentColors, (id) => killedIds.has(id)),
    });
  },
});
