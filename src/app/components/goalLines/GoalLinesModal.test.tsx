import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useStore } from '@/lib/store';
import type { PmGoal } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import type { AgentInfo } from '@/lib/tauri/agents';
import { GoalLinesModal } from './GoalLinesModal';

const TS = '2026-01-10 10:00:00';

function makeGoal(overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id: crypto.randomUUID(),
    parentId: null,
    name: 'Search works offline',
    description: '',
    successCriteria: 'All search tickets done',
    status: 'active',
    priority: 'normal',
    goalPrompt: '',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<PmTicket> = {}): PmTicket {
  return {
    id: crypto.randomUUID(),
    epicId: 'epic-1',
    name: 'Index builder',
    description: '',
    status: 'open',
    statusUpdatedAt: TS,
    sortOrder: 0,
    priority: 'normal',
    goalId: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: crypto.randomUUID(),
    name: 'worker',
    status: 'running',
    model: 'model-a',
    provider: 'provider-a',
    startedAt: Date.now() - 30_000,
    lastActivityAt: Date.now() - 1_000,
    ...overrides,
  };
}

function seedStore(overrides: Record<string, unknown> = {}): void {
  useStore.setState({
    goalLinesOpen: true,
    rootPath: '/tmp/demo-project',
    goalsDraft: [],
    goalRunsDraft: [],
    goalRequirementLinksDraft: [],
    goalStationsDraft: [],
    pmDraftTickets: [],
    pmDraftDependencies: [],
    requirementsDraft: [],
    agents: [],
    reviewedAgentIds: [],
    selectedGoalId: null,
    goalsModalOpen: false,
    loadGoals: vi.fn(async () => {}),
    loadPmData: vi.fn(async () => {}),
    loadRequirements: vi.fn(async () => {}),
    ...overrides,
  });
}

