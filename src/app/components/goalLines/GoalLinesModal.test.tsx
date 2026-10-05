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

/** Opens a line's timeline from its card. */
function openLine(goalId: string): void {
  fireEvent.click(screen.getByTestId(`goal-line-open-${goalId}`));
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
    goalLinesReturnToGoals: false,
    overlayStack: { layers: [] },
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
    // Progress reads as a capsule; there is no symbol legend to learn any more.
    expect(screen.getByTestId(`goal-line-capsule-${withWork.id}`)).toBeTruthy();
    expect(screen.queryByTestId('goal-line-legend')).toBeNull();
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

  it('reopens Goals on Escape only when opened from Goals', () => {
    seedStore();
    useStore.getState().setGoalLinesOpen(true, { fromGoals: true });
    render(<GoalLinesModal />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStore.getState().goalLinesOpen).toBe(false);
    expect(useStore.getState().goalsModalOpen).toBe(true);
  });

  it('does not open Goals on Escape when opened from the rail', () => {
    seedStore();
    useStore.getState().setGoalLinesOpen(true);
    render(<GoalLinesModal />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStore.getState().goalLinesOpen).toBe(false);
    expect(useStore.getState().goalsModalOpen).toBe(false);
  });

  it('shows the autosaved persist chip', () => {
    seedStore();
    render(<GoalLinesModal />);
    expect(screen.getByTestId('persist-chip')).toHaveTextContent('Autosaved');
  });

  it('names the icon-only close button Close', () => {
    seedStore();
    render(<GoalLinesModal />);
    expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument();
  });

  it('clicking a card opens and closes an accessible large detail layer', () => {
    const goal = makeGoal();
    seedStore({
      goalsDraft: [goal],
      pmDraftTickets: [makeTicket({ goalId: goal.id })],
    });
    render(<GoalLinesModal />);
    fireEvent.click(screen.getByTestId(`goal-line-open-${goal.id}`));
    const detail = screen.getByTestId('goal-line-detail');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(detail.getAttribute('role')).toBe('dialog');
    expect(detail.getAttribute('aria-modal')).toBe('true');
    expect(detail.getAttribute('aria-labelledby')).toBe('goal-line-detail-title');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('goal-line-detail')).toBeNull();
    expect(screen.getByTestId(`goal-line-open-${goal.id}`)).toBe(document.activeElement);
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
    expect(screen.getByTestId('for-you-all-quiet').textContent).toContain('All quiet');
  });

  it('names the agent working the front, on the card and in the timeline', () => {
    const goal = makeGoal();
    const ticket = makeTicket({ goalId: goal.id, status: 'in_progress' });
    const agent = makeAgent({ spawnedByTicketId: ticket.id });
    seedStore({
      goalsDraft: [goal],
      pmDraftTickets: [ticket],
      agents: [agent],
    });
    render(<GoalLinesModal />);
    expect(screen.getByTestId(`goal-line-now-${goal.id}`).textContent).toContain('1 agent');
    openLine(goal.id);
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

  it('draws a mission root without tickets as a line with its station progress', () => {
    const root = makeGoal({ name: 'Mission' });
    const child = makeGoal({ parentId: root.id, name: 'First sub-goal' });
    seedStore({
      goalsDraft: [root, child],
      goalStationsDraft: [
        station(child.id, { kind: 'normal', status: 'done', evidenceKind: 'proof' }),
        station(child.id, { id: 'st-2', kind: 'normal', sortOrder: 1 }),
      ],
    });
    render(<GoalLinesModal />);

    expect(screen.getByTestId(`goal-line-card-${root.id}`)).toBeTruthy();
    expect(screen.getByTestId(`goal-line-progress-${root.id}`).textContent).toBe('1 of 2 stations');
    expect(screen.queryByTestId('goal-lines-not-started')).toBeNull();
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
    openLine(goal.id);
    const input = screen.getByTestId(`goal-line-quick-add-${goal.id}`);
    fireEvent.change(input, { target: { value: 'Send the follow-up email' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const drafts = useStore.getState().goalStationsDraft;
    expect(drafts.some((s) => s.name === 'Send the follow-up email')).toBe(true);
    expect(saveGoals).toHaveBeenCalled();
  });

  it('ticks the step that needs you straight from the card', () => {
    const goal = makeGoal();
    const s1 = station(goal.id, { name: 'Enter the test server login' });
    const saveGoals = vi.fn(async () => {});
    seedStore({ goalsDraft: [goal], goalStationsDraft: [s1], saveGoals });
    render(<GoalLinesModal />);
    expect(screen.getByTestId(`goal-line-needs-you-${goal.id}`).textContent).toContain(
      'Enter the test server login'
    );
    fireEvent.click(screen.getByTestId(`goal-line-tick-due-${s1.id}`));
    const updated = useStore.getState().goalStationsDraft.find((s) => s.id === s1.id)!;
    expect(updated.status).toBe('done');
    expect(saveGoals).toHaveBeenCalled();
  });

  it('does not ask for a human step while agent work before it is still open', () => {
    const goal = makeGoal();
    const agentStep = station(goal.id, { kind: 'normal', sortOrder: 0 });
    const humanStep = station(goal.id, { sortOrder: 1 });
    seedStore({ goalsDraft: [goal], goalStationsDraft: [agentStep, humanStep] });
    render(<GoalLinesModal />);
    expect(screen.queryByTestId(`goal-line-needs-you-${goal.id}`)).toBeNull();
  });

  it('ticks a human step off in the timeline', () => {
    const goal = makeGoal();
    const s1 = station(goal.id);
    seedStore({ goalsDraft: [goal], goalStationsDraft: [s1] });
    render(<GoalLinesModal />);
    openLine(goal.id);
    fireEvent.click(screen.getByTestId(`station-tick-${s1.id}`));
    const updated = useStore.getState().goalStationsDraft.find((s) => s.id === s1.id)!;
    expect(updated.status).toBe('done');
    expect(updated.evidenceKind).toBe('human');
  });

  it('resets a started line after inline confirmation and persists', () => {
    const goal = makeGoal({ status: 'active' });
    const s1 = station(goal.id);
    const saveGoals = vi.fn(async () => {});
    seedStore({ goalsDraft: [goal], goalStationsDraft: [s1], saveGoals });
    render(<GoalLinesModal />);
    openLine(goal.id);
    fireEvent.click(screen.getByTestId(`goal-line-reset-${goal.id}`));
    expect(screen.getByTestId(`goal-line-reset-confirm-${goal.id}`)).toBeTruthy();
    expect(screen.getByTestId(`goal-line-reset-cancel-${goal.id}`)).toBe(document.activeElement);
    fireEvent.click(screen.getByTestId(`goal-line-reset-confirm-${goal.id}`));
    expect(useStore.getState().goalStationsDraft).toHaveLength(0);
    expect(useStore.getState().goalsDraft[0].status).toBe('draft');
    expect(saveGoals).toHaveBeenCalled();
  });

  it('Escape cancels reset confirmation and restores focus to Reset', () => {
    const goal = makeGoal();
    seedStore({ goalsDraft: [goal], goalStationsDraft: [station(goal.id)] });
    render(<GoalLinesModal />);
    openLine(goal.id);
    fireEvent.click(screen.getByTestId(`goal-line-reset-${goal.id}`));
    fireEvent.keyDown(screen.getByTestId(`goal-line-reset-cancel-${goal.id}`), { key: 'Escape' });
    expect(screen.queryByTestId(`goal-line-reset-confirm-${goal.id}`)).toBeNull();
    expect(screen.getByTestId(`goal-line-reset-${goal.id}`)).toBe(document.activeElement);
  });

  it('disables reset while a station has an assigned running agent and explains why', () => {
    const goal = makeGoal();
    const ticket = makeTicket({ id: 'ticket-1', goalId: goal.id, status: 'in_progress' });
    const s1 = station(goal.id, { ticketId: ticket.id });
    const agent = makeAgent({ spawnedByTicketId: ticket.id, status: 'running' });
    seedStore({
      goalsDraft: [goal],
      goalStationsDraft: [s1],
      pmDraftTickets: [ticket],
      agents: [agent],
    });
    render(<GoalLinesModal />);
    openLine(goal.id);
    const reset = screen.getByTestId(`goal-line-reset-${goal.id}`);
    expect(reset.getAttribute('aria-disabled')).toBe('true');
    expect(reset.getAttribute('title')).toContain('agent');
    expect(screen.getByTestId(`goal-line-reset-blocked-${goal.id}`).textContent).toContain('agent');
  });

  it('reorder buttons move a station while done work stays put', () => {
    const goal = makeGoal();
    const done = station(goal.id, { id: 'done-1', status: 'done', sortOrder: 0 });
    const a = station(goal.id, { id: 'a-1', sortOrder: 1 });
    const b = station(goal.id, { id: 'b-1', sortOrder: 2 });
    seedStore({ goalsDraft: [goal], goalStationsDraft: [done, a, b] });
    render(<GoalLinesModal />);
    openLine(goal.id);
    fireEvent.click(screen.getByTestId('station-toggle-b-1'));
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
    openLine(goal.id);
    fireEvent.click(screen.getByTestId('station-toggle-sourced-1'));
    const detail = screen.getByTestId('station-source-detail-sourced-1');
    expect(detail.textContent).toContain('The client must approve it.');
    expect(detail.textContent).toContain('Approval happens in the review dialog.');
    expect(screen.getByAltText('Video source at 2 seconds')).toBeTruthy();
  });

  it('skips an agent step only with a reason, and persists the decision', () => {
    const goal = makeGoal();
    const step = station(goal.id, {
      id: 'skip-1',
      kind: 'normal',
      predicate: { type: 'undefined' },
    });
    const saveGoals = vi.fn(async () => {});
    seedStore({ goalsDraft: [goal], goalStationsDraft: [step], saveGoals });
    render(<GoalLinesModal />);
    openLine(goal.id);
    fireEvent.click(screen.getByTestId('station-toggle-skip-1'));
    fireEvent.click(screen.getByTestId('station-skip-skip-1'));
    fireEvent.click(screen.getByTestId('station-skip-confirm-skip-1'));
    expect(useStore.getState().goalStationsDraft[0].status).toBe('planned');

    fireEvent.change(screen.getByTestId('station-skip-reason-skip-1'), {
      target: { value: 'The import already covers it' },
    });
    fireEvent.click(screen.getByTestId('station-skip-confirm-skip-1'));
    const skipped = useStore.getState().goalStationsDraft[0];
    expect(skipped.status).toBe('skipped');
    expect(skipped.evidenceNote).toBe('The import already covers it');
    expect(saveGoals).toHaveBeenCalled();
  });

  it('folds a long line and opens the folded past on request', () => {
    const goal = makeGoal();
    const stations = Array.from({ length: 93 }, (_, i) =>
      station(goal.id, {
        id: `st-${i}`,
        name: `Step ${i}`,
        kind: 'normal',
        status: i < 42 ? 'done' : 'planned',
        evidenceKind: i < 42 ? 'human' : 'claim',
        sortOrder: i,
      })
    );
    seedStore({ goalsDraft: [goal], goalStationsDraft: stations });
    render(<GoalLinesModal />);
    openLine(goal.id);
    const timeline = screen.getByTestId(`goal-line-timeline-${goal.id}`);
    expect(screen.getByTestId('timeline-fold-done').textContent).toContain('40 more done');
    expect(screen.getByTestId('timeline-fold-later').textContent).toContain('45 more planned');
    expect(timeline.querySelectorAll('[data-testid^="station-row-"]')).toHaveLength(2 + 6 + 1);
    expect(screen.queryByTestId('station-row-st-0')).toBeNull();

    fireEvent.click(screen.getByTestId('timeline-fold-done'));
    expect(screen.getByTestId('station-row-st-0')).toBeTruthy();
  });
});
