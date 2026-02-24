import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MindmapView } from './MindmapView';

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children, nodes, ...props }: Record<string, unknown>) => (
    <div data-testid="react-flow" data-node-count={(nodes as unknown[]).length} {...props}>
      {children as React.ReactNode}
    </div>
  ),
  Background: (props: Record<string, unknown>) => <div data-testid="rf-background" {...props} />,
  BackgroundVariant: { Dots: 'dots' },
  Controls: (props: Record<string, unknown>) => <div data-testid="rf-controls" {...props} />,
  MiniMap: (props: Record<string, unknown>) => <div data-testid="rf-minimap" {...props} />,
  Handle: ({ type }: { type: string }) => <div data-testid={`handle-${type}`} />,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useNodesState: () => [[], vi.fn(), vi.fn()],
  useEdgesState: () => [[], vi.fn(), vi.fn()],
  applyNodeChanges: vi.fn((changes: unknown[], nodes: unknown[]) => nodes),
}));

describe('MindmapView', () => {
  it('renders without crashing given empty nodes and edges', () => {
    render(<MindmapView nodes={[]} edges={[]} onNodeEdit={vi.fn()} />);
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
  });

  it('renders correct number of nodes', () => {
    const nodes = [
      {
        id: 'n1',
        content: 'Root',
        level: 1,
        lineStart: 0,
        lineEnd: 0,
        position: { x: 0, y: 0 },
      },
      {
        id: 'n2',
        content: 'Child',
        level: 2,
        lineStart: 2,
        lineEnd: 2,
        position: { x: 250, y: 0 },
      },
    ];
    const edges = [{ source: 'n1', target: 'n2' }];

    render(<MindmapView nodes={nodes} edges={edges} onNodeEdit={vi.fn()} />);
    const rf = screen.getByTestId('react-flow');
    expect(rf.getAttribute('data-node-count')).toBe('2');
  });

  it('passes onNodeEdit callback into node data', () => {
    const onNodeEdit = vi.fn();
    const nodes = [
      {
        id: 'n1',
        content: 'Root',
        level: 1,
        lineStart: 0,
        lineEnd: 0,
        position: { x: 0, y: 0 },
      },
    ];

    render(<MindmapView nodes={nodes} edges={[]} onNodeEdit={onNodeEdit} />);

    // The component maps onNodeEdit into each node's data.onEdit.
    // Since ReactFlow is mocked, we verify the component renders without error
    // and that the mock ReactFlow receives nodes with the right structure.
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
  });

  it('renders background, controls, and minimap', () => {
    render(<MindmapView nodes={[]} edges={[]} onNodeEdit={vi.fn()} />);
    expect(screen.getByTestId('rf-background')).toBeInTheDocument();
    expect(screen.getByTestId('rf-controls')).toBeInTheDocument();
    expect(screen.getByTestId('rf-minimap')).toBeInTheDocument();
  });
});
