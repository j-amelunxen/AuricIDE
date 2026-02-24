import type { StateCreator } from 'zustand';
import type { AgentConfig, AgentInfo } from '../tauri/agents';
import { killAgent, killAgentsForRepo, listAgents, spawnAgent } from '../tauri/agents';

export const MAX_AGENT_LOGS = 5_000;

export interface AgentSlice {
  agents: AgentInfo[];
  agentLogs: Record<string, string[]>;
  selectedAgentId: string | null;
  spawnNewAgent: (config: AgentConfig) => Promise<void>;
  killRunningAgent: (agentId: string) => Promise<void>;
  updateAgentStatus: (agentId: string, status: AgentInfo['status']) => void;
  appendAgentLog: (agentId: string, log: string) => void;
  refreshAgents: () => Promise<void>;
  selectAgent: (agentId: string | null) => void;
  killAgentsForRepoPath: (repoPath: string) => Promise<void>;
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
  selectedAgentId: null,

  spawnNewAgent: async (config) => {
    const agent = await spawnAgent(config);
    set({ agents: [...get().agents, agent] });
  },

  killRunningAgent: async (agentId) => {
    const agent = get().agents.find((a) => a.id === agentId);
    try {
      await killAgent(agentId);
    } catch {
      // Agent may have already terminated naturally — Rust side already cleaned up
    }
    const { agentLogs } = get();
    const { [agentId]: _, ...remainingLogs } = agentLogs;

    // If this agent was spawned for a specific ticket, mark it as done
    if (agent?.spawnedByTicketId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pmSlice = get() as any; // Access PmSlice via combined store
      if (pmSlice.updateTicket) {
        pmSlice.updateTicket(agent.spawnedByTicketId, { status: 'done' });
      }
    }

    set({ agents: get().agents.filter((a) => a.id !== agentId), agentLogs: remainingLogs });
  },

  updateAgentStatus: (agentId, status) => {
    set({
      agents: get().agents.map((a) => (a.id === agentId ? { ...a, status } : a)),
    });
  },

  appendAgentLog: (agentId, log) => {
    const state = get();
    const existing = state.agentLogs[agentId] ?? [];
    let updated = [...existing, log];

    if (updated.length > MAX_AGENT_LOGS) {
      updated = updated.slice(updated.length - MAX_AGENT_LOGS);
    }

    set({
      agentLogs: {
        ...state.agentLogs,
        [agentId]: updated,
      },
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, lastActivityAt: Date.now() } : a
      ),
    });
  },

  refreshAgents: async () => {
    const agents = await listAgents();
    set({ agents });
  },

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

  killAgentsForRepoPath: async (repoPath) => {
    await killAgentsForRepo(repoPath);
    set({ agents: get().agents.filter((a) => a.repoPath !== repoPath) });
  },
});
