import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalDetailPanel } from './GoalDetailPanel';
import type { PmGoal } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';

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
