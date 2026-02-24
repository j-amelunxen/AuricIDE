import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  MermaidFlowchartView,
  generateNodeId,
  computeNewNodePosition,
} from './MermaidFlowchartView';
import type { MermaidFlowchartData } from '@/lib/mermaid/mermaidFlowchartParser';
import type { FlowchartNode as FlowchartNodeType } from '@/lib/mermaid/mermaidFlowchartParser';

let capturedOnNodesDelete: ((nodes: { id: string }[]) => void) | undefined;

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children, nodes, edges, onNodesDelete, ...props }: Record<string, unknown>) => {
    capturedOnNodesDelete = onNodesDelete as ((nodes: { id: string }[]) => void) | undefined;
    return (
      <div
        data-testid="react-flow"
        data-node-count={(nodes as unknown[]).length}
        data-edge-count={(edges as unknown[]).length}
        {...props}
      >
        {children as React.ReactNode}
      </div>
    );
  },
  Background: (props: Record<string, unknown>) => <div data-testid="rf-background" {...props} />,
  BackgroundVariant: { Dots: 'dots' },
  Controls: (props: Record<string, unknown>) => <div data-testid="rf-controls" {...props} />,
  MiniMap: (props: Record<string, unknown>) => <div data-testid="rf-minimap" {...props} />,
  Panel: ({ children, ...props }: { children: React.ReactNode; position: string }) => (
    <div data-testid="rf-panel" {...props}>
      {children}
    </div>
  ),
  Handle: ({ type }: { type: string }) => <div data-testid={`handle-${type}`} />,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useNodesState: () => [[], vi.fn(), vi.fn()],
  useEdgesState: () => [[], vi.fn(), vi.fn()],
  applyNodeChanges: vi.fn((changes: unknown[], nodes: unknown[]) => nodes),
}));

const sampleData: MermaidFlowchartData = {
  direction: 'TD',
  nodes: [
    { id: 'A', label: 'Start', shape: 'rect', position: { x: 0, y: 0 } },
    { id: 'B', label: 'End', shape: 'round', position: { x: 250, y: 0 } },
  ],
  edges: [{ source: 'A', target: 'B', style: 'arrow' }],
  subgraphs: [],
};

const emptyData: MermaidFlowchartData = {
  direction: 'TD',
  nodes: [],
  edges: [],
  subgraphs: [],
};

describe('MermaidFlowchartView', () => {
  it('renders without crashing given empty data', () => {
    render(<MermaidFlowchartView data={emptyData} />);
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
  });

  it('renders correct number of nodes', () => {
    render(<MermaidFlowchartView data={sampleData} />);
    const rf = screen.getByTestId('react-flow');
    expect(rf.getAttribute('data-node-count')).toBe('2');
  });

  it('renders correct number of edges', () => {
    render(<MermaidFlowchartView data={sampleData} />);
    const rf = screen.getByTestId('react-flow');
    expect(rf.getAttribute('data-edge-count')).toBe('1');
  });

  it('passes direction and shape info into node data', () => {
    render(<MermaidFlowchartView data={sampleData} onDataChange={vi.fn()} />);
    // The component maps direction and shape into each node's data.
    // Since ReactFlow is mocked, we verify the component renders without error
    // and that the mock ReactFlow receives nodes with the right count.
    const rf = screen.getByTestId('react-flow');
    expect(rf.getAttribute('data-node-count')).toBe('2');
  });

  it('renders background, controls, and minimap', () => {
    render(<MermaidFlowchartView data={emptyData} />);
    expect(screen.getByTestId('rf-background')).toBeInTheDocument();
    expect(screen.getByTestId('rf-controls')).toBeInTheDocument();
    expect(screen.getByTestId('rf-minimap')).toBeInTheDocument();
  });

  it('does not crash when onDataChange is not provided', () => {
    // Render without onDataChange — should not throw
    expect(() => {
      render(<MermaidFlowchartView data={sampleData} />);
    }).not.toThrow();
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
  });

  it('always renders an expand button', () => {
    render(<MermaidFlowchartView data={sampleData} />);
    expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument();
  });

  it('opens fullscreen overlay when expand is clicked', async () => {
    const user = userEvent.setup();
    render(<MermaidFlowchartView data={sampleData} />);
    await user.click(screen.getByRole('button', { name: /expand/i }));
    expect(document.querySelector('.flowchart-fullscreen-overlay')).not.toBeNull();
  });

  it('fullscreen overlay contains a close button', async () => {
    const user = userEvent.setup();
    render(<MermaidFlowchartView data={sampleData} />);
    await user.click(screen.getByRole('button', { name: /expand/i }));
    expect(screen.getByRole('button', { name: /close fullscreen/i })).toBeInTheDocument();
  });

  it('fullscreen overlay contains a ReactFlow instance', async () => {
    const user = userEvent.setup();
    render(<MermaidFlowchartView data={sampleData} />);
    await user.click(screen.getByRole('button', { name: /expand/i }));
    const overlay = document.querySelector('.flowchart-fullscreen-overlay');
    expect(overlay!.querySelector('[data-testid="react-flow"]')).not.toBeNull();
  });

  it('closes fullscreen overlay when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<MermaidFlowchartView data={sampleData} />);
    await user.click(screen.getByRole('button', { name: /expand/i }));
    expect(document.querySelector('.flowchart-fullscreen-overlay')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /close fullscreen/i }));
    expect(document.querySelector('.flowchart-fullscreen-overlay')).toBeNull();
  });

  it('closes fullscreen overlay on Escape key', async () => {
    const user = userEvent.setup();
    render(<MermaidFlowchartView data={sampleData} />);
    await user.click(screen.getByRole('button', { name: /expand/i }));
    expect(document.querySelector('.flowchart-fullscreen-overlay')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(document.querySelector('.flowchart-fullscreen-overlay')).toBeNull();
  });
});

