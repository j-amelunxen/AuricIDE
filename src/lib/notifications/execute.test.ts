import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SPAWN_DEFAULTS_KEY } from '@/lib/agents/spawnDefaults';
import {
  buildSpawnConfig,
  executeNotificationAction,
  NotificationActionError,
  type NotificationActionDeps,
} from './execute';
import type { NotificationAction } from './types';

function makeDeps(): NotificationActionDeps {
  return {
    spawnAgent: vi.fn(async () => undefined),
    openSpawnDialog: vi.fn(),
    startSkillCombo: vi.fn(async () => undefined),
    projectDirExists: vi.fn(async () => true),
    openFile: vi.fn(),
    openTicket: vi.fn(),
    openGoal: vi.fn(),
    openAgent: vi.fn(),
    runCommand: vi.fn(),
  };
}

function unusedDeps(deps: NotificationActionDeps) {
  const { projectDirExists: _probe, ...rest } = deps;
  return rest;
}

const runSkill: Extract<NotificationAction, { kind: 'run-skill' }> = {
  id: 'run',
  label: 'Changelog starten',
  kind: 'run-skill',
  skillId: 's1',
  skillLabel: 'Changelog',
  prompt: '/changelog',
  repoPath: '/repo/sample',
  providerId: 'claude',
  model: 'opus',
  permissionMode: 'plan',
};

const runCombo: Extract<NotificationAction, { kind: 'run-combo' }> = {
  id: 'run',
  label: 'Blog-Write starten',
  kind: 'run-combo',
  comboId: 'c1',
  comboLabel: 'Blog-Write',
  repoPath: '/repo/sample',
  steps: [
    { id: 's1', label: 'Draft', prompt: '/draft' },
    { id: 's2', label: 'Polish', prompt: 'tighten the wording' },
  ],
};

async function expectActionError(
  run: Promise<void>,
  code: NotificationActionError['code'],
  message: string
) {
  const thrown = await run.then(
    () => {
      throw new Error('expected NotificationActionError');
    },
    (err: unknown) => err
  );
  expect(thrown).toBeInstanceOf(NotificationActionError);
  expect(thrown).toMatchObject({ code, message });
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

  it('opens the spawn dialog for a run-skill action and does not spawn', async () => {
    const deps = makeDeps();
    await executeNotificationAction(runSkill, deps);

    expect(deps.projectDirExists).toHaveBeenCalledWith('/repo/sample');
    expect(deps.openSpawnDialog).toHaveBeenCalledWith({
      task: '/changelog',
      repoPath: '/repo/sample',
      preset: {
        providerId: 'claude',
        model: 'opus',
        permissionMode: 'plan',
      },
    });
    expect(deps.spawnAgent).not.toHaveBeenCalled();
    expect(deps.startSkillCombo).not.toHaveBeenCalled();
  });

  it('opens the spawn dialog with a null preset when the skill pins no provider', async () => {
    const deps = makeDeps();
    await executeNotificationAction(
      { ...runSkill, providerId: undefined, model: undefined, permissionMode: undefined },
      deps
    );

    expect(deps.openSpawnDialog).toHaveBeenCalledWith({
      task: '/changelog',
      repoPath: '/repo/sample',
      preset: null,
    });
  });

  it('throws missing-project when the run-skill folder is gone', async () => {
    const deps = makeDeps();
    deps.projectDirExists = vi.fn(async () => false);

    await expectActionError(
      executeNotificationAction({ ...runSkill, repoPath: '/gone' }, deps),
      'missing-project',
      'Project folder not found: /gone'
    );

    expect(deps.projectDirExists).toHaveBeenCalledWith('/gone');
    for (const fn of Object.values(unusedDeps(deps))) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('treats a file path as missing for run-skill', async () => {
    const deps = makeDeps();
    deps.projectDirExists = vi.fn(async () => false);

    await expectActionError(
      executeNotificationAction({ ...runSkill, repoPath: '/repo/sample/README.md' }, deps),
      'missing-project',
      'Project folder not found: /repo/sample/README.md'
    );

    expect(deps.openSpawnDialog).not.toHaveBeenCalled();
    expect(deps.spawnAgent).not.toHaveBeenCalled();
  });

  it('starts a combo from the snapshot and does not spawn', async () => {
    const deps = makeDeps();
    await executeNotificationAction(runCombo, deps);

    expect(deps.projectDirExists).toHaveBeenCalledWith('/repo/sample');
    expect(deps.startSkillCombo).toHaveBeenCalledWith('/repo/sample', {
      id: 'c1',
      label: 'Blog-Write',
      steps: runCombo.steps,
    });
    expect(deps.spawnAgent).not.toHaveBeenCalled();
    expect(deps.openSpawnDialog).not.toHaveBeenCalled();
  });

  it('throws empty-combo when every step has an empty prompt', async () => {
    const deps = makeDeps();

    await expectActionError(
      executeNotificationAction(
        {
          ...runCombo,
          steps: [
            { id: 's1', label: 'Draft', prompt: '' },
            { id: 's2', label: 'Polish', prompt: '   ' },
          ],
        },
        deps
      ),
      'empty-combo',
      'Combo has no valid steps'
    );

    expect(deps.startSkillCombo).not.toHaveBeenCalled();
    expect(deps.spawnAgent).not.toHaveBeenCalled();
  });

  it('throws empty-combo when the snapshot lists no steps', async () => {
    const deps = makeDeps();

    await expectActionError(
      executeNotificationAction({ ...runCombo, steps: [] }, deps),
      'empty-combo',
      'Combo has no valid steps'
    );

    expect(deps.startSkillCombo).not.toHaveBeenCalled();
  });

  it('throws missing-project when the run-combo folder is gone', async () => {
    const deps = makeDeps();
    deps.projectDirExists = vi.fn(async () => false);

    await expectActionError(
      executeNotificationAction({ ...runCombo, repoPath: '/gone' }, deps),
      'missing-project',
      'Project folder not found: /gone'
    );

    expect(deps.startSkillCombo).not.toHaveBeenCalled();
    expect(deps.spawnAgent).not.toHaveBeenCalled();
  });
});
