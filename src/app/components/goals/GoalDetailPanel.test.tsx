import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

function renderPanel(goal: PmGoal, tickets: PmTicket[] = []) {
  return render(
    <GoalDetailPanel
      goal={goal}
      goals={[goal]}
      tickets={tickets}
      requirements={[]}
      requirementLinks={[]}
      runs={[]}
      launchingAgent={false}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
      onAchieve={vi.fn()}
      onAddSubGoal={vi.fn()}
      onLaunchAgent={vi.fn()}
      onLinkRequirement={vi.fn()}
      onUnlinkRequirement={vi.fn()}
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
