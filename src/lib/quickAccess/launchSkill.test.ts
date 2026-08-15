import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openSkillSpawnDialog } from './launchSkill';
import { saveAuricSkills } from '../settings/auricSkills';

function makeStore() {
  return {
    setSpawnAgentTicketId: vi.fn(),
    setSpawnAgentGoalId: vi.fn(),
    setInitialAgentTask: vi.fn(),
    setSpawnAgentPreset: vi.fn(),
    setSpawnAgentRepoPath: vi.fn(),
    setSpawnDialogOpen: vi.fn(),
  };
}

describe('openSkillSpawnDialog', () => {
  beforeEach(() => saveAuricSkills([]));

  it('clears leftover ticket and goal, then opens the dialog for the repo', () => {
    const store = makeStore();

    openSkillSpawnDialog(store, '/repo/sample');

    expect(store.setSpawnAgentTicketId).toHaveBeenCalledWith(null);
    expect(store.setSpawnAgentGoalId).toHaveBeenCalledWith(null);
    expect(store.setInitialAgentTask).toHaveBeenCalledWith('');
    expect(store.setSpawnAgentPreset).toHaveBeenCalledWith(null);
    expect(store.setSpawnAgentRepoPath).toHaveBeenCalledWith('/repo/sample');
    expect(store.setSpawnDialogOpen).toHaveBeenCalledWith(true);
  });

  it('prefills the task and preset from a skill that names a provider', () => {
    const store = makeStore();

    openSkillSpawnDialog(store, '/repo/sample', {
      prompt: '/changelog',
      providerId: 'claude',
      model: 'opus',
      permissionMode: 'plan',
    });

    expect(store.setInitialAgentTask).toHaveBeenCalledWith('/changelog');
    expect(store.setSpawnAgentPreset).toHaveBeenCalledWith({
      providerId: 'claude',
      model: 'opus',
      permissionMode: 'plan',
    });
    expect(store.setSpawnAgentRepoPath).toHaveBeenCalledWith('/repo/sample');
    expect(store.setSpawnDialogOpen).toHaveBeenCalledWith(true);
  });

  it('leaves the preset null when the skill pins no provider', () => {
    const store = makeStore();

    openSkillSpawnDialog(store, '/repo/sample', {
      prompt: '/seo-check',
    });

    expect(store.setInitialAgentTask).toHaveBeenCalledWith('/seo-check');
    expect(store.setSpawnAgentPreset).toHaveBeenCalledWith(null);
  });

  it('injects the latest full prompt for an Auric skill reference', () => {
    saveAuricSkills([
      {
        id: 'review',
        name: 'Code Review',
        prompt: 'Review the implementation and return only actionable findings.',
      },
    ]);
    const store = makeStore();

    openSkillSpawnDialog(store, '/repo/sample', {
      prompt: 'stale snapshot',
      auricSkillId: 'review',
    });

    expect(store.setInitialAgentTask).toHaveBeenCalledWith(
      'Review the implementation and return only actionable findings.'
    );
  });
});
