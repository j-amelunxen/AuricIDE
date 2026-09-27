import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useStore } from '@/lib/store';
import type { PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import { GoalConflictNotice } from './GoalConflictNotice';

const goal = (over: Partial<PmGoal> = {}): PmGoal =>
  ({
    id: 'g1',
    parentId: null,
    name: 'Ship onboarding',
    description: '',
    successCriteria: '',
    status: 'active',
    priority: 'normal',
    goalPrompt: '',
    workMode: 'auto',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    ...over,
  }) as PmGoal;

const station = (over: Partial<PmGoalStation> = {}): PmGoalStation =>
  ({
    id: 's1',
    goalId: 'g1',
    name: 'Write tests',
    kind: 'normal',
    status: 'planned',
    evidenceKind: 'claim',
    predicate: { type: 'undefined' },
    evidenceNote: '',
    sourceContext: null,
    ticketId: null,
    lane: 0,
    sortOrder: 0,
    lastCheckedAt: null,
    doneAt: null,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    ...over,
  }) as PmGoalStation;

const saveGoals = vi.fn(async () => undefined);

function seed() {
  useStore.setState({
    rootPath: '/repo',
    goals: [goal({ status: 'in_progress' })],
    goalsDraft: [goal({ status: 'archived' })],
    goalStations: [station({ status: 'done' })],
    goalStationsDraft: [station({ status: 'fog' })],
    goalConflicts: [
      { table: 'pm_goals', id: 'g1', columns: ['status'], base: goal() },
      { table: 'pm_goal_stations', id: 's1', columns: ['status'], base: station() },
    ],
    saveGoals,
  } as never);
}

describe('GoalConflictNotice', () => {
  beforeEach(() => {
    saveGoals.mockClear();
    seed();
  });

  it('renders nothing for a goal without conflicts', () => {
    const { container } = render(<GoalConflictNotice goalId="other" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names each clash with the person's value and the agent's", () => {
    render(<GoalConflictNotice goalId="g1" />);
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('Ship onboarding');
    expect(notice).toHaveTextContent('Write tests');
    expect(notice).toHaveTextContent('yours: archived');
    expect(notice).toHaveTextContent('agent: in_progress');
    expect(notice).toHaveTextContent('yours: fog');
    expect(notice).toHaveTextContent('agent: done');
  });

  it('keeps the person’s value and saves it', async () => {
    render(<GoalConflictNotice goalId="g1" />);
    fireEvent.click(screen.getByRole('button', { name: /keep mine.*ship onboarding/i }));

    await waitFor(() => expect(saveGoals).toHaveBeenCalledWith('/repo'));
    const state = useStore.getState();
    expect(state.goalConflicts.map((c) => c.id)).toEqual(['s1']);
    expect(state.goalsDraft[0].status).toBe('archived');
  });

  it("takes the agent's value into the draft", async () => {
    render(<GoalConflictNotice goalId="g1" />);
    fireEvent.click(screen.getByRole('button', { name: /take agent's.*write tests/i }));

    await waitFor(() => expect(saveGoals).toHaveBeenCalledWith('/repo'));
    const state = useStore.getState();
    expect(state.goalConflicts.map((c) => c.id)).toEqual(['g1']);
    expect(state.goalStationsDraft[0].status).toBe('done');
  });
});