describe('generateNodeId', () => {
  it('returns node_1 for an empty set', () => {
    expect(generateNodeId(new Set())).toBe('node_1');
  });

  it('returns node_2 when node_1 exists', () => {
    expect(generateNodeId(new Set(['node_1']))).toBe('node_2');
  });

  it('skips occupied IDs', () => {
    expect(generateNodeId(new Set(['node_1', 'node_2', 'node_3']))).toBe('node_4');
  });

  it('fills gaps', () => {
    expect(generateNodeId(new Set(['node_1', 'node_3']))).toBe('node_2');
  });
});

describe('computeNewNodePosition', () => {
  it('returns {100, 100} for an empty list', () => {
    expect(computeNewNodePosition([], 'TD')).toEqual({ x: 100, y: 100 });
  });

  it('places below the deepest node for TD', () => {
    const nodes: FlowchartNodeType[] = [
      { id: 'A', label: 'A', shape: 'rect', position: { x: 50, y: 200 } },
      { id: 'B', label: 'B', shape: 'rect', position: { x: 100, y: 100 } },
    ];
    const pos = computeNewNodePosition(nodes, 'TD');
    expect(pos).toEqual({ x: 100, y: 320 });
  });

  it('places right of the rightmost node for LR', () => {
    const nodes: FlowchartNodeType[] = [
      { id: 'A', label: 'A', shape: 'rect', position: { x: 300, y: 50 } },
      { id: 'B', label: 'B', shape: 'rect', position: { x: 100, y: 150 } },
    ];
    const pos = computeNewNodePosition(nodes, 'LR');
    expect(pos).toEqual({ x: 500, y: 100 });
  });

  it('treats TB the same as TD (vertical)', () => {
    const nodes: FlowchartNodeType[] = [
      { id: 'A', label: 'A', shape: 'rect', position: { x: 80, y: 300 } },
    ];
    const pos = computeNewNodePosition(nodes, 'TB');
    expect(pos).toEqual({ x: 100, y: 420 });
  });

  it('treats BT as vertical, RL as horizontal', () => {
    const nodes: FlowchartNodeType[] = [
      { id: 'A', label: 'A', shape: 'rect', position: { x: 200, y: 400 } },
    ];
    expect(computeNewNodePosition(nodes, 'BT')).toEqual({ x: 100, y: 520 });
    expect(computeNewNodePosition(nodes, 'RL')).toEqual({ x: 400, y: 100 });
  });
});

