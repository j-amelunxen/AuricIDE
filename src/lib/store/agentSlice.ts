import type { StateCreator } from 'zustand';
import { isFinishedAgent } from '../agents/fleet';
import {
  listAgentPromptHistory,
  listAgents,
  listInterruptedAgents,
  renameAgent,
  sendToAgent,
} from '../tauri/agents';
import {
  handleDiscardInterruptedAgent,
  handleDismissFinishedAgent,
  handleKillAgentsForRepoPath,
  handleKillRunningAgent,
  handleResumeInterruptedAgent,
  handleRetryFailedAgent,
  handleSpawnNewAgent,
  handleUpdateAgentStatus,
} from './agent/agentLifecycle';
import { handleAppendAgentLog, handleLoadAgentLogHistory } from './agent/agentLogOperations';
import { reconcileAgentRuntimeState } from './agent/agentStateHelpers';
import { MAX_RECALLED_PROMPTS, MAX_SENT_MESSAGES, type AgentSlice } from './agent/agentTypes';

export {
  MAX_AGENT_EVENTS,
  MAX_AGENT_LOG_BYTES,
  MAX_AGENT_LOGS,
  MAX_FINISHED_AGENTS,
  MAX_LOADED_HISTORY,
  MAX_RECALLED_PROMPTS,
  MAX_SENT_MESSAGES,
  UNGROUPED_REPO_KEY,
  type AgentLogMeta,
  type AgentSlice,
  type SentMessage,
} from './agent/agentTypes';

export { groupAgentsByRepo } from './agent/agentStateHelpers';

export const createAgentSlice: StateCreator<AgentSlice> = (set, get) => ({
  agents: [],
  agentLogs: {},
  agentLogMeta: {},
  agentEvents: {},
  agentStreamLines: {},
  agentLogHistory: [],
  agentHeartbeat: {},
  selectedAgentId: null,
  interruptedAgents: [],
  minimizedAgentIds: [],
  collapsedAgentRepos: [],
  agentColors: {},
  reviewedAgentIds: [],
  agentSpawnConfigs: {},
  promptHistory: [],
  mutedAgentIds: [],
  laneSeenAt: {},
  agentSentMessages: {},

  setAgentColor: (agentId, color) => {
    const { [agentId]: _cleared, ...rest } = get().agentColors;
    set({ agentColors: color ? { ...rest, [agentId]: color } : rest });
  },

  toggleAgentMuted: (agentId) => {
    const current = get().mutedAgentIds;
    set({
      mutedAgentIds: current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId],
    });
  },

  markLaneSeen: (agentId, at) => {
    const current = get().laneSeenAt[agentId];
    if (current !== undefined && current >= at) return;
    set({ laneSeenAt: { ...get().laneSeenAt, [agentId]: at } });
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

  spawnNewAgent: (config) => handleSpawnNewAgent(config, get, set),

  retryFailedAgent: (agentId) => handleRetryFailedAgent(agentId, get),

  killRunningAgent: (agentId) => handleKillRunningAgent(agentId, get, set),

  sendAgentInput: async (agentId, text) => {
    await sendToAgent(agentId, text);

    const trimmed = text.trim();
    if (!trimmed) return;

    const existing = get().agentSentMessages[agentId] ?? [];
    const seq = existing.length > 0 ? existing[existing.length - 1].seq + 1 : 0;
    const updated = [...existing, { text: trimmed, at: Date.now(), seq }].slice(-MAX_SENT_MESSAGES);
    set({ agentSentMessages: { ...get().agentSentMessages, [agentId]: updated } });
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
      // Browser mode, or the agent already exited on the Rust side.
    }
  },

  dismissFinishedAgent: (agentId) => handleDismissFinishedAgent(agentId, get, set),

  updateAgentStatus: (agentId, status) => handleUpdateAgentStatus(agentId, status, get, set),

  appendAgentLog: (agentId, log) => handleAppendAgentLog(agentId, log, get, set),

  loadAgentLogHistory: () => handleLoadAgentLogHistory(set),

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
      const combo = get() as AgentSlice & {
        reconcileSkillCombos?: (reachableAgentIds: string[]) => void;
      };
      combo.reconcileSkillCombos?.([
        ...interrupted.map((a) => a.id),
        ...get().agents.map((a) => a.id),
      ]);
    } catch {
      // Browser mode or backend unavailable
    }
  },

  resumeInterruptedAgent: (agentId) => handleResumeInterruptedAgent(agentId, get, set),

  discardInterruptedAgent: (agentId) => handleDiscardInterruptedAgent(agentId, get, set),

  killAgentsForRepoPath: (repoPath) => handleKillAgentsForRepoPath(repoPath, get, set),
});
