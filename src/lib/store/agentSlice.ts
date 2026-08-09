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
  spawnAgent,
} from '../tauri/agents';
import { deriveAgentActivity } from '../agents/activity';
import { detectAwaitingInput } from '../agents/awaitingInput';
import type { AgentColor } from '../agents/colors';
import { isFinishedAgent } from '../agents/fleet';
import { AGENT_ACTIVITY_BUMP_MS } from '../agents/liveness';
import { uniqueAgentName } from '../agents/naming';
import { MAX_TICKET_ATTEMPTS } from './conductorSlice';
import type { GoalsSlice } from './goalsSlice';
import type { PmGoalRun } from '../tauri/goals';

export const MAX_AGENT_LOGS = 5_000;
// Chunks can be up to 16KB PTY batches, so a count cap alone still allows
// ~80MB per agent. Bound retained log memory by bytes as well (UTF-16 code
// units approximate bytes closely for terminal output).
export const MAX_AGENT_LOG_BYTES = 2_000_000;
// Finished agents (idle/error) stay visible so their output can be reviewed,
// but without a bound they and their logs accumulate for the app's whole
// lifetime. Cap how many finished agents are retained, evicting the oldest.
export const MAX_FINISHED_AGENTS = 20;
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
  dismissFinishedAgent: (agentId: string) => void;
  updateAgentStatus: (agentId: string, status: AgentInfo['status']) => void;
  appendAgentLog: (agentId: string, log: string) => void;
  refreshAgents: () => Promise<void>;
  selectAgent: (agentId: string | null) => void;
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

/** Drops marker colours for agents that no longer exist. */
function withoutColors(
  colors: Record<string, AgentColor>,
  gone: (agentId: string) => boolean
): Record<string, AgentColor> {
  return Object.fromEntries(Object.entries(colors).filter(([id]) => !gone(id)));
}

export function groupAgentsByRepo(agents: AgentInfo[]): Record<string, AgentInfo[]> {
  const groups: Record<string, AgentInfo[]> = {};
  for (const agent of agents) {
    const key = agent.repoPath ?? 'Unknown';
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
      conductorFailedTickets: Record<string, number>;
    }>;
  const entry = Object.entries(cross.conductorAssignments ?? {}).find(([, a]) => a === agentId);
  if (!entry) return false;
  return (cross.conductorFailedTickets?.[entry[0]] ?? 0) + 1 < MAX_TICKET_ATTEMPTS;
}

export const createAgentSlice: StateCreator<AgentSlice> = (set, get) => ({
  agents: [],
  agentLogs: {},
  agentLogMeta: {},
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
    if (rootPath && config.task.trim()) {
      recordAgentPromptHistory(rootPath, {
        id: crypto.randomUUID(),
        prompt: config.task,
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
    const { agentLogs, agentLogMeta } = get();
    const { [agentId]: _, ...remainingLogs } = agentLogs;
    const { [agentId]: _meta, ...remainingMeta } = agentLogMeta;

    const conductor = get() as AgentSlice & {
      conductorAssignments?: Record<string, string>;
      conductorHandleAgentKilled?: (agentId: string) => void;
    };
    const isConductorAgent =
      !!conductor.conductorAssignments &&
      Object.values(conductor.conductorAssignments).includes(agentId);

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

    set({
      agents: get().agents.filter((a) => a.id !== agentId),
      agentLogs: remainingLogs,
      agentLogMeta: remainingMeta,
      minimizedAgentIds: get().minimizedAgentIds.filter((id) => id !== agentId),
      agentColors: withoutColors(get().agentColors, (id) => id === agentId),
    });
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
    const { agents, agentLogs, agentLogMeta, minimizedAgentIds } = get();
    const agent = agents.find((a) => a.id === agentId);
    if (!agent || !isFinishedAgent(agent)) return;

    const { [agentId]: _logs, ...remainingLogs } = agentLogs;
    const { [agentId]: _meta, ...remainingMeta } = agentLogMeta;
    const { [agentId]: _config, ...remainingConfigs } = get().agentSpawnConfigs;
    set({
      agentSpawnConfigs: remainingConfigs,
      agents: agents.filter((a) => a.id !== agentId),
      agentLogs: remainingLogs,
      agentLogMeta: remainingMeta,
      minimizedAgentIds: minimizedAgentIds.filter((id) => id !== agentId),
      agentColors: withoutColors(get().agentColors, (id) => id === agentId),
      reviewedAgentIds: get().reviewedAgentIds.filter((id) => id !== agentId),
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
        toaster.showToast?.(`${failing.name} failed — its last output is on the row`, 'error');
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

    set({
      agents: updatedAgents.filter((a) => !evictedIds.has(a.id)),
      agentLogs: Object.fromEntries(
        Object.entries(agentLogs).filter(([id]) => !evictedIds.has(id))
      ),
      agentLogMeta: Object.fromEntries(
        Object.entries(agentLogMeta).filter(([id]) => !evictedIds.has(id))
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

    set({
      agentLogs: {
        ...state.agentLogs,
        [agentId]: updated,
      },
      agentLogMeta: {
        ...state.agentLogMeta,
        [agentId]: { seq: meta.seq + 1, bytes },
      },
      // Distilling "what is it doing right now" rides the same throttle: it
      // only runs when the agents array is being replaced anyway, so the
      // display line costs no additional renders. A tail of pure redraw noise
      // leaves the previous line standing rather than blanking it.
      ...(shouldBumpActivity
        ? {
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
    set({ agents });
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

  loadInterruptedAgents: async () => {
    try {
      const interrupted = await listInterruptedAgents();
      set({ interruptedAgents: interrupted });
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
                  | AgentConfig['permissionMode']
                  | undefined,
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
    return agent;
  },

  discardInterruptedAgent: async (agentId) => {
    try {
      await discardInterruptedAgent(agentId);
    } catch {
      // Already gone on the backend — removing it locally is still correct
    }
    set({ interruptedAgents: get().interruptedAgents.filter((a) => a.id !== agentId) });
  },

  killAgentsForRepoPath: async (repoPath) => {
    await killAgentsForRepo(repoPath);
    const { agents, agentLogs, agentLogMeta, minimizedAgentIds } = get();
    const killedIds = new Set(agents.filter((a) => a.repoPath === repoPath).map((a) => a.id));
    set({
      agents: agents.filter((a) => !killedIds.has(a.id)),
      agentLogs: Object.fromEntries(Object.entries(agentLogs).filter(([id]) => !killedIds.has(id))),
      agentLogMeta: Object.fromEntries(
        Object.entries(agentLogMeta).filter(([id]) => !killedIds.has(id))
      ),
      minimizedAgentIds: minimizedAgentIds.filter((id) => !killedIds.has(id)),
      agentColors: withoutColors(get().agentColors, (id) => killedIds.has(id)),
    });
  },
});
