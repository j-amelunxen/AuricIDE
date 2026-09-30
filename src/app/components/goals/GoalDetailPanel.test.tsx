import type { ComponentProps } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalDetailPanel } from './GoalDetailPanel';
import type { PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import { useStore } from '@/lib/store';
import { usageRow } from '@/lib/pm/usage/testRow';
import type { PmTicket } from '@/lib/tauri/pm';
import { MISSION_FIXTURES } from '@/lib/missions/missionFs.testing';

// The mission panel reads through the Tauri fs wrappers; here they read the
// fixture missions from disk, so the panel sees real files.
vi.mock('@/lib/tauri/fs', async (importOriginal) => {
  const disk = (await import('@/lib/missions/missionFs.testing')).diskMissionFs;
  return {
    ...(await importOriginal<typeof import('@/lib/tauri/fs')>()),
    readDirectory: disk.readDirectory,
    readFile: disk.readFile,
  };
});

function makeGoal(overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id: 'g1',
    parentId: null,
    name: 'Ship onboarding',
    description: '',
    successCriteria: '- strip visible on first run',
    status: 'active',
    priority: 'normal',
    goalPrompt: '',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function makeTicket(overrides: Partial<PmTicket> = {}): PmTicket {
  return {
    id: 't1',
    epicId: 'e1',
    name: 'Ticket',
    description: '',
    status: 'open',
    statusUpdatedAt: '',
    sortOrder: 0,
    priority: 'normal',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function renderPanel(
  goal: PmGoal,
  tickets: PmTicket[] = [],
  overrides: Partial<ComponentProps<typeof GoalDetailPanel>> = {}
) {
  return render(
    <GoalDetailPanel
      goal={goal}
      goals={[goal]}
      tickets={tickets}
      requirements={[]}
      requirementLinks={[]}
      runs={[]}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
      onAchieve={vi.fn()}
      onAddSubGoal={vi.fn()}
      onLaunchAgent={vi.fn()}
      onSplitGoal={vi.fn()}
      onLinkRequirement={vi.fn()}
      onUnlinkRequirement={vi.fn()}
      onLinkTicket={vi.fn()}
      onUnlinkTicket={vi.fn()}
      {...overrides}
    />
  );
}

describe('GoalDetailPanel workflow stepper', () => {
  it('marks "define" current while success criteria are missing', () => {
    renderPanel(makeGoal({ successCriteria: '' }));
    const current = screen.getByTestId('goal-workflow-step-1');
    expect(current.getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('goal-workflow-hint').textContent).toMatch(/success criteria/i);
  });

  it('marks "attach" current when nothing is attached yet', () => {
    renderPanel(makeGoal());
    expect(screen.getByTestId('goal-workflow-step-2').getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('goal-workflow-hint').textContent).toMatch(/tickets|decompose/i);
  });

  it('marks "execute" current while linked tickets are open', () => {
    renderPanel(makeGoal(), [makeTicket({ goalId: 'g1' })]);
    expect(screen.getByTestId('goal-workflow-step-3').getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('goal-workflow-hint').textContent).toMatch(/conductor/i);
  });

  it('marks the loop complete when every check is green', () => {
    renderPanel(makeGoal(), [makeTicket({ goalId: 'g1', status: 'done' })]);
    expect(screen.getByTestId('goal-workflow-step-4').getAttribute('aria-current')).toBe('step');
  });
});

describe('GoalDetailPanel planning action', () => {
  it('offers a separate explicit action for splitting the goal with an agent', async () => {
    const user = userEvent.setup();
    const onLaunchAgent = vi.fn();
    const onSplitGoal = vi.fn();
    const goal = makeGoal();

    renderPanel(goal, [], { onLaunchAgent, onSplitGoal });
    await user.click(screen.getByTestId('goal-split-agent-btn'));

    expect(screen.getByTestId('goal-split-agent-btn')).toHaveTextContent(
      'Split into sub-goals with agent'
    );
    expect(onSplitGoal).toHaveBeenCalledWith(goal);
    expect(onLaunchAgent).not.toHaveBeenCalled();
  });

  it('explains the difference between direct ticket planning and splitting into child outcomes', () => {
    renderPanel(makeGoal());

    expect(screen.getByTestId('goal-direct-agent-guidance')).toHaveTextContent(
      /tickets directly on this goal/i
    );
    expect(screen.getByTestId('goal-split-agent-guidance')).toHaveTextContent(
      /child outcomes, each with its own ticket/i
    );
  });

  it('disables splitting an achieved goal and exposes the reason to keyboard users', () => {
    renderPanel(makeGoal({ status: 'achieved' }));

    expect(screen.getByTestId('goal-split-agent-btn')).toBeDisabled();
    expect(screen.getByTestId('goal-split-agent-disabled-explanation')).toHaveAttribute(
      'tabindex',
      '0'
    );
    expect(screen.getByTestId('goal-split-agent-disabled-explanation')).toHaveAttribute(
      'aria-describedby',
      'goal-split-disabled-reason'
    );
    expect(screen.getByText('Achieved goals cannot be split into new sub-goals.')).toHaveClass(
      'sr-only'
    );
  });

  it('offers ticket creation and explains that the conductor runs tickets when none exist', () => {
    renderPanel(makeGoal());
    expect(screen.getByTestId('goal-launch-agent-btn')).toHaveTextContent(
      'Create tickets with agent'
    );
    expect(screen.getByTestId('goal-detail')).toHaveTextContent(/conductor works through tickets/i);
    expect(screen.getByTestId('goal-satisfaction')).toHaveTextContent(/open conditions/i);
    expect(screen.getByTestId('goal-satisfaction')).not.toHaveTextContent(/blockers/i);
  });

  it('offers additive agent work once the subtree already has tickets', () => {
    const goal = makeGoal();
    const child = makeGoal({ id: 'child', parentId: goal.id });
    renderPanel(goal, [makeTicket({ goalId: child.id })], { goals: [goal, child] });
    expect(screen.getByTestId('goal-launch-agent-btn')).toHaveTextContent('Plan work with agent');
  });
});

function makeStation(overrides: Partial<PmGoalStation> = {}): PmGoalStation {
  return {
    id: 's1',
    goalId: 'g1',
    name: 'Draft the article',
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
    ...overrides,
  };
}

describe('GoalDetailPanel work mode', () => {
  afterEach(() => useStore.setState({ goalStationsDraft: [] }));

  it('offers to work the stations directly when the goal has stations and no tickets', () => {
    useStore.setState({ goalStationsDraft: [makeStation()] });
    renderPanel(makeGoal());

    expect(screen.getByTestId('goal-launch-agent-btn')).toHaveTextContent(
      'Work stations with agent'
    );
    expect(screen.getByTestId('goal-work-mode')).toHaveValue('auto');
    expect(screen.getByTestId('goal-work-mode-reason')).toHaveTextContent(/stations/i);
    expect(screen.getByTestId('goal-detail')).not.toHaveTextContent(
      /create tickets before launching/i
    );
  });

  it('switches the mode per goal and stores the choice on the goal', async () => {
    useStore.setState({ goalStationsDraft: [makeStation()] });
    const onUpdate = vi.fn();
    renderPanel(makeGoal(), [], { onUpdate });

    await userEvent.setup().selectOptions(screen.getByTestId('goal-work-mode'), 'tickets');

    expect(onUpdate).toHaveBeenCalledWith('g1', { workMode: 'tickets' });
  });

  it('keeps ticket creation for a goal set to tickets mode', () => {
    useStore.setState({ goalStationsDraft: [makeStation()] });
    renderPanel(makeGoal({ workMode: 'tickets' }));

    expect(screen.getByTestId('goal-launch-agent-btn')).toHaveTextContent(
      'Create tickets with agent'
    );
    expect(screen.getByTestId('goal-work-mode-reason')).toHaveTextContent(/set on this goal/i);
  });
});

describe('GoalDetailPanel hierarchy', () => {
  it('reparents an existing goal from the parent selector', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const root = makeGoal({ id: 'root', name: 'Research workspace' });
    const currentParent = makeGoal({ id: 'parent', parentId: 'root', name: 'Count records' });
    const selected = makeGoal({ id: 'selected', parentId: 'parent', name: 'Select audience' });

    renderPanel(selected, [], { goals: [root, currentParent, selected], onUpdate });
    await user.selectOptions(screen.getByTestId('goal-detail-parent'), 'root');

    expect(onUpdate).toHaveBeenCalledWith('selected', { parentId: 'root' });
  });

  it('does not offer itself or descendants as parents', () => {
    const selected = makeGoal({ id: 'selected', name: 'Selected' });
    const child = makeGoal({ id: 'child', parentId: 'selected', name: 'Child' });
    const sibling = makeGoal({ id: 'sibling', name: 'Sibling' });

    renderPanel(selected, [], { goals: [selected, child, sibling] });

    const options = Array.from(
      screen.getByTestId<HTMLSelectElement>('goal-detail-parent').options
    ).map((option) => option.value);
    expect(options).toContain('sibling');
    expect(options).not.toContain('selected');
    expect(options).not.toContain('child');
  });
});

describe('GoalDetailPanel ticket browser', () => {
  it('opens a browsable picker of unlinked tickets on demand', async () => {
    const user = userEvent.setup();
    renderPanel(makeGoal(), [
      makeTicket({ id: 't1', name: 'Fix login bug' }),
      makeTicket({ id: 't2', name: 'Write onboarding copy' }),
    ]);

    expect(screen.queryByTestId('goal-ticket-picker-search')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('goal-ticket-add-btn'));

    expect(screen.getByTestId('goal-ticket-picker-search')).toBeInTheDocument();
    expect(screen.getByTestId('goal-ticket-option-t1')).toHaveTextContent('Fix login bug');
    expect(screen.getByTestId('goal-ticket-option-t2')).toHaveTextContent('Write onboarding copy');
  });

  it('filters the picker list as the user types', async () => {
    const user = userEvent.setup();
    renderPanel(makeGoal(), [
      makeTicket({ id: 't1', name: 'Fix login bug' }),
      makeTicket({ id: 't2', name: 'Write onboarding copy' }),
    ]);

    await user.click(screen.getByTestId('goal-ticket-add-btn'));
    await user.type(screen.getByTestId('goal-ticket-picker-search'), 'login');

    expect(screen.getByTestId('goal-ticket-option-t1')).toBeInTheDocument();
    expect(screen.queryByTestId('goal-ticket-option-t2')).not.toBeInTheDocument();
  });

  it('excludes tickets already linked to this goal from the picker', async () => {
    const user = userEvent.setup();
    renderPanel(makeGoal(), [
      makeTicket({ id: 't1', name: 'Already linked', goalId: 'g1' }),
      makeTicket({ id: 't2', name: 'Not linked yet' }),
    ]);

    await user.click(screen.getByTestId('goal-ticket-add-btn'));

    expect(screen.queryByTestId('goal-ticket-option-t1')).not.toBeInTheDocument();
    expect(screen.getByTestId('goal-ticket-option-t2')).toBeInTheDocument();
  });

  it('links a ticket to the goal when picked, without closing the picker', async () => {
    const user = userEvent.setup();
    const onLinkTicket = vi.fn();
    renderPanel(makeGoal(), [makeTicket({ id: 't1', name: 'Fix login bug' })], { onLinkTicket });

    await user.click(screen.getByTestId('goal-ticket-add-btn'));
    await user.click(screen.getByTestId('goal-ticket-link-t1'));

    expect(onLinkTicket).toHaveBeenCalledWith('g1', 't1');
    expect(screen.getByTestId('goal-ticket-picker-search')).toBeInTheDocument();
  });

  it('shows a hint when a matching ticket already belongs to another goal', async () => {
    const user = userEvent.setup();
    renderPanel(makeGoal(), [makeTicket({ id: 't1', name: 'Borrowed ticket', goalId: 'g-other' })]);

    await user.click(screen.getByTestId('goal-ticket-add-btn'));

    expect(screen.getByTestId('goal-ticket-option-t1')).toHaveTextContent(/another goal/i);
  });

  it('unlinks an attached ticket via its remove button', async () => {
    const user = userEvent.setup();
    const onUnlinkTicket = vi.fn();
    renderPanel(makeGoal(), [makeTicket({ id: 't1', name: 'Attached', goalId: 'g1' })], {
      onUnlinkTicket,
    });

    await user.click(screen.getByTestId('goal-ticket-unlink-t1'));

    expect(onUnlinkTicket).toHaveBeenCalledWith('t1');
  });
});

describe('GoalDetailPanel conflicts with an agent', () => {
  afterEach(() => useStore.setState({ goals: [], goalsDraft: [], goalConflicts: [] }));

  it('asks the person to settle a clash on this goal', () => {
    const mine = makeGoal({ status: 'archived' });
    useStore.setState({
      goals: [makeGoal({ status: 'in_progress' })],
      goalsDraft: [mine],
      goalConflicts: [{ table: 'pm_goals', id: 'g1', columns: ['status'], base: makeGoal() }],
    });
    renderPanel(mine);
    expect(screen.getByTestId('goal-conflict-notice')).toHaveTextContent('agent: in_progress');
  });
});

describe('GoalDetailPanel mission overview', () => {
  afterEach(() => useStore.setState({ rootPath: null }));

  it('shows the mission of a root goal, read from its folder in the project', async () => {
    useStore.setState({ rootPath: MISSION_FIXTURES });
    renderPanel(makeGoal({ missionPath: 'mission-sample' }));
    const overview = await screen.findByTestId('mission-overview');
    expect(within(overview).getByTestId('mission-path')).toHaveTextContent('mission-sample');
    await waitFor(() => expect(within(overview).getAllByTestId('mission-subgoal')).toHaveLength(3));
    expect(within(overview).getAllByTestId('mission-question')).toHaveLength(1);
    expect(within(overview).getAllByTestId('mission-review').length).toBeGreaterThan(0);
  });

  it('shows a broken mission as broken, inside the goal view', async () => {
    useStore.setState({ rootPath: MISSION_FIXTURES });
    renderPanel(makeGoal({ missionPath: 'mission-broken' }));
    const overview = await screen.findByTestId('mission-overview');
    await waitFor(() =>
      expect(within(overview).getAllByTestId('mission-problem').length).toBeGreaterThan(0)
    );
  });

  it('says so when the mission folder does not exist', async () => {
    useStore.setState({ rootPath: MISSION_FIXTURES });
    renderPanel(makeGoal({ missionPath: 'mission-that-is-not-there' }));
    const overview = await screen.findByTestId('mission-overview');
    await waitFor(() => expect(within(overview).getByTestId('mission-problems')).toBeVisible());
  });

  it('shows nothing for a root goal without a mission', () => {
    useStore.setState({ rootPath: MISSION_FIXTURES });
    renderPanel(makeGoal());
    expect(screen.queryByTestId('mission-overview')).toBeNull();
  });

  it('shows nothing for a sub-goal, even with a mission path written into the database', () => {
    useStore.setState({ rootPath: MISSION_FIXTURES });
    renderPanel(makeGoal({ parentId: 'root', missionPath: 'mission-sample' }));
    expect(screen.queryByTestId('mission-overview')).toBeNull();
  });

  it('never reads a folder outside the project', () => {
    useStore.setState({ rootPath: `${MISSION_FIXTURES}/mission-sample` });
    renderPanel(makeGoal({ missionPath: '../mission-broken' }));
    expect(screen.queryByTestId('mission-overview')).toBeNull();
  });

  it('shows nothing without an open project', () => {
    useStore.setState({ rootPath: null });
    renderPanel(makeGoal({ missionPath: 'mission-sample' }));
    expect(screen.queryByTestId('mission-overview')).toBeNull();
  });
});

describe('GoalDetailPanel dependencies', () => {
  afterEach(() => useStore.setState({ goalsDraft: [], goalDependenciesDraft: [], toasts: [] }));

  it('shows a waits-for chip and removes it through the store', async () => {
    const user = userEvent.setup();
    const goal = makeGoal({ id: 'g1', parentId: 'root' });
    const sibling = makeGoal({ id: 'g2', parentId: 'root', name: 'Backend ready' });
    useStore.setState({
      goalsDraft: [goal, sibling],
      goalDependenciesDraft: [{ id: 'dep-1', goalId: 'g1', dependsOnGoalId: 'g2', createdAt: '' }],
    });

    renderPanel(goal, [], { goals: [goal, sibling] });
    expect(screen.getByTestId('goal-depends-chip-g2')).toHaveTextContent('Backend ready');

    await user.click(screen.getByTestId('goal-depends-unlink-g2'));
    expect(useStore.getState().goalDependenciesDraft).toHaveLength(0);
    expect(screen.queryByTestId('goal-depends-chip-g2')).toBeNull();
  });

  it('adds a dependency picked from the sibling list', async () => {
    const user = userEvent.setup();
    const goal = makeGoal({ id: 'g1', parentId: 'root' });
    const sibling = makeGoal({ id: 'g2', parentId: 'root', name: 'Backend ready' });
    useStore.setState({ goalsDraft: [goal, sibling], goalDependenciesDraft: [] });

    renderPanel(goal, [], { goals: [goal, sibling] });
    await user.selectOptions(screen.getByTestId('goal-depends-picker'), 'g2');

    expect(useStore.getState().goalDependenciesDraft).toEqual([
      expect.objectContaining({ goalId: 'g1', dependsOnGoalId: 'g2' }),
    ]);
    expect(await screen.findByTestId('goal-depends-chip-g2')).toBeInTheDocument();
  });

  it('surfaces a rejected dependency as an error toast, not a silent no-op', async () => {
    const user = userEvent.setup();
    // g1 already waits for g2. Picking g2 to also wait for g1 through g2's
    // own panel would close the loop, so the store must reject it — the
    // picker itself has no cycle check, only the store does.
    const g1 = makeGoal({ id: 'g1', parentId: 'root', name: 'First' });
    const g2 = makeGoal({ id: 'g2', parentId: 'root', name: 'Second' });
    useStore.setState({
      goalsDraft: [g1, g2],
      goalDependenciesDraft: [{ id: 'dep-1', goalId: 'g1', dependsOnGoalId: 'g2', createdAt: '' }],
    });

    renderPanel(g2, [], { goals: [g1, g2] });
    await user.selectOptions(screen.getByTestId('goal-depends-picker'), 'g1');

    expect(useStore.getState().goalDependenciesDraft).toHaveLength(1); // rejected, not added
    expect(useStore.getState().toasts.at(-1)).toMatchObject({ variant: 'error' });
  });

  it('sets the bundle label when the input is blurred', () => {
    const goal = makeGoal({ id: 'g1', parentId: 'root' });
    useStore.setState({ goalsDraft: [goal], goalDependenciesDraft: [] });

    renderPanel(goal, [], { goals: [goal] });
    const input = screen.getByTestId('goal-bundle-input') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'api' } });
    input.blur();

    expect(useStore.getState().goalsDraft.find((g) => g.id === 'g1')?.bundle).toBe('api');
  });

  it('shows no bundle members without a second sibling in the same bundle', () => {
    const goal = makeGoal({ id: 'g1', parentId: 'root', bundle: 'api' });
    useStore.setState({ goalsDraft: [goal], goalDependenciesDraft: [] });
    renderPanel(goal, [], { goals: [goal] });
    expect(screen.getByText('Runs in parallel with siblings.')).toBeInTheDocument();
  });

  it('follows a bundle changed elsewhere instead of writing a stale draft back', () => {
    const goal = makeGoal({ id: 'g1', parentId: 'root', bundle: 'old' });
    useStore.setState({ goalsDraft: [goal], goalDependenciesDraft: [] });
    const { rerender } = renderPanel(goal, [], { goals: [goal] });

    // Simulates an MCP agent (or another session) changing the bundle while
    // this panel stays open on the same goal — the prop changes, the section
    // does not remount.
    const updatedGoal = { ...goal, bundle: 'new' };
    rerender(
      <GoalDetailPanel
        goal={updatedGoal}
        goals={[updatedGoal]}
        tickets={[]}
        requirements={[]}
        requirementLinks={[]}
        runs={[]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAchieve={vi.fn()}
        onAddSubGoal={vi.fn()}
        onLaunchAgent={vi.fn()}
        onSplitGoal={vi.fn()}
        onLinkRequirement={vi.fn()}
        onUnlinkRequirement={vi.fn()}
        onLinkTicket={vi.fn()}
        onUnlinkTicket={vi.fn()}
      />
    );

    const input = screen.getByTestId('goal-bundle-input') as HTMLInputElement;
    expect(input.value).toBe('new');

    const setGoalBundleSpy = vi.spyOn(useStore.getState(), 'setGoalBundle');
    input.focus();
    input.blur();
    expect(setGoalBundleSpy).not.toHaveBeenCalled();
    expect(input.value).toBe('new');
  });
});

describe('GoalDetailPanel manual launch respects dependencies', () => {
  afterEach(() => useStore.setState({ goalsDraft: [], goalDependenciesDraft: [] }));

  it('disables the launch button with a visible reason while the goal is blocked', () => {
    const a = makeGoal({ id: 'a', parentId: 'root', name: 'Backend' });
    const b = makeGoal({ id: 'b', parentId: 'root', name: 'Frontend' });
    useStore.setState({
      goalsDraft: [a, b],
      goalDependenciesDraft: [{ id: 'dep-1', goalId: 'b', dependsOnGoalId: 'a', createdAt: '' }],
    });

    renderPanel(b, [], { goals: [a, b] });

    const button = screen.getByTestId('goal-launch-agent-btn');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('goal-direct-agent-guidance')).toHaveTextContent(
      'Waits for Backend.'
    );
  });

  it('keeps the launch button enabled once nothing blocks the goal', () => {
    const a = makeGoal({ id: 'a', parentId: 'root', name: 'Backend', status: 'achieved' });
    const b = makeGoal({ id: 'b', parentId: 'root', name: 'Frontend' });
    useStore.setState({
      goalsDraft: [a, b],
      goalDependenciesDraft: [{ id: 'dep-1', goalId: 'b', dependsOnGoalId: 'a', createdAt: '' }],
    });

    renderPanel(b, [], { goals: [a, b] });

    expect(screen.getByTestId('goal-launch-agent-btn')).not.toBeDisabled();
  });

  it('does not fire onLaunchAgent from a disabled, blocked button', async () => {
    const user = userEvent.setup();
    const onLaunchAgent = vi.fn();
    const a = makeGoal({ id: 'a', parentId: 'root', name: 'Backend' });
    const b = makeGoal({ id: 'b', parentId: 'root', name: 'Frontend' });
    useStore.setState({
      goalsDraft: [a, b],
      goalDependenciesDraft: [{ id: 'dep-1', goalId: 'b', dependsOnGoalId: 'a', createdAt: '' }],
    });

    renderPanel(b, [], { goals: [a, b], onLaunchAgent });
    await user.click(screen.getByTestId('goal-launch-agent-btn'));
    expect(onLaunchAgent).not.toHaveBeenCalled();
  });
});

