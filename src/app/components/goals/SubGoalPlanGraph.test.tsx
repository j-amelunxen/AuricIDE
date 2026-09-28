import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { PmGoal, PmGoalDependency } from '@/lib/tauri/goals';
import { SubGoalPlanGraph, SubGoalPlanNode } from './SubGoalPlanGraph';
import type { SubGoalPlanGroup } from '@/lib/orchestration/subGoalPlanGraph';

// The graph's own layout (buildSubGoalPlanGraph) is covered by
// subGoalPlanGraph.test.ts. Mocking React Flow here — as DependencyTreeView's
// test does — keeps this file about wiring: does the component hand React
// Flow the right node/edge counts, and does it stay silent below two children.
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');
  return {
    ...actual,
    ReactFlow: ({ nodes, edges }: { nodes: { id: string }[]; edges: unknown[] }) => (
      <div data-testid="react-flow-mock">
        <div data-testid="nodes-count">{nodes.length}</div>
        <div data-testid="edges-count">{edges.length}</div>
      </div>
    ),
    Background: () => null,
  };
});

const TS = '2026-01-10 10:00:00';

function goal(id: string, overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id,
    parentId: 'P',
    name: id,
    description: '',
    successCriteria: '',
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

const parent = goal('P', { id: 'P', parentId: null });

function edge(goalId: string, dependsOnGoalId: string): PmGoalDependency {
  return { id: `${goalId}->${dependsOnGoalId}`, goalId, dependsOnGoalId, createdAt: TS };
}

describe('SubGoalPlanGraph', () => {
  it('renders nothing for a single child', () => {
    const { container } = render(
      <SubGoalPlanGraph
        goals={[parent, goal('A')]}
        dependencies={[]}
        parentId="P"
        onSelectGoal={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('hands React Flow one node per group and one edge per dependency', () => {
    const goals = [parent, goal('A'), goal('B'), goal('C', { bundle: 'api' }), goal('D')];
    const dependencies = [edge('B', 'A'), edge('D', 'C')];
    render(
      <SubGoalPlanGraph
        goals={goals}
        dependencies={dependencies}
        parentId="P"
        onSelectGoal={vi.fn()}
      />
    );
    // A, B, {C-bundle-alone since bundle needs 2+ same-parent same-label
    // siblings — here it's a lone member so it stays its own node}, D.
    expect(screen.getByTestId('nodes-count')).toHaveTextContent('4');
    expect(screen.getByTestId('edges-count')).toHaveTextContent('2');
  });
});

describe('SubGoalPlanNode', () => {
  function renderNode(group: SubGoalPlanGroup, onSelectGoal = vi.fn()) {
    return render(
      <ReactFlowProvider>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <SubGoalPlanNode data={{ group, onSelectGoal }} {...({} as any)} />
      </ReactFlowProvider>
    );
  }

  it('shows the bundle label as a frame header', () => {
    const group: SubGoalPlanGroup = {
      key: 'bundle:P:api',
      bundleLabel: 'api',
      wave: 0,
      members: [
        { id: 'B', name: 'Backend', status: 'active', waitingOnLabel: null },
        { id: 'C', name: 'Contracts', status: 'active', waitingOnLabel: null },
      ],
    };
    renderNode(group);
    expect(screen.getByText('Bundle: api')).toBeInTheDocument();
    expect(screen.getByText('Backend')).toBeInTheDocument();
    expect(screen.getByText('Contracts')).toBeInTheDocument();
  });

  it('dims a blocked member and names what it waits for', () => {
    const group: SubGoalPlanGroup = {
      key: 'goal:D',
      bundleLabel: null,
      wave: 1,
      members: [{ id: 'D', name: 'Ship it', status: 'active', waitingOnLabel: 'Backend' }],
    };
    renderNode(group);
    const member = screen.getByTestId('subgoal-plan-member-D');
    expect(member.className).toContain('opacity-50');
    expect(screen.getByTestId('subgoal-plan-waiting-D')).toHaveTextContent('waits for Backend');
  });

  it('keeps the waiting note off the name line so the name keeps its full width', () => {
    const group: SubGoalPlanGroup = {
      key: 'goal:D',
      bundleLabel: null,
      wave: 1,
      members: [
        { id: 'D', name: 'Frontend integration', status: 'active', waitingOnLabel: 'Backend' },
      ],
    };
    renderNode(group);
    const name = screen.getByText('Frontend integration');
    const waiting = screen.getByTestId('subgoal-plan-waiting-D');
    // Two separate elements, not one truncated string sharing a row.
    expect(name).not.toBe(waiting);
    expect(name).not.toHaveTextContent('waits for');
    expect(waiting.textContent).toBe('waits for Backend');
  });

  it('shows the bundle label the pure module computed, without re-deriving it', () => {
    const group: SubGoalPlanGroup = {
      key: 'goal:D',
      bundleLabel: null,
      wave: 1,
      members: [{ id: 'D', name: 'Ship it', status: 'active', waitingOnLabel: 'bundle api' }],
    };
    renderNode(group);
    expect(screen.getByTestId('subgoal-plan-waiting-D')).toHaveTextContent('waits for bundle api');
  });

  it('selects the clicked member, not the whole node', () => {
    const onSelectGoal = vi.fn();
    const group: SubGoalPlanGroup = {
      key: 'bundle:P:api',
      bundleLabel: 'api',
      wave: 0,
      members: [
        { id: 'B', name: 'Backend', status: 'active', waitingOnLabel: null },
        { id: 'C', name: 'Contracts', status: 'active', waitingOnLabel: null },
      ],
    };
    renderNode(group, onSelectGoal);
    screen.getByTestId('subgoal-plan-member-C').click();
    expect(onSelectGoal).toHaveBeenCalledWith('C');
    expect(onSelectGoal).not.toHaveBeenCalledWith('B');
  });
});
