import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GoalTree } from './GoalTree';
import type { PmGoal } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';

function makeGoal(overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id: 'g1',
    parentId: null,
    name: 'Root goal',
    description: '',
    successCriteria: '',
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

describe('GoalTree', () => {
  it('shows an explanatory empty state', () => {
    render(<GoalTree goals={[]} tickets={[]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByTestId('goal-tree-empty')).toBeTruthy();
  });

  it('empty state offers creating the first goal', () => {
    const onCreate = vi.fn();
    render(
      <GoalTree goals={[]} tickets={[]} selectedId={null} onSelect={() => {}} onCreate={onCreate} />
    );
    fireEvent.click(screen.getByTestId('goal-tree-empty-create'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('renders the hierarchy with children', () => {
    const goals = [
      makeGoal({ id: 'root', name: 'Root' }),
      makeGoal({ id: 'child', name: 'Child', parentId: 'root' }),
    ];
    render(<GoalTree goals={goals} tickets={[]} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByTestId('goal-node-root')).toBeTruthy();
    expect(screen.getByTestId('goal-node-child')).toBeTruthy();
  });

  it('collapses a subtree on toggle', () => {
    const goals = [
      makeGoal({ id: 'root', name: 'Root' }),
      makeGoal({ id: 'child', name: 'Child', parentId: 'root' }),
    ];
    render(<GoalTree goals={goals} tickets={[]} selectedId={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId('goal-toggle-root'));
    expect(screen.queryByTestId('goal-node-child')).toBeNull();
  });

  it('selects a goal on click', () => {
    const onSelect = vi.fn();
    render(<GoalTree goals={[makeGoal()]} tickets={[]} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('goal-node-g1'));
    expect(onSelect).toHaveBeenCalledWith('g1');
  });

  it('shows ticket progress including subtree tickets', () => {
    const goals = [makeGoal({ id: 'root' }), makeGoal({ id: 'child', parentId: 'root' })];
    const tickets = [
      makeTicket({ id: 't1', goalId: 'root', status: 'done' }),
      makeTicket({ id: 't2', goalId: 'child', status: 'open' }),
    ];
    render(<GoalTree goals={goals} tickets={tickets} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByTestId('goal-progress-root').style.width).toBe('50%');
  });

  it('shows running agent badge', () => {
    render(
      <GoalTree
        goals={[makeGoal()]}
        tickets={[]}
        selectedId={null}
        onSelect={() => {}}
        activeAgentsByGoal={{ g1: 2 }}
      />
    );
    expect(screen.getByTestId('goal-agents-g1').textContent).toContain('2');
  });
});
