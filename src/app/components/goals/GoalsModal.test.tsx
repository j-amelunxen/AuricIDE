import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalsModal, buildGoalLaunchPrompt } from './GoalsModal';
import type { PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';

const mocks = {
  setGoalsModalOpen: vi.fn(),
  setSelectedGoalId: vi.fn(),
  setOrchestrationOpen: vi.fn(),
  loadGoals: vi.fn(),
  saveGoals: vi.fn(),
  discardGoalChanges: vi.fn(),
  addGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(),
  achieveGoal: vi.fn(),
  linkRequirementToGoal: vi.fn(),
  unlinkRequirementFromGoal: vi.fn(),
  loadPmData: vi.fn(),
  loadRequirements: vi.fn(),
  updateTicket: vi.fn(),
  savePmData: vi.fn(),
  setSpawnDialogOpen: vi.fn(),
  setInitialAgentTask: vi.fn(),
  setSpawnAgentGoalId: vi.fn(),
  startConductor: vi.fn(),
  stopConductor: vi.fn(),
  setConductorMaxConcurrent: vi.fn(),
  conductorTick: vi.fn(async () => undefined),
  approveConductorTicket: vi.fn(async () => undefined),
  dismissConductorApproval: vi.fn(),
};

function makeGoal(overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id: 'g1',
    parentId: null,
    name: 'Ship orchestration',
    description: 'The orchestration layer works end to end',
    successCriteria: '- conductor completes a goal',
    status: 'active',
    priority: 'high',
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

const storeState = {
  goalsModalOpen: true,
  goalsDraft: [makeGoal()],
  goalRunsDraft: [],
  goalRequirementLinksDraft: [],
  goalStationsDraft: [],
  goalsDirty: false,
  selectedGoalId: null as string | null,
  rootPath: '/project',
  pmDraftTickets: [] as PmTicket[],
  requirementsDraft: [],
  agents: [],
  conductorRunning: false,
  conductorGoalId: null,
  conductorMaxConcurrent: 2,
  conductorAssignments: {},
  conductorPendingApprovals: [],
  conductorDecisions: [],
  ...mocks,
};

vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

describe('buildGoalLaunchPrompt', () => {
  it('preserves an explicit goal prompt and appends the ticket-creation contract', () => {
    const prompt = buildGoalLaunchPrompt(makeGoal({ goalPrompt: 'Custom prompt' }));
    expect(prompt).toContain('Custom prompt');
    expect(prompt).toContain('create_ticket');
  });

  it('generates a prompt from name, description and criteria', () => {
    const prompt = buildGoalLaunchPrompt(makeGoal());
    expect(prompt).toContain('Ship orchestration');
    expect(prompt).toContain('end to end');
    expect(prompt).toContain('conductor completes a goal');
    expect(prompt).toContain('evaluate_goal');
  });

  it('tells the planning agent to attach tickets via goalId', () => {
    const prompt = buildGoalLaunchPrompt(makeGoal());
    expect(prompt).toContain('goalId');
  });

  it('includes the actual goal id so MCP calls (evaluate_goal, decompose_goal) can target it', () => {
    const prompt = buildGoalLaunchPrompt(makeGoal({ id: 'g-99' }));
    expect(prompt).toContain('g-99');
  });

  it('starts the generated prompt with the /goal command', () => {
    const prompt = buildGoalLaunchPrompt(makeGoal());
    expect(prompt.startsWith('/goal\n\n')).toBe(true);
  });

  it('still invokes /goal for an explicit goal prompt', () => {
    const prompt = buildGoalLaunchPrompt(makeGoal({ goalPrompt: 'Custom prompt' }));
    expect(prompt.startsWith('/goal\n\n')).toBe(true);
  });

  it('includes the saved line in order and asks for executable and supervised tickets', () => {
    const stations: PmGoalStation[] = [
      {
        id: 's1',
        goalId: 'g1',
        name: 'Implement API',
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
      },
      {
        id: 's2',
        goalId: 'g1',
        name: 'Approve launch',
        kind: 'human',
        status: 'planned',
        evidenceKind: 'human',
        predicate: { type: 'human' },
        evidenceNote: '',
        ticketId: null,
        lane: 0,
        sortOrder: 1,
        lastCheckedAt: null,
        doneAt: null,
        createdAt: '',
        updatedAt: '',
      },
    ];

    const prompt = buildGoalLaunchPrompt(makeGoal(), stations);

    expect(prompt).toContain('## Saved line');
    expect(prompt.indexOf('1. Implement API (stationId: s1)')).toBeLessThan(
      prompt.indexOf('2. Approve launch (stationId: s2, human)')
    );
    expect(prompt).toMatch(/create_ticket.*goalId.*g1/i);
    expect(prompt).toMatch(/human.*needsHumanSupervision|needsHumanSupervision.*human/i);
    expect(prompt).toMatch(/update_station.*stationId.*ticketId/i);
    expect(prompt).toMatch(/list_epics[\s\S]*create_epic[\s\S]*epicId[\s\S]*create_ticket/i);
  });

  it('keeps explicit prompt content when stations exist', () => {
    expect(buildGoalLaunchPrompt(makeGoal({ goalPrompt: 'Custom prompt' }), [])).toContain(
      'Custom prompt'
    );
  });
});

describe('GoalsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.selectedGoalId = null;
    storeState.pmDraftTickets = [];
    localStorage.clear();
  });

  it('teaches the goal workflow on first run and dismisses persistently', async () => {
    const user = userEvent.setup();
    render(<GoalsModal />);
    const strip = screen.getByTestId('goals-workflow-strip');
    expect(strip.textContent).toContain('Define');
    expect(strip.textContent).toContain('conductor');
    await user.click(screen.getByTestId('goals-workflow-dismiss'));
    expect(screen.queryByTestId('goals-workflow-strip')).toBeNull();
    expect(localStorage.getItem('auric.goals.workflow-strip-dismissed')).toBe('1');
  });

  it('does not show the workflow strip once dismissed', () => {
    localStorage.setItem('auric.goals.workflow-strip-dismissed', '1');
    render(<GoalsModal />);
    expect(screen.queryByTestId('goals-workflow-strip')).toBeNull();
  });

  it('replays the workflow strip via the help button', async () => {
    localStorage.setItem('auric.goals.workflow-strip-dismissed', '1');
    const user = userEvent.setup();
    render(<GoalsModal />);
    await user.click(screen.getByTestId('goals-help-btn'));
    expect(screen.getByTestId('goals-workflow-strip')).toBeTruthy();
    expect(localStorage.getItem('auric.goals.workflow-strip-dismissed')).toBeNull();
  });

  it('renders tree, conductor bar, and loads data on open', () => {
    render(<GoalsModal />);
    expect(screen.getByTestId('goals-modal')).toBeTruthy();
    expect(screen.getByTestId('goal-node-g1')).toBeTruthy();
    expect(screen.getByTestId('conductor-panel')).toBeTruthy();
    expect(mocks.loadGoals).toHaveBeenCalledWith('/project');
    expect(mocks.loadPmData).toHaveBeenCalledWith('/project');
    expect(mocks.loadRequirements).toHaveBeenCalledWith('/project');
  });

  it('exposes an accessible dialog', () => {
    render(<GoalsModal />);
    expect(screen.getByRole('dialog', { name: /goals/i })).toBeInTheDocument();
  });

  it('opens the create dialog', async () => {
    const user = userEvent.setup();
    render(<GoalsModal />);
    await user.click(screen.getByTestId('goals-create-btn'));
    expect(screen.getByTestId('goal-create-dialog')).toBeTruthy();
  });

  it('shows detail panel and opens the spawn dialog, prefilled for the selected goal', async () => {
    storeState.selectedGoalId = 'g1';
    const user = userEvent.setup();
    render(<GoalsModal />);
    await user.click(screen.getByTestId('goal-launch-agent-btn'));

    // Provider/model are chosen in the shared spawn dialog, not hardcoded here.
    expect(mocks.setSpawnAgentGoalId).toHaveBeenCalledWith('g1');
    expect(mocks.setInitialAgentTask).toHaveBeenCalledWith(
      expect.stringContaining('Ship orchestration')
    );
    expect(mocks.setSpawnDialogOpen).toHaveBeenCalledWith(true);
  });

  it('links a ticket picked from the browser and persists it immediately', async () => {
    storeState.selectedGoalId = 'g1';
    storeState.pmDraftTickets = [makeTicket({ id: 't1', name: 'Fix login bug' })];
    const user = userEvent.setup();
    render(<GoalsModal />);

    await user.click(screen.getByTestId('goal-ticket-add-btn'));
    await user.click(screen.getByTestId('goal-ticket-link-t1'));

    expect(mocks.updateTicket).toHaveBeenCalledWith('t1', { goalId: 'g1' });
    expect(mocks.savePmData).toHaveBeenCalledWith('/project');
  });

  it('unlinks an attached ticket and persists it immediately', async () => {
    storeState.selectedGoalId = 'g1';
    storeState.pmDraftTickets = [makeTicket({ id: 't1', name: 'Attached', goalId: 'g1' })];
    const user = userEvent.setup();
    render(<GoalsModal />);

    await user.click(screen.getByTestId('goal-ticket-unlink-t1'));

    expect(mocks.updateTicket).toHaveBeenCalledWith('t1', { goalId: null });
    expect(mocks.savePmData).toHaveBeenCalledWith('/project');
  });

  it('starts the conductor scoped to the selected goal', async () => {
    storeState.selectedGoalId = 'g1';
    const user = userEvent.setup();
    render(<GoalsModal />);
    await user.click(screen.getByTestId('conductor-start-btn'));
    expect(mocks.startConductor).toHaveBeenCalledWith('g1');
    expect(mocks.conductorTick).toHaveBeenCalled();
  });

  it('opens the orchestration canvas', async () => {
    const user = userEvent.setup();
    render(<GoalsModal />);
    await user.click(screen.getByTestId('goals-orchestration-btn'));
    expect(mocks.setOrchestrationOpen).toHaveBeenCalledWith(true);
  });
});
