import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordAgentPromptHistory, spawnAgent } from '../tauri/agents';
import { useStore } from './index';
import type { QuickAccessCombo } from './starredProjectsSlice';
import { FALLBACK_CRUSH_PROVIDER } from '../tauri/providers';

vi.mock('../tauri/agents', () => {
  let n = 0;
  return {
    spawnAgent: vi.fn(
      async (config: { name: string; model: string; task: string; provider?: string }) => ({
        id: `combo-agent-${++n}`,
        name: config.name,
        model: config.model,
        provider: config.provider ?? 'claude',
        status: 'running' as const,
        currentTask: config.task,
        startedAt: 1000 + n,
        repoPath: '/a/website',
      })
    ),
    killAgent: vi.fn(async () => undefined),
    recordAgentPromptHistory: vi.fn(async () => undefined),
    killAgentsForRepo: vi.fn(async () => 0),
    renameAgent: vi.fn(async () => undefined),
    listAgents: vi.fn(async () => []),
    listInterruptedAgents: vi.fn(async () => []),
    resumeInterruptedAgent: vi.fn(async () => ({
      id: 'x',
      name: 'x',
      model: 'm',
      provider: 'claude',
      status: 'running' as const,
      startedAt: 1,
    })),
    discardInterruptedAgent: vi.fn(async () => undefined),
    listAgentPromptHistory: vi.fn(async () => []),
  };
});

const claude = {
  id: 'claude',
  name: 'Claude',
  models: [{ value: 'opus', label: 'Opus' }],
  permissionModes: [{ value: 'plan', label: 'Plan', description: '' }],
  defaultModel: 'sonnet',
  defaultPermissionMode: 'plan',
};

const grok = {
  id: 'grok',
  name: 'Grok',
  models: [{ value: 'grok-4', label: 'Grok 4' }],
  permissionModes: [{ value: 'default', label: 'Default', description: '' }],
  defaultModel: 'grok-4',
  defaultPermissionMode: 'default',
};

const blogWrite: QuickAccessCombo = {
  id: 'c1',
  label: 'Draft and polish',
  steps: [
    {
      id: 's1',
      label: 'Draft',
      prompt: '/draft',
      providerId: 'claude',
      model: 'opus',
      permissionMode: 'plan',
    },
    {
      id: 's2',
      label: 'Rewrite',
      prompt: 'tighten the wording',
      providerId: 'grok',
      model: 'grok-4',
    },
    {
      id: 's3',
      label: 'Polish',
      prompt: '/polish',
      providerId: 'claude',
    },
  ],
};

describe('skillComboSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      agents: [],
      agentLogs: {},
      agentLogMeta: {},
      agentSpawnConfigs: {},
      comboRuns: [],
      providers: [claude, grok],
      starredProjects: [],
      toasts: [],
    });
  });

  it("spawns the first step with that step's provider and model", async () => {
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    expect(spawnAgent).toHaveBeenCalledTimes(1);
    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        task: '/draft',
        provider: 'claude',
        model: 'opus',
        permissionMode: 'plan',
        cwd: '/a/website',
      })
    );
    const [agent] = useStore.getState().agents;
    expect(agent.currentTask).toBe('/draft');
    expect(useStore.getState().comboStepForAgent(agent.id)).toEqual({
      label: 'Draft and polish',
      stepLabel: 'Draft',
      stepIndex: 0,
      total: 3,
    });
  });

  it('starts the next step when the current agent is killed — that is not a combo kill', async () => {
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    const first = useStore.getState().agents[0];
    await useStore.getState().killRunningAgent(first.id);
    expect(useStore.getState().agents.map((a) => a.currentTask)).toEqual(['tighten the wording']);
    expect(spawnAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        task: 'tighten the wording',
        provider: 'grok',
        model: 'grok-4',
      })
    );
    const second = useStore.getState().agents[0];
    expect(useStore.getState().comboStepForAgent(second.id)?.stepIndex).toBe(1);
  });

  it('starts the next step when a finished agent is dismissed', async () => {
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    const first = useStore.getState().agents[0];
    useStore.getState().updateAgentStatus(first.id, 'idle');
    useStore.getState().dismissFinishedAgent(first.id);
    await vi.waitFor(() => {
      expect(useStore.getState().agents[0]?.currentTask).toBe('tighten the wording');
    });
  });

  it('does not start the next step just because the agent finished — review comes first', async () => {
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    const first = useStore.getState().agents[0];
    useStore.getState().updateAgentStatus(first.id, 'idle');
    expect(useStore.getState().agents).toHaveLength(1);
    expect(spawnAgent).toHaveBeenCalledTimes(1);
  });

  it('stops after the last step instead of looping', async () => {
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    for (let i = 0; i < 3; i++) {
      const current = useStore.getState().agents[0];
      await useStore.getState().killRunningAgent(current.id);
    }
    expect(useStore.getState().agents).toHaveLength(0);
    expect(useStore.getState().comboRuns).toHaveLength(0);
    expect(spawnAgent).toHaveBeenCalledTimes(3);
  });

  it('cancelling the combo lets the current agent die without starting the next', async () => {
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    const [run] = useStore.getState().comboRuns;
    useStore.getState().cancelSkillCombo(run.id);
    await useStore.getState().killRunningAgent(useStore.getState().agents[0].id);
    expect(useStore.getState().agents).toHaveLength(0);
    expect(spawnAgent).toHaveBeenCalledTimes(1);
  });

  it('killing every agent in the repo cancels the combo instead of chaining', async () => {
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    await useStore.getState().killAgentsForRepoPath('/a/website');
    expect(useStore.getState().comboRuns).toHaveLength(0);
    expect(spawnAgent).toHaveBeenCalledTimes(1);
  });

  it('refuses a second start of the same combo while one is already running', async () => {
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    expect(spawnAgent).toHaveBeenCalledTimes(1);
    expect(useStore.getState().toasts[0]?.message).toMatch(/already running/i);
  });

  it('falls back to the provider default when a step pins no model', async () => {
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    const first = useStore.getState().agents[0];
    await useStore.getState().killRunningAgent(first.id);
    const second = useStore.getState().agents[0];
    await useStore.getState().killRunningAgent(second.id);
    expect(spawnAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        task: '/polish',
        provider: 'claude',
        model: 'sonnet',
      })
    );
  });

  it('uses the fallback provider when a step pins none', async () => {
    useStore.setState({ providers: [FALLBACK_CRUSH_PROVIDER] });
    await useStore.getState().startSkillCombo('/a/website', {
      id: 'c2',
      label: 'Plain',
      steps: [
        { id: 'a', label: 'One', prompt: '/one' },
        { id: 'b', label: 'Two', prompt: '/two' },
      ],
    });
    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: FALLBACK_CRUSH_PROVIDER.id,
        model: FALLBACK_CRUSH_PROVIDER.defaultModel,
      })
    );
  });
});

