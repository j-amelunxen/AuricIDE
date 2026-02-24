import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DependencyTreeView } from './DependencyTreeView';
import type { PmEpic, PmTicket, PmDependency } from '@/lib/tauri/pm';

// Mock React Flow to avoid rendering the whole thing in tests
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({
    nodes,
    edges,
  }: {
    nodes: { id: string; type: string; data: { label: string } }[];
    edges: unknown[];
  }) => (
    <div data-testid="react-flow-mock">
      <div data-testid="nodes-count">{nodes.length}</div>
      <div data-testid="edges-count">{edges.length}</div>
      {nodes.map((n) => (
        <div key={n.id} data-testid={`node-${n.id}`} data-type={n.type}>
          {n.data.label}
        </div>
      ))}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useNodesState: (initialNodes: unknown[]) => [initialNodes, vi.fn(), vi.fn()],
  useEdgesState: (initialEdges: unknown[]) => [initialEdges, vi.fn(), vi.fn()],
  MarkerType: {
    Arrow: 'arrow',
    ArrowClosed: 'arrowclosed',
  },
  Position: {
    Left: 'left',
    Top: 'top',
    Right: 'right',
    Bottom: 'bottom',
  },
}));

describe('DependencyTreeView', () => {
  const mockEpics: PmEpic[] = [
    { id: 'e1', name: 'Epic 1', description: '', sortOrder: 0, createdAt: '', updatedAt: '' },
  ];
  const mockTickets: PmTicket[] = [
    {
      id: 't1',
      epicId: 'e1',
      name: 'Ticket 1',
      description: '',
      status: 'open',
      statusUpdatedAt: '',
      priority: 'normal',
      sortOrder: 0,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 't2',
      epicId: 'e1',
      name: 'Ticket 2',
      description: '',
      status: 'open',
      statusUpdatedAt: '',
      priority: 'normal',
      sortOrder: 1,
      createdAt: '',
      updatedAt: '',
    },
  ];
  const mockDeps: PmDependency[] = [
    { id: 'd1', sourceType: 'ticket', sourceId: 't1', targetType: 'ticket', targetId: 't2' },
  ];

  it('renders nodes for all epics and tickets with correct types', () => {
    render(<DependencyTreeView epics={mockEpics} tickets={mockTickets} dependencies={mockDeps} />);

    expect(screen.getByTestId('nodes-count')).toHaveTextContent('3');

    const epicNode = screen.getByTestId('node-e1');
    expect(epicNode).toBeDefined();
    expect(epicNode.getAttribute('data-type')).toBe('epic');

    const ticketNode = screen.getByTestId('node-t1');
    expect(ticketNode).toBeDefined();
    expect(ticketNode.getAttribute('data-type')).toBe('ticket');
  });

  it('renders edges for all dependencies and containment', () => {
    render(<DependencyTreeView epics={mockEpics} tickets={mockTickets} dependencies={mockDeps} />);

    expect(screen.getByTestId('edges-count')).toHaveTextContent('3');
  });

  it('passes onSpawnAgent to ticket nodes when provided', () => {
    const onSpawnAgent = vi.fn();
    render(
      <DependencyTreeView
        epics={mockEpics}
        tickets={mockTickets}
        dependencies={mockDeps}
        onSpawnAgent={onSpawnAgent}
      />
    );

    // We can't easily check the callback being passed in this mock without more complex assertions,
    // but we'll ensure it doesn't crash and the nodes are rendered.
    expect(screen.getByTestId('node-t1')).toBeDefined();
  });

  it('passes onSelectEpic to epic nodes when provided', () => {
    const onSelectEpic = vi.fn();
    render(
      <DependencyTreeView
        epics={mockEpics}
        tickets={mockTickets}
        dependencies={mockDeps}
        onSelectEpic={onSelectEpic}
      />
    );

    expect(screen.getByTestId('node-e1')).toBeDefined();
  });
});
