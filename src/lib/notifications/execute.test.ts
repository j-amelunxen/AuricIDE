import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SPAWN_DEFAULTS_KEY } from '@/lib/agents/spawnDefaults';
import {
  buildSpawnConfig,
  executeNotificationAction,
  type NotificationActionDeps,
} from './execute';
import type { NotificationAction } from './types';

function makeDeps(): NotificationActionDeps {
  return {
    spawnAgent: vi.fn(async () => undefined),
    openFile: vi.fn(),
    openTicket: vi.fn(),
    openGoal: vi.fn(),
    openAgent: vi.fn(),
    runCommand: vi.fn(),
  };
}

const REMEMBERED = {
  providerId: 'claude',
  model: 'opus',
  permissionMode: 'acceptEdits',
  headless: true,
};

describe('buildSpawnConfig', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const action: Extract<NotificationAction, { kind: 'spawn-agent' }> = {
    id: 'run',
    label: 'Agent starten',
    kind: 'spawn-agent',
    task: 'Serverscan durchführen',
  };

  it('names the agent from the task', () => {
    expect(buildSpawnConfig(action).name).toBeTruthy();
  });

  it('takes provider, model and permission mode from the last launch', () => {
    localStorage.setItem(SPAWN_DEFAULTS_KEY, JSON.stringify(REMEMBERED));

    const config = buildSpawnConfig(action);

    expect(config.provider).toBe('claude');
    expect(config.model).toBe('opus');
    expect(config.permissionMode).toBe('acceptEdits');
    expect(config.headless).toBe(true);
  });

  it('falls back to a model when nothing was ever launched', () => {
    expect(buildSpawnConfig(action).model).toBe('sonnet');
  });

  it('honours an explicit model and provider from the payload', () => {
    localStorage.setItem(SPAWN_DEFAULTS_KEY, JSON.stringify(REMEMBERED));

    const config = buildSpawnConfig({ ...action, model: 'haiku', provider: 'codex' });

    expect(config.model).toBe('haiku');
    expect(config.provider).toBe('codex');
  });

  // The payload may have been written by an agent or a schedule. How much
  // authority the new agent gets is not its call.
  it('never takes the permission mode from the payload', () => {
    localStorage.setItem(SPAWN_DEFAULTS_KEY, JSON.stringify(REMEMBERED));

    const config = buildSpawnConfig({
      ...action,
      permissionMode: 'bypassPermissions',
    } as never);

    expect(config.permissionMode).toBe('acceptEdits');
  });

  it('runs in the repo the action names', () => {
    expect(buildSpawnConfig({ ...action, repoPath: '/repo/sample' }).cwd).toBe('/repo/sample');
  });

  it('falls back to the current project when the action names no repo', () => {
    expect(buildSpawnConfig(action, '/repo/current').cwd).toBe('/repo/current');
  });

  it('carries the ticket and goal provenance through', () => {
    const config = buildSpawnConfig({ ...action, ticketId: 't1', goalId: 'g1' });
    expect(config.spawnedByTicketId).toBe('t1');
    expect(config.spawnedByGoalId).toBe('g1');
  });
});

describe('executeNotificationAction', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('spawns an agent for a spawn-agent action', async () => {
    const deps = makeDeps();
    await executeNotificationAction(
      { id: 'run', label: 'Start', kind: 'spawn-agent', task: 'scan' },
      deps
    );

    expect(deps.spawnAgent).toHaveBeenCalledWith(expect.objectContaining({ task: 'scan' }));
  });

  it.each([
    ['file', { type: 'file', path: '/a/b.md' }, 'openFile', ['/a/b.md', undefined]],
    ['file with line', { type: 'file', path: '/a/b.md', line: 7 }, 'openFile', ['/a/b.md', 7]],
    ['ticket', { type: 'ticket', ticketId: 't1' }, 'openTicket', ['t1']],
    ['goal', { type: 'goal', goalId: 'g1' }, 'openGoal', ['g1']],
    ['agent', { type: 'agent', agentId: 'a1' }, 'openAgent', ['a1']],
  ])('routes an open action for a %s', async (_label, target, method, args) => {
    const deps = makeDeps();
    await executeNotificationAction(
      { id: 'go', label: 'Öffnen', kind: 'open', target } as NotificationAction,
      deps
    );

    expect(deps[method as keyof NotificationActionDeps]).toHaveBeenCalledWith(...args);
  });

  it('dispatches a command action by id', async () => {
    const deps = makeDeps();
    await executeNotificationAction(
      { id: 'c', label: 'Commit', kind: 'command', commandId: 'git.commit' },
      deps
    );

    expect(deps.runCommand).toHaveBeenCalledWith('git.commit');
  });

  // Recording the answer belongs to the caller, which stamps it for every
  // action on a question — so this one does nothing else on purpose.
  it('has no side effect for an answer action', async () => {
    const deps = makeDeps();
    await executeNotificationAction({ id: 'no', label: 'Nein', kind: 'answer', value: 'no' }, deps);

    for (const fn of Object.values(deps)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('propagates a failed spawn so the caller can report it', async () => {
    const deps = makeDeps();
    deps.spawnAgent = vi.fn(async () => {
      throw new Error('no backend');
    });

    await expect(
      executeNotificationAction(
        { id: 'run', label: 'Start', kind: 'spawn-agent', task: 'scan' },
        deps
      )
    ).rejects.toThrow('no backend');
  });
});
