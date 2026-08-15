import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { useSpawnLauncher } from './useSpawnLauncher';
import { useStore } from '@/lib/store';

function resetStore() {
  useStore.setState({
    spawnDialogOpen: false,
    spawnAgentTicketId: 'stale-ticket',
    spawnAgentGoalId: 'stale-goal',
    initialAgentTask: 'stale task',
    spawnAgentPreset: { providerId: 'stale', model: 'stale', permissionMode: 'auto' },
    spawnAgentRepoPath: null,
  } as Partial<ReturnType<typeof useStore.getState>>);
}

describe('useSpawnLauncher', () => {
  beforeEach(resetStore);

  it('opens the spawn dialog targeting the given repo, clearing prior state', () => {
    const { result } = renderHook(() => useSpawnLauncher());

    act(() => result.current('/repos/acme-app'));

    const state = useStore.getState();
    expect(state.spawnDialogOpen).toBe(true);
    expect(state.spawnAgentRepoPath).toBe('/repos/acme-app');
    expect(state.spawnAgentTicketId).toBeNull();
    expect(state.spawnAgentGoalId).toBeNull();
    expect(state.initialAgentTask).toBe('');
    expect(state.spawnAgentPreset).toBeNull();
  });

  it('seeds the initial task from a given skill', () => {
    const { result } = renderHook(() => useSpawnLauncher());

    act(() =>
      result.current('/repos/acme-app', {
        label: 'Ship it',
        prompt: 'Run the release checklist',
      })
    );

    expect(useStore.getState().initialAgentTask).toBe('Run the release checklist');
  });
});
