import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalsModal, buildGoalLaunchPrompt } from './GoalsModal';
import type { PmGoal } from '@/lib/tauri/goals';
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
  it('prefers the explicit goal prompt', () => {
    expect(buildGoalLaunchPrompt(makeGoal({ goalPrompt: 'Custom prompt' }))).toBe('Custom prompt');
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

  it('does not inject /goal into an explicit goal prompt', () => {
    const prompt = buildGoalLaunchPrompt(makeGoal({ goalPrompt: 'Custom prompt' }));
    expect(prompt).toBe('Custom prompt');
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