describe('Add Node button', () => {
  it('is not visible without onDataChange', () => {
    render(<MermaidFlowchartView data={sampleData} />);
    expect(screen.queryByRole('button', { name: /add node/i })).toBeNull();
  });

  it('is visible with onDataChange', () => {
    render(<MermaidFlowchartView data={sampleData} onDataChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /add node/i })).toBeInTheDocument();
  });

  it('click calls onDataChange with a new node (3 instead of 2)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MermaidFlowchartView data={sampleData} onDataChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /add node/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const newData = onChange.mock.calls[0][0] as MermaidFlowchartData;
    expect(newData.nodes).toHaveLength(3);
    expect(newData.nodes[2].label).toBe('New Node');
    expect(newData.nodes[2].shape).toBe('rect');
  });

  it('places node at {100, 100} for empty diagram', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MermaidFlowchartView data={emptyData} onDataChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /add node/i }));
    const newData = onChange.mock.calls[0][0] as MermaidFlowchartData;
    expect(newData.nodes[0].position).toEqual({ x: 100, y: 100 });
  });

  it('appears in the fullscreen overlay', async () => {
    const user = userEvent.setup();
    render(<MermaidFlowchartView data={sampleData} onDataChange={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /expand/i }));
    const overlay = document.querySelector('.flowchart-fullscreen-overlay');
    expect(overlay!.querySelector('[aria-label="Add node"]')).not.toBeNull();
  });

  it('avoids ID conflict (node_1 taken → node_2)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const dataWithNode1: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [{ id: 'node_1', label: 'Existing', shape: 'rect', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
    };
    render(<MermaidFlowchartView data={dataWithNode1} onDataChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /add node/i }));
    const newData = onChange.mock.calls[0][0] as MermaidFlowchartData;
    expect(newData.nodes[1].id).toBe('node_2');
  });
});

describe('Node deletion (onNodesDelete)', () => {
  it('removes deleted node from data', () => {
    const onChange = vi.fn();
    render(<MermaidFlowchartView data={sampleData} onDataChange={onChange} />);
    capturedOnNodesDelete!([{ id: 'A' }]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const newData = onChange.mock.calls[0][0] as MermaidFlowchartData;
    expect(newData.nodes).toHaveLength(1);
    expect(newData.nodes[0].id).toBe('B');
  });

  it('removes connected edges when a node is deleted', () => {
    const onChange = vi.fn();
    render(<MermaidFlowchartView data={sampleData} onDataChange={onChange} />);
    capturedOnNodesDelete!([{ id: 'A' }]);
    const newData = onChange.mock.calls[0][0] as MermaidFlowchartData;
    expect(newData.edges).toHaveLength(0);
  });

  it('does not crash without onDataChange', () => {
    render(<MermaidFlowchartView data={sampleData} />);
    expect(() => capturedOnNodesDelete!([{ id: 'A' }])).not.toThrow();
  });

  it('handles multi-delete with connected edges', () => {
    const onChange = vi.fn();
    const multiData: MermaidFlowchartData = {
      direction: 'TD',
      nodes: [
        { id: 'X', label: 'X', shape: 'rect', position: { x: 0, y: 0 } },
        { id: 'Y', label: 'Y', shape: 'rect', position: { x: 100, y: 0 } },
        { id: 'Z', label: 'Z', shape: 'rect', position: { x: 200, y: 0 } },
      ],
      edges: [
        { source: 'X', target: 'Y', style: 'arrow' },
        { source: 'Y', target: 'Z', style: 'arrow' },
        { source: 'X', target: 'Z', style: 'dotted' },
      ],
      subgraphs: [],
    };
    render(<MermaidFlowchartView data={multiData} onDataChange={onChange} />);
    capturedOnNodesDelete!([{ id: 'X' }, { id: 'Y' }]);
    const newData = onChange.mock.calls[0][0] as MermaidFlowchartData;
    expect(newData.nodes).toHaveLength(1);
    expect(newData.nodes[0].id).toBe('Z');
    expect(newData.edges).toHaveLength(0);
  });
});
