import { deriveErrorDigest } from '@/lib/agents/errorDigest';
import { pushHeartbeat } from '@/lib/agents/events/heartbeat';
import { flushAgentLog } from '@/lib/agents/events/persistence';
import { drainHeartbeatKinds } from '@/lib/agents/events/registry';
import { isFinishedAgent } from '@/lib/agents/fleet';
import { announceHeadlessFinish, shouldNotifyHeadlessFinish } from '@/lib/agents/headlessFinish';
import { uniqueAgentName } from '@/lib/agents/naming';
import { prependTicketSkills } from '@/lib/pm/ticketSkills';
import type { AgentConfig, AgentInfo } from '@/lib/tauri/agents';
import {
  discardInterruptedAgent as discardInterruptedAgentApi,
  killAgent,
  killAgentsForRepo,
  recordAgentPromptHistory,
  renameAgent,
  resumeInterruptedAgent as resumeInterruptedAgentApi,
  spawnAgent,
} from '@/lib/tauri/agents';
import type { PmGoalRun } from '@/lib/tauri/goals';
import type { NotificationInput } from '@/lib/tauri/notifications';
import type { PmTicket } from '@/lib/tauri/pm';
import type { GoalsSlice } from '../goalsSlice';
import type { EndedStep } from '../skillComboSlice';
import {
  completeRunForAgent,
  reconcileAgentRuntimeState,
  willConductorRetry,
  withoutAgentRecords,
  withoutColors,
} from './agentStateHelpers';
import { MAX_FINISHED_AGENTS, UNGROUPED_REPO_KEY, type AgentSlice } from './agentTypes';

export async function handleSpawnNewAgent(
  config: AgentConfig,
  get: () => AgentSlice,
  set: (fn: ((s: AgentSlice) => Partial<AgentSlice>) | Partial<AgentSlice>) => void
): Promise<AgentInfo> {
  let spawnConfig = config;
  if (config.useWorktree) {
    const repo = config.worktreeRepoPath || config.cwd;
    const toast = get() as AgentSlice & {
      showToast?: (message: string, variant?: 'info' | 'success' | 'error') => number;
      refreshAgentWorktrees?: () => Promise<void>;
    };
    if (!repo) {
      const msg = 'A git worktree needs a working directory.';
      toast.showToast?.(msg, 'error');
      throw new Error(msg);
    }
    try {
      const { addGitWorktree } = await import('@/lib/tauri/git');
      const worktree = await addGitWorktree(repo, config.name);
      const { useWorktree: _flag, worktreeRepoPath: _source, ...rest } = config;
      spawnConfig = { ...rest, cwd: worktree.path };
      void toast.refreshAgentWorktrees?.();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const msg = `Could not create a git worktree: ${detail}`;
      toast.showToast?.(msg, 'error');
      throw err instanceof Error ? err : new Error(msg);
    }
  }
  if (spawnConfig.spawnedByTicketId) {
    const tickets = (get() as AgentSlice & { pmDraftTickets?: PmTicket[] }).pmDraftTickets ?? [];
    const ticket = tickets.find((entry) => entry.id === spawnConfig.spawnedByTicketId);
    if (ticket) {
      spawnConfig = {
        ...spawnConfig,
        task: prependTicketSkills(ticket.skills, spawnConfig.task),
      };
    }
  }
  const agent = await spawnAgent(spawnConfig);
  const name = uniqueAgentName(
    agent.name,
    get().agents.map((a) => a.name)
  );
  const named = name === agent.name ? agent : { ...agent, name };
  set({
    agents: [...get().agents, named],
    agentSpawnConfigs: { ...get().agentSpawnConfigs, [agent.id]: spawnConfig },
  });

  if (name !== agent.name) {
    try {
      renameAgent(agent.id, name).catch(() => {});
    } catch {
      // No backend at all (browser/test mode).
    }
  }

  const { rootPath } = get() as AgentSlice & { rootPath?: string | null };
  const remembered = config.historyPrompt ?? config.task;
  if (rootPath && remembered.trim()) {
    recordAgentPromptHistory(rootPath, {
      id: crypto.randomUUID(),
      prompt: remembered,
      agentName: name,
      model: config.model,
      provider: config.provider ?? agent.provider,
      cwd: spawnConfig.cwd ?? agent.repoPath ?? null,
      source: config.runSource ?? 'ui',
    }).catch(() => {});
  }

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
}

