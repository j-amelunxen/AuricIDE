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
  resumeInterruptedAgent,
  spawnAgent,
} from '../tauri/agents';
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
  /** Previously used start prompts for the open project, newest first. */
  promptHistory: string[];
  loadPromptHistory: (projectPath: string) => Promise<void>;
  spawnNewAgent: (config: AgentConfig) => Promise<AgentInfo>;
  killRunningAgent: (agentId: string) => Promise<void>;
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

export function groupAgentsByRepo(agents: AgentInfo[]): Record<string, AgentInfo[]> {
  const groups: Record<string, AgentInfo[]> = {};
  for (const agent of agents) {
    const key = agent.repoPath ?? 'Unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(agent);
  }
  return groups;
}

export const createAgentSlice: StateCreator<AgentSlice> = (set, get) => ({
  agents: [],
  agentLogs: {},
  agentLogMeta: {},
  selectedAgentId: null,
  interruptedAgents: [],
  promptHistory: [],

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
    set({ agents: [...get().agents, agent] });

    // Remember the start prompt in the project DB (last 100). Fire-and-forget:
    // history bookkeeping must never fail or delay the spawn itself.
    const { rootPath } = get() as AgentSlice & { rootPath?: string | null };
    if (rootPath && config.task.trim()) {
      recordAgentPromptHistory(rootPath, {
        id: crypto.randomUUID(),
        prompt: config.task,
        agentName: config.name,
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
    return agent;
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
    });
  },

  updateAgentStatus: (agentId, status) => {
    if (status === 'idle' || status === 'error') {
      completeRunForAgent(get(), agentId, status === 'idle' ? 'completed' : 'failed');
      const conductor = get() as AgentSlice & {
        conductorHandleAgentStatus?: (agentId: string, status: AgentInfo['status']) => void;
      };
      conductor.conductorHandleAgentStatus?.(agentId, status);
    }
    const { agentLogs, agentLogMeta } = get();
    const updatedAgents = get().agents.map((a) => (a.id === agentId ? { ...a, status } : a));

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
    // fleet panel, goal badges) to recompute many times per second.
    const agent = state.agents.find((a) => a.id === agentId);
    const now = Date.now();
    const shouldBumpActivity = agent !== undefined && now - (agent.lastActivityAt ?? 0) > 2_000;

    set({
      agentLogs: {
        ...state.agentLogs,
        [agentId]: updated,
      },
      agentLogMeta: {
        ...state.agentLogMeta,
        [agentId]: { seq: meta.seq + 1, bytes },
      },
      ...(shouldBumpActivity
        ? {
            agents: state.agents.map((a) => (a.id === agentId ? { ...a, lastActivityAt: now } : a)),
          }
        : {}),
    });
  },

  refreshAgents: async () => {
    const agents = await listAgents();
    set({ agents });
  },

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

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
    const agent = await resumeInterruptedAgent(agentId);
    set({
      interruptedAgents: get().interruptedAgents.filter((a) => a.id !== agentId),
      agents: [...get().agents, agent],
      selectedAgentId: agent.id,
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
    const { agents, agentLogs, agentLogMeta } = get();
    const killedIds = new Set(agents.filter((a) => a.repoPath === repoPath).map((a) => a.id));
    set({
      agents: agents.filter((a) => !killedIds.has(a.id)),
      agentLogs: Object.fromEntries(Object.entries(agentLogs).filter(([id]) => !killedIds.has(id))),
      agentLogMeta: Object.fromEntries(
        Object.entries(agentLogMeta).filter(([id]) => !killedIds.has(id))
      ),
    });
  },
});
