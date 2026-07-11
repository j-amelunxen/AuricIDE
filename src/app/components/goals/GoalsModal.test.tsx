import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalsModal, buildGoalLaunchPrompt } from './GoalsModal';
import type { PmGoal } from '@/lib/tauri/goals';

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
  spawnNewAgent: vi.fn(async () => ({ id: 'a1', provider: 'claude' })),
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

const storeState = {
  goalsModalOpen: true,
  goalsDraft: [makeGoal()],
  goalRunsDraft: [],
  goalRequirementLinksDraft: [],
  goalsDirty: false,
  selectedGoalId: null as string | null,
  rootPath: '/project',
  pmDraftTickets: [],
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
});

describe('GoalsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.selectedGoalId = null;
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

  it('shows detail panel and launches an agent for the selected goal', async () => {
    storeState.selectedGoalId = 'g1';
    const user = userEvent.setup();
    render(<GoalsModal />);
    await user.click(screen.getByTestId('goal-launch-agent-btn'));
    expect(mocks.spawnNewAgent).toHaveBeenCalledWith(
      expect.objectContaining({ spawnedByGoalId: 'g1', cwd: '/project' })
    );
    // No hardcoded mode: the provider-configured defaultPermissionMode decides.
    expect(mocks.spawnNewAgent).not.toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: expect.anything() })
    );
    expect(mocks.saveGoals).toHaveBeenCalledWith('/project');
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
