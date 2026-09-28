import { describe, expect, it } from 'vitest';
import type { AgentConfig, AgentInfo } from '@/lib/tauri/agents';
import type { PmGoal } from '@/lib/tauri/goals';
import {
  countConductorGoalAgents,
  isConductorGoalAgent,
  liveConductorGoalAgentIds,
  type ConductorRunScope,
} from './conductorHelpers';

function agent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'a1',
    name: 'agent',
    model: 'sonnet',
    provider: 'claude',
    status: 'running',
    startedAt: 1,
    spawnedByGoalId: 'g1',
    ...overrides,
  } as AgentInfo;
}

const conductorConfig: Record<string, AgentConfig> = {
  a1: { name: 'agent', model: 'sonnet', task: '', runSource: 'conductor' },
};

const goal = (id: string, parentId: string | null = null) => ({ id, parentId }) as PmGoal;

/** A run on g1 in /repo, with g2 below it and a sibling tree g9. */
const runScope: ConductorRunScope = {
  rootPath: '/repo',
  goalId: 'g1',
  goals: [goal('g1'), goal('g2', 'g1'), goal('g9')],
};

describe('isConductorGoalAgent', () => {
  it('accepts a goal agent the conductor started', () => {
    expect(isConductorGoalAgent(agent(), conductorConfig)).toBe(true);
  });

  it('rejects a ticket agent, which the assignments already count', () => {
    expect(isConductorGoalAgent(agent({ spawnedByTicketId: 't1' }), conductorConfig)).toBe(false);
  });

  it('rejects a goal agent a person started', () => {
    const ui = { a1: { ...conductorConfig.a1, runSource: 'ui' as const } };
    expect(isConductorGoalAgent(agent(), ui)).toBe(false);
    expect(isConductorGoalAgent(agent(), {})).toBe(false);
  });
});

describe('countConductorGoalAgents', () => {
  it('counts running and queued ones, not finished ones', () => {
    const configs = {
      ...conductorConfig,
      a2: { ...conductorConfig.a1 },
      a3: { ...conductorConfig.a1 },
    };
    const agents = [
      agent(),
      agent({ id: 'a2', status: 'queued' }),
      agent({ id: 'a3', status: 'idle' }),
    ];
    expect(countConductorGoalAgents(agents, configs, runScope)).toBe(2);
  });
});

describe('the run a goal agent belongs to', () => {
  const configs = (...ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, { ...conductorConfig.a1 }]));

  it('counts agents on the run goal and anywhere below it', () => {
    const agents = [agent(), agent({ id: 'a2', spawnedByGoalId: 'g2' })];
    expect(countConductorGoalAgents(agents, configs('a1', 'a2'), runScope)).toBe(2);
  });

  it('leaves out an agent working a goal outside the run', () => {
    const agents = [agent(), agent({ id: 'a2', spawnedByGoalId: 'g9' })];
    expect(liveConductorGoalAgentIds(agents, configs('a1', 'a2'), runScope)).toEqual(['a1']);
  });

  it('leaves out an agent of another project, whatever its goal', () => {
    const agents = [agent(), agent({ id: 'a2', projectPath: '/other' })];
    expect(liveConductorGoalAgentIds(agents, configs('a1', 'a2'), runScope)).toEqual(['a1']);
    const wholeProject = { ...runScope, goalId: null };
    expect(liveConductorGoalAgentIds(agents, configs('a1', 'a2'), wholeProject)).toEqual(['a1']);
  });

  it('keeps an agent of this project', () => {
    const agents = [agent({ projectPath: '/repo' })];
    expect(countConductorGoalAgents(agents, configs('a1'), runScope)).toBe(1);
  });
});