describe('GoalDetailPanel cost', () => {
  const PATH = '/proj';
  afterEach(() => useStore.setState({ rootPath: null, agentUsageRows: {}, agentUsageStatus: {} }));

  it('shows the subtree cost and the cost of a run once usage arrives', () => {
    const goal = makeGoal();
    useStore.setState({
      rootPath: PATH,
      agentUsageRows: {},
      agentUsageStatus: { [PATH]: 'ready' },
    });
    renderPanel(goal, [makeTicket({ goalId: goal.id })], {
      runs: [
        {
          id: 'r1',
          goalId: goal.id,
          agentId: 'a1',
          ticketId: null,
          prompt: 'p',
          model: 'm',
          provider: 'claude',
          source: 'ui',
          outcome: 'completed',
          summary: '',
          startedAt: '2026-09-29',
          finishedAt: null,
        },
      ],
    });
    expect(screen.getByText('No agent runs recorded yet.')).toBeDefined();

    act(() =>
      useStore.setState({
        agentUsageRows: {
          [PATH]: [
            usageRow({ agentId: 'a1', goalId: goal.id, costUsd: 2.5 }),
            usageRow({ ticketId: 't1', costUsd: 1 }),
          ],
        },
      })
    );

    expect(screen.getByText('$3.50')).toBeDefined();
    // 'a1' has a goal run, so its own $2.50 shows beside it; the ticket run does not.
    expect(screen.getAllByText('$2.50').length).toBeGreaterThanOrEqual(2);
  });
});