describe('GoalLinesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStore({ goalLinesOpen: false });
  });

  it('renders nothing while closed', () => {
    render(<GoalLinesModal />);
    expect(screen.queryByTestId('goal-lines-modal')).toBeNull();
  });

  it('renders the board with one card per goal that has work', () => {
    const withWork = makeGoal({ name: 'Search works offline' });
    const bare = makeGoal({ name: 'Bare goal' });
    seedStore({
      goalsDraft: [withWork, bare],
      pmDraftTickets: [makeTicket({ goalId: withWork.id })],
    });
    render(<GoalLinesModal />);
    expect(screen.getByTestId('goal-lines-modal')).toBeTruthy();
    expect(screen.getByTestId(`goal-line-card-${withWork.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`goal-line-card-${bare.id}`)).toBeNull();
    // the bare goal lands in the quiet not-started strip instead
    expect(screen.getByTestId('goal-lines-not-started').textContent).toContain('Bare goal');
    expect(screen.getByTestId('goal-line-legend')).toBeTruthy();
  });

  it('shows an empty state with a path to Goals when nothing exists', () => {
    seedStore();
    render(<GoalLinesModal />);
    fireEvent.click(screen.getByTestId('goal-lines-open-goals'));
    expect(useStore.getState().goalsModalOpen).toBe(true);
    expect(useStore.getState().goalLinesOpen).toBe(false);
  });

  it('closes on Escape', () => {
    seedStore();
    render(<GoalLinesModal />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStore.getState().goalLinesOpen).toBe(false);
  });

  it('clicking a card navigates to the goal in the Goals modal', () => {
    const goal = makeGoal();
    seedStore({
      goalsDraft: [goal],
      pmDraftTickets: [makeTicket({ goalId: goal.id })],
    });
    render(<GoalLinesModal />);
    fireEvent.click(screen.getByTestId(`goal-line-open-${goal.id}`));
    expect(useStore.getState().selectedGoalId).toBe(goal.id);
    expect(useStore.getState().goalsModalOpen).toBe(true);
    expect(useStore.getState().goalLinesOpen).toBe(false);
  });

  it('surfaces a failed agent at the head of the For-you queue', () => {
    const goal = makeGoal();
    const ticket = makeTicket({ goalId: goal.id, status: 'in_progress' });
    const failed = makeAgent({
      status: 'error',
      name: 'index-builder',
      spawnedByTicketId: ticket.id,
      finishedAt: Date.now() - 5_000,
    });
    seedStore({
      goalsDraft: [goal],
      pmDraftTickets: [ticket],
      agents: [failed],
    });
    render(<GoalLinesModal />);
    const row = screen.getByTestId(`for-you-row-agent-${failed.id}`);
    expect(row.textContent).toContain('index-builder failed');
    expect(screen.getByTestId('goal-lines-need-you').textContent).toContain('1');
  });

  it('states idle while agents run and none needs a human', () => {
    const goal = makeGoal();
    const ticket = makeTicket({ goalId: goal.id, status: 'in_progress' });
    const healthy = makeAgent({ spawnedByTicketId: ticket.id });
    seedStore({
      goalsDraft: [goal],
      pmDraftTickets: [ticket],
      agents: [healthy],
    });
    render(<GoalLinesModal />);
    expect(screen.getByTestId('for-you-all-quiet').textContent).toContain('idle');
  });

  it('perches the running agent on its station in the map', () => {
    const goal = makeGoal();
    const ticket = makeTicket({ goalId: goal.id, status: 'in_progress' });
    const agent = makeAgent({ spawnedByTicketId: ticket.id });
    seedStore({
      goalsDraft: [goal],
      pmDraftTickets: [ticket],
      agents: [agent],
    });
    render(<GoalLinesModal />);
    expect(screen.getByTestId(`perched-agent-${agent.id}`)).toBeTruthy();
  });
});

describe('station interactions on the board', () => {
  const station = (goalId: string, overrides: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(),
    goalId,
    name: 'Call the client',
    kind: 'human' as const,
    status: 'planned' as const,
    evidenceKind: 'human' as const,
    predicate: { type: 'human' as const },
    evidenceNote: '',
    ticketId: null,
    lane: 0,
    sortOrder: 0,
    lastCheckedAt: null,
    doneAt: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  });

  it('quick-add creates a human station in the draft and persists', () => {
    const goal = makeGoal();
    const saveGoals = vi.fn(async () => {});
    seedStore({
      goalsDraft: [goal],
      pmDraftTickets: [makeTicket({ goalId: goal.id })],
      saveGoals,
    });
    render(<GoalLinesModal />);
    const input = screen.getByTestId(`goal-line-quick-add-${goal.id}`);
    fireEvent.change(input, { target: { value: 'Send the follow-up email' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const drafts = useStore.getState().goalStationsDraft;
    expect(drafts.some((s) => s.name === 'Send the follow-up email')).toBe(true);
    expect(saveGoals).toHaveBeenCalled();
  });

  it('renders committed stations with reorder and tick controls', () => {
    const goal = makeGoal();
    const s1 = station(goal.id);
    seedStore({ goalsDraft: [goal], goalStationsDraft: [s1] });
    render(<GoalLinesModal />);
    fireEvent.click(screen.getByTestId(`goal-line-stations-toggle-${goal.id}`));
    fireEvent.click(screen.getByTestId(`station-tick-${s1.id}`));
    const updated = useStore.getState().goalStationsDraft.find((s) => s.id === s1.id)!;
    expect(updated.status).toBe('done');
    expect(updated.evidenceKind).toBe('human');
  });

  it('reorder buttons move a station while done work stays put', () => {
    const goal = makeGoal();
    const done = station(goal.id, { id: 'done-1', status: 'done', sortOrder: 0 });
    const a = station(goal.id, { id: 'a-1', sortOrder: 1 });
    const b = station(goal.id, { id: 'b-1', sortOrder: 2 });
    seedStore({ goalsDraft: [goal], goalStationsDraft: [done, a, b] });
    render(<GoalLinesModal />);
    fireEvent.click(screen.getByTestId(`goal-line-stations-toggle-${goal.id}`));
    fireEvent.click(screen.getByTestId('station-up-b-1'));
    const order = [...useStore.getState().goalStationsDraft]
      .sort((x, y) => x.sortOrder - y.sortOrder)
      .map((s) => s.id);
    expect(order).toEqual(['done-1', 'b-1', 'a-1']);
  });

  it('keeps imported transcript notes and screenshots inspectable on a station', () => {
    const goal = makeGoal();
    const sourced = station(goal.id, {
      id: 'sourced-1',
      sourceContext: {
        importId: 'video-1',
        sourcePath: '/tmp/review.mp4',
        transcriptSegments: [{ startMs: 1200, endMs: 3400, text: 'The client must approve it.' }],
        frames: [{ timestampMs: 1800, path: '/tmp/frame.jpg' }],
        notes: ['Approval happens in the review dialog.'],
      },
    });
    seedStore({ goalsDraft: [goal], goalStationsDraft: [sourced] });
    render(<GoalLinesModal />);
    fireEvent.click(screen.getByTestId(`goal-line-stations-toggle-${goal.id}`));
    fireEvent.click(screen.getByTestId('station-source-sourced-1'));
    const detail = screen.getByTestId('station-source-detail-sourced-1');
    expect(detail.textContent).toContain('The client must approve it.');
    expect(detail.textContent).toContain('Approval happens in the review dialog.');
    expect(screen.getByAltText('Video source at 2 seconds')).toBeTruthy();
  });
});
