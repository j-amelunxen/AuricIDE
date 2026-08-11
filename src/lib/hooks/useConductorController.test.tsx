import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConductorController } from './useConductorController';
import { useStore } from '@/lib/store';
import type { PmTicket } from '@/lib/tauri/pm';
import type { PmGoal } from '@/lib/tauri/goals';

function makeTicket(overrides: Partial<PmTicket>): PmTicket {
  return {
    id: crypto.randomUUID(),
    epicId: 'e1',
    name: 'Ticket',
    description: '',
    status: 'open',
    statusUpdatedAt: new Date().toISOString(),
    sortOrder: 0,
    priority: 'normal',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('useConductorController', () => {
  beforeEach(() => {
    useStore.setState({
      conductorRunning: false,
      conductorGoalId: null,
      conductorMaxConcurrent: 2,
      conductorAssignments: {},
      conductorPendingApprovals: [],
      conductorDecisions: [],
      conductorProviderId: null,
      conductorModel: null,
      pmDraftTickets: [],
      goalsDraft: [],
      selectedGoalId: null,
      rootPath: null,
    });
  });

  it('passes the last run summary through to the panel', () => {
    const lastRun = {
      outcome: 'finished' as const,
      goalName: null,
      completed: 2,
      failed: 0,
      blockers: [],
      startedAt: '2026-01-01T10:00:00.000Z',
      endedAt: '2026-01-01T10:05:00.000Z',
    };
    useStore.setState({ conductorLastRun: lastRun });
    const { result } = renderHook(() => useConductorController());
    expect(result.current.lastRun).toEqual(lastRun);
  });

  it('derives the active agent count from conductor assignments', () => {
    useStore.setState({ conductorAssignments: { t1: 'a1', t2: 'a2' } });
    const { result } = renderHook(() => useConductorController());
    expect(result.current.activeAgentCount).toBe(2);
  });

  it('resolves pending approval ids to ticket objects', () => {
    const t1 = makeTicket({ id: 't1', name: 'Risky ticket' });
    const t2 = makeTicket({ id: 't2' });
    useStore.setState({ pmDraftTickets: [t1, t2], conductorPendingApprovals: ['t1'] });
    const { result } = renderHook(() => useConductorController());
    expect(result.current.pendingApprovals).toHaveLength(1);
    expect(result.current.pendingApprovals[0].name).toBe('Risky ticket');
  });

  it('resolves the scope goal name from the running conductor goal', () => {
    useStore.setState({
      conductorGoalId: 'g1',
      goalsDraft: [{ id: 'g1', name: 'Ship v1' } as PmGoal],
    });
    const { result } = renderHook(() => useConductorController());
    expect(result.current.scopeGoalName).toBe('Ship v1');
  });

  it('cannot start without an open project', () => {
    const { result } = renderHook(() => useConductorController());
    expect(result.current.canStart).toBe(false);
  });

  it('starts the conductor scoped to the selected goal and triggers a tick', () => {
    const startConductor = vi.fn();
    const conductorTick = vi.fn(async () => {});
    useStore.setState({
      rootPath: '/tmp/project',
      selectedGoalId: 'g7',
      goalsDraft: [{ id: 'g7', name: 'Goal' } as PmGoal],
      pmDraftTickets: [makeTicket({ goalId: 'g7' })],
      startConductor,
      conductorTick,
    });
    const { result } = renderHook(() => useConductorController());
    expect(result.current.canStart).toBe(true);
    act(() => result.current.onStart());
    expect(startConductor).toHaveBeenCalledWith('g7');
    expect(conductorTick).toHaveBeenCalled();
  });

  it('cannot start an open project until tickets exist, but allows all-done verification', () => {
    useStore.setState({ rootPath: '/tmp/project' });
    const { result, rerender } = renderHook(() => useConductorController());
    expect(result.current.canStart).toBe(false);
    act(() => useStore.setState({ pmDraftTickets: [makeTicket({ status: 'done' })] }));
    rerender();
    expect(result.current.canStart).toBe(true);
  });

  it('delegates approvals and stop to the slice actions', () => {
    const approveConductorTicket = vi.fn(async () => {});
    const stopConductor = vi.fn();
    useStore.setState({ approveConductorTicket, stopConductor });
    const { result } = renderHook(() => useConductorController());
    act(() => result.current.onApprove('t9'));
    act(() => result.current.onStop());
    expect(approveConductorTicket).toHaveBeenCalledWith('t9');
    expect(stopConductor).toHaveBeenCalled();
  });
});