/**
 * Each step is a fresh process with no memory of the one before it — no CLI in
 * the registry can resume another session, and a chain may switch harness
 * between steps. What carries is the previous session's terminal tail, pasted
 * into the next step's instruction.
 */
describe('skill combo handoff', () => {
  const lastTask = () => vi.mocked(spawnAgent).mock.calls.at(-1)![0].task;

  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      agents: [],
      agentLogs: {},
      agentLogMeta: {},
      agentSpawnConfigs: {},
      comboRuns: [],
      providers: [claude, grok],
      starredProjects: [],
      toasts: [],
      rootPath: '/a/website',
    });
  });

  it('starts the first step with its prompt alone — nothing came before it', async () => {
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    expect(lastTask()).toBe('/draft');
  });

  it("carries the killed step's output into the next step's instruction", async () => {
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    const first = useStore.getState().agents[0];
    useStore.getState().appendAgentLog(first.id, 'Wrote draft.md, 42 lines\n');

    await useStore.getState().killRunningAgent(first.id);

    const task = lastTask();
    // The step's own prompt still leads, or a leading slash would stop being
    // a command.
    expect(task.startsWith('tighten the wording')).toBe(true);
    expect(task).toContain('Wrote draft.md, 42 lines');
    expect(task).toContain('Draft');
  });

  it('carries output on the dismiss path too — review first is the normal route', async () => {
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    const first = useStore.getState().agents[0];
    useStore.getState().appendAgentLog(first.id, 'Draft complete.\n');
    useStore.getState().updateAgentStatus(first.id, 'idle');

    useStore.getState().dismissFinishedAgent(first.id);

    await vi.waitFor(() => {
      expect(lastTask()).toContain('Draft complete.');
    });
  });

  it('hands over a plain prompt when the step produced nothing worth carrying', async () => {
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    const first = useStore.getState().agents[0];
    useStore.getState().appendAgentLog(first.id, 'esc to interrupt\n');

    await useStore.getState().killRunningAgent(first.id);

    expect(lastTask()).toBe('tighten the wording');
  });

  it('remembers the step prompt in history, not the handoff dump', async () => {
    // Recall in the spawn dialog is a list of things a person typed. A 2000
    // character terminal tail in there would bury every real entry.
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    const first = useStore.getState().agents[0];
    useStore.getState().appendAgentLog(first.id, 'Wrote draft.md\n');

    await useStore.getState().killRunningAgent(first.id);

    expect(recordAgentPromptHistory).toHaveBeenLastCalledWith(
      '/a/website',
      expect.objectContaining({ prompt: 'tighten the wording' })
    );
  });

  it('carries output between two different harnesses', async () => {
    // Step one runs on Claude, step two on Grok. Nothing about the handoff
    // may depend on which CLI wrote the output.
    await useStore.getState().startSkillCombo('/a/website', blogWrite);
    const first = useStore.getState().agents[0];
    expect(first.provider).toBe('claude');
    useStore.getState().appendAgentLog(first.id, '⏺ Wrote src/draft.md\n');

    await useStore.getState().killRunningAgent(first.id);

    expect(vi.mocked(spawnAgent).mock.calls.at(-1)![0].provider).toBe('grok');
    expect(lastTask()).toContain('⏺ Wrote src/draft.md');
  });
});
