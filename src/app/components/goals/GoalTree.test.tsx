import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { getGoalDropPosition, GoalTree } from './GoalTree';
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

  it('highlights an inside drop and reports the tree move', () => {
    const onMoveGoal = vi.fn();
    const goals = [makeGoal({ id: 'source' }), makeGoal({ id: 'target' })];
    render(
      <GoalTree
        goals={goals}
        tickets={[]}
        selectedId={null}
        onSelect={() => {}}
        onMoveGoal={onMoveGoal}
      />
    );
    const source = screen.getByTestId('goal-node-source');
    const target = screen.getByTestId('goal-node-target');
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      height: 40,
      bottom: 40,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() };

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer, clientY: 20 });
    expect(target.className).toContain('ring-primary/60');
    fireEvent.drop(target, { dataTransfer, clientY: 20 });

    expect(onMoveGoal).toHaveBeenCalledWith('source', 'target', 'inside');
  });

  it('divides a goal row into before, inside, and after drop zones', () => {
    const rect = { top: 100, height: 40 };
    expect(getGoalDropPosition(102, rect)).toBe('before');
    expect(getGoalDropPosition(120, rect)).toBe('inside');
    expect(getGoalDropPosition(138, rect)).toBe('after');
  });

  it('blocks drops into descendants', () => {
    const onMoveGoal = vi.fn();
    const goals = [
      makeGoal({ id: 'root' }),
      makeGoal({ id: 'child', parentId: 'root' }),
      makeGoal({ id: 'sibling', sortOrder: 1 }),
    ];
    render(
      <GoalTree
        goals={goals}
        tickets={[]}
        selectedId={null}
        onSelect={() => {}}
        onMoveGoal={onMoveGoal}
      />
    );
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() };

    fireEvent.dragStart(screen.getByTestId('goal-node-root'), { dataTransfer });
    const child = screen.getByTestId('goal-node-child');
    fireEvent.dragOver(child, { dataTransfer, clientY: 20 });
    expect(child.className).not.toContain('ring-primary/60');
    fireEvent.drop(child, { dataTransfer, clientY: 20 });
    expect(onMoveGoal).not.toHaveBeenCalled();
  });
});

describe('GoalTree load status', () => {
  const baseProps = {
    goals: [makeGoal({ id: 'g1' })],
    tickets: [makeTicket()],
    selectedId: null,
    onSelect: () => {},
    onCreate: vi.fn(),
  };

  it('does not claim emptiness while goals are still loading', () => {
    render(<GoalTree {...baseProps} goals={[]} loading />);
    expect(screen.queryByTestId('goal-tree-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('goal-tree-loading')).toBeInTheDocument();
  });

  it('says goals could not be read instead of showing an empty tree', () => {
    render(<GoalTree {...baseProps} goals={[]} loadError="database is locked" />);
    expect(screen.queryByTestId('goal-tree-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('goal-tree-error')).toHaveTextContent('database is locked');
  });

  it('offers no "create your first goal" while the load is broken', () => {
    render(<GoalTree {...baseProps} goals={[]} loadError="boom" />);
    expect(screen.queryByTestId('goal-tree-empty-create')).not.toBeInTheDocument();
  });

  it('shows the empty state once a load finished with no goals', () => {
    render(<GoalTree {...baseProps} goals={[]} />);
    expect(screen.getByTestId('goal-tree-empty')).toBeInTheDocument();
  });

  it('keeps showing goals already loaded during a refresh', () => {
    render(<GoalTree {...baseProps} loading />);
    expect(screen.getByTestId('goal-tree')).toBeInTheDocument();
    expect(screen.queryByTestId('goal-tree-loading')).not.toBeInTheDocument();
  });
});
