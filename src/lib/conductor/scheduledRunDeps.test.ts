import { describe, expect, it } from 'vitest';
import { useStore } from '@/lib/store';
import type { PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import { buildScheduledRunDeps } from './scheduledRunDeps';

describe('buildScheduledRunDeps readiness', () => {
  it('counts a stations goal without tickets as work a scheduled run can pick up', () => {
    useStore.setState({
      pmDraftTickets: [],
      pmDraftDependencies: [],
      goalsDraft: [{ id: 'g1', name: 'Guide', status: 'active', parentId: null } as PmGoal],
      goalStationsDraft: [
        {
          id: 's1',
          goalId: 'g1',
          name: 'Draft',
          kind: 'normal',
          status: 'planned',
          evidenceKind: 'claim',
          predicate: { type: 'undefined' },
          evidenceNote: '',
          ticketId: null,
          lane: 0,
          sortOrder: 0,
          lastCheckedAt: null,
          doneAt: null,
          createdAt: '',
          updatedAt: '',
        } satisfies PmGoalStation,
      ],
    });
    const deps = buildScheduledRunDeps(async () => {});
    expect(deps.readyTicketCount('g1')).toBe(1);
  });

  it('counts a stations goal with only verified stations, so the run can close it', () => {
    const [station] = useStore.getState().goalStationsDraft;
    useStore.setState({
      goalStationsDraft: [{ ...station, status: 'done', evidenceKind: 'judged' }],
    });
    const deps = buildScheduledRunDeps(async () => {});
    expect(deps.readyTicketCount('g1')).toBe(1);
  });
});