export async function handleRetryFailedAgent(
  agentId: string,
  get: () => AgentSlice
): Promise<AgentInfo | null> {
  const state = get();
  const failed = state.agents.find((a) => a.id === agentId);
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
  const combo = get() as AgentSlice & {
    rebindSkillComboAgent?: (fromAgentId: string, toAgentId: string) => void;
  };
  combo.rebindSkillComboAgent?.(agentId, replacement.id);
  get().dismissFinishedAgent(agentId);
  return replacement;
}

export async function handleKillRunningAgent(
  agentId: string,
  get: () => AgentSlice,
  set: (fn: ((s: AgentSlice) => Partial<AgentSlice>) | Partial<AgentSlice>) => void
): Promise<void> {
  const agent = get().agents.find((a) => a.id === agentId);
  try {
    await killAgent(agentId);
  } catch {
    // Agent may have already terminated naturally
  }
  const endedLogs = get().agentLogs[agentId] ?? [];

  const conductor = get() as AgentSlice & {
    conductorAssignments?: Record<string, string>;
    conductorReviewAssignments?: Record<string, string>;
    conductorHandleAgentKilled?: (agentId: string) => void;
  };
  const isConductorAgent =
    (!!conductor.conductorAssignments &&
      Object.values(conductor.conductorAssignments).includes(agentId)) ||
    (!!conductor.conductorReviewAssignments &&
      Object.values(conductor.conductorReviewAssignments).includes(agentId));

  if (isConductorAgent) {
    conductor.conductorHandleAgentKilled?.(agentId);
  } else if (agent?.spawnedByTicketId) {
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

  void flushAgentLog();

  const combo = get() as AgentSlice & {
    skillComboHandleAgentEnded?: (agentId: string, ended: EndedStep) => Promise<void>;
  };
  await combo.skillComboHandleAgentEnded?.(agentId, {
    logs: endedLogs,
    failed: agent?.status === 'error',
  });
}

export function handleDismissFinishedAgent(
  agentId: string,
  get: () => AgentSlice,
  set: (fn: ((s: AgentSlice) => Partial<AgentSlice>) | Partial<AgentSlice>) => void
): void {
  const { agents, agentLogs, minimizedAgentIds } = get();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent || !isFinishedAgent(agent)) return;

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

  const combo = get() as AgentSlice & {
    skillComboHandleAgentEnded?: (agentId: string, ended: EndedStep) => Promise<void>;
  };
  void combo.skillComboHandleAgentEnded?.(agentId, {
    logs: endedLogs,
    failed: agent.status === 'error',
  });
}

export function handleUpdateAgentStatus(
  agentId: string,
  status: AgentInfo['status'],
  get: () => AgentSlice,
  set: (fn: ((s: AgentSlice) => Partial<AgentSlice>) | Partial<AgentSlice>) => void
): void {
  const agent = get().agents.find((a) => a.id === agentId);
  if (status === 'error') {
    if (agent && agent.status !== 'error' && !willConductorRetry(get(), agentId)) {
      const toaster = get() as AgentSlice & {
        showToast?: (message: string, variant?: 'error' | 'success' | 'info') => number;
      };
      toaster.showToast?.(`${agent.name} failed · see row output`, 'error');
      const inbox = get() as AgentSlice & {
        dispatchNotification?: (input: NotificationInput) => Promise<unknown>;
      };
      void inbox.dispatchNotification?.({
        source: 'system',
        origin: agent.name,
        severity: 'error',
        title: `${agent.name} failed`,
        body: deriveErrorDigest(get().agentLogs[agentId] ?? []),
        projectPath: agent.repoPath ?? null,
        projectName: agent.repoPath?.split('/').pop() ?? null,
        refKind: 'agent',
        refId: agentId,
        dedupeKey: `agent:${agentId}:error`,
        actions: [
          { id: 'logs', label: 'Open logs', kind: 'open', target: { type: 'agent', agentId } },
        ],
      });
    }
  }
  if (
    status === 'idle' &&
    agent &&
    !isFinishedAgent(agent) &&
    shouldNotifyHeadlessFinish(get().agentSpawnConfigs[agentId])
  ) {
    const spawn = get().agentSpawnConfigs[agentId];
    const repoPath = agent.repoPath ?? spawn?.cwd ?? null;
    const inbox = get() as AgentSlice & {
      dispatchNotification?: (input: NotificationInput) => Promise<unknown>;
      llmConfigured?: boolean;
      rootPath?: string | null;
    };
    void announceHeadlessFinish({
      agentId,
      name: agent.name,
      repoPath,
      logs: get().agentLogs[agentId] ?? [],
      task: agent.currentTask,
      llmConfigured: inbox.llmConfigured === true,
      projectPath: repoPath ?? inbox.rootPath ?? null,
      dispatch: inbox.dispatchNotification,
    });
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

  const finishing = stopped && !!agent && !isFinishedAgent(agent);
  if (finishing) {
    const finalKinds = drainHeartbeatKinds(agentId);
    if (finalKinds.length > 0) {
      set({
        agentHeartbeat: {
          ...get().agentHeartbeat,
          [agentId]: pushHeartbeat(get().agentHeartbeat[agentId] ?? [], finalKinds, Date.now()),
        },
      });
    }
    void flushAgentLog();
  }

  const updatedAgents = get().agents.map((a) =>
    a.id === agentId
      ? {
          ...a,
          status,
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
    agentLogs: Object.fromEntries(Object.entries(agentLogs).filter(([id]) => !evictedIds.has(id))),
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
}

export async function handleKillAgentsForRepoPath(
  repoPath: string,
  get: () => AgentSlice,
  set: (fn: ((s: AgentSlice) => Partial<AgentSlice>) | Partial<AgentSlice>) => void
): Promise<void> {
  const ungrouped = repoPath === UNGROUPED_REPO_KEY;
  const belongs = (a: AgentInfo) => (ungrouped ? !a.repoPath : a.repoPath === repoPath);
  if (ungrouped) {
    await Promise.all(
      get()
        .agents.filter(belongs)
        .map((a) => killAgent(a.id).catch(() => undefined))
    );
  } else {
    try {
      await killAgentsForRepo(repoPath);
    } catch {
      // Best effort: backend may have already exited
    }
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

  void flushAgentLog();
}

export async function handleResumeInterruptedAgent(
  agentId: string,
  get: () => AgentSlice,
  set: (update: Partial<AgentSlice>) => void
): Promise<AgentInfo> {
  const interrupted = get().interruptedAgents.find((a) => a.id === agentId);
  const agent = await resumeInterruptedAgentApi(agentId);
  set({
    interruptedAgents: get().interruptedAgents.filter((a) => a.id !== agentId),
    agents: [...get().agents, agent],
    selectedAgentId: agent.id,
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
  const comboResume = get() as AgentSlice & {
    rebindSkillComboAgent?: (fromAgentId: string, toAgentId: string) => void;
  };
  comboResume.rebindSkillComboAgent?.(agentId, agent.id);
  return agent;
}

export async function handleDiscardInterruptedAgent(
  agentId: string,
  get: () => AgentSlice,
  set: (update: Partial<AgentSlice>) => void
): Promise<void> {
  try {
    await discardInterruptedAgentApi(agentId);
  } catch {
    // Already gone on backend
  }
  set({ interruptedAgents: get().interruptedAgents.filter((a) => a.id !== agentId) });
  const combo = get() as AgentSlice & {
    cancelSkillCombosForAgents?: (agentIds: string[]) => void;
  };
  combo.cancelSkillCombosForAgents?.([agentId]);
}
