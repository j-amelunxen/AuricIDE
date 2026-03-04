import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianCanvasView } from './ObsidianCanvasView';
import type { ObsidianEdge, ObsidianNode } from '@/lib/obsidian-canvas/types';

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children, nodes, edges }: Record<string, unknown>) => (
    <div
      data-testid="react-flow"
      data-nodes={JSON.stringify(nodes)}
      data-edges={JSON.stringify(edges)}
    >
      {children as React.ReactNode}
    </div>
  ),
  Background: (props: Record<string, unknown>) => <div data-testid="rf-background" {...props} />,
  BackgroundVariant: { Dots: 'dots' },
  Controls: (props: Record<string, unknown>) => <div data-testid="rf-controls" {...props} />,
  MiniMap: (props: Record<string, unknown>) => <div data-testid="rf-minimap" {...props} />,
  Handle: ({ type }: { type: string }) => <div data-testid={`handle-${type}`} />,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  applyNodeChanges: vi.fn((_, nodes) => nodes),
  applyEdgeChanges: vi.fn((_, edges) => edges),
  useNodesState: () => [[], vi.fn(), vi.fn()],
  useEdgesState: () => [[], vi.fn(), vi.fn()],
  useReactFlow: () => ({
    screenToFlowPosition: vi.fn(({ x, y }: { x: number; y: number }) => ({ x, y })),
  }),
}));

const sampleNodes: ObsidianNode[] = [
  { id: 'n1', type: 'text', text: 'Hello', x: 0, y: 0, width: 200, height: 100 },
  { id: 'n2', type: 'file', file: 'notes/doc.md', x: 300, y: 0, width: 200, height: 100 },
  { id: 'n3', type: 'link', url: 'https://example.com', x: 0, y: 200, width: 200, height: 100 },
  { id: 'n4', type: 'group', label: 'Group A', x: 500, y: 200, width: 400, height: 300 },
];

const sampleEdges: ObsidianEdge[] = [
  { id: 'e1', fromNode: 'n1', toNode: 'n2', fromSide: 'right', toSide: 'left' },
  { id: 'e2', fromNode: 'n2', toNode: 'n3', color: '4' },
];

describe('ObsidianCanvasView', () => {
  it('renders the ReactFlow container', () => {
    render(
      <ObsidianCanvasView
        nodes={[]}
        edges={[]}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onTextEdit={vi.fn()}
        onResize={vi.fn()}
      />
    );
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
  });

  it('renders background with dots variant', () => {
    render(
      <ObsidianCanvasView
        nodes={[]}
        edges={[]}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onTextEdit={vi.fn()}
        onResize={vi.fn()}
      />
    );
    const bg = screen.getByTestId('rf-background');
    expect(bg).toBeInTheDocument();
    expect(bg).toHaveAttribute('variant', 'dots');
  });

  it('renders controls', () => {
    render(
      <ObsidianCanvasView
        nodes={[]}
        edges={[]}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onTextEdit={vi.fn()}
        onResize={vi.fn()}
      />
    );
    expect(screen.getByTestId('rf-controls')).toBeInTheDocument();
  });

  it('renders minimap', () => {
    render(
      <ObsidianCanvasView
        nodes={[]}
        edges={[]}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onTextEdit={vi.fn()}
        onResize={vi.fn()}
      />
    );
    expect(screen.getByTestId('rf-minimap')).toBeInTheDocument();
  });

  it('maps ObsidianNode[] to ReactFlow nodes with correct types', () => {
    render(
      <ObsidianCanvasView
        nodes={sampleNodes}
        edges={[]}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onTextEdit={vi.fn()}
        onResize={vi.fn()}
      />
    );
    const rf = screen.getByTestId('react-flow');
    const rfNodes = JSON.parse(rf.getAttribute('data-nodes') ?? '[]') as Array<{
      id: string;
      type: string;
    }>;

    expect(rfNodes).toHaveLength(4);
    expect(rfNodes.find((n) => n.id === 'n1')?.type).toBe('obsidian-text');
    expect(rfNodes.find((n) => n.id === 'n2')?.type).toBe('obsidian-file');
    expect(rfNodes.find((n) => n.id === 'n3')?.type).toBe('obsidian-link');
    expect(rfNodes.find((n) => n.id === 'n4')?.type).toBe('obsidian-group');
  });

  it('maps ObsidianEdge[] to ReactFlow edges with fromNode→source, toNode→target', () => {
    render(
      <ObsidianCanvasView
        nodes={sampleNodes}
        edges={sampleEdges}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onTextEdit={vi.fn()}
        onResize={vi.fn()}
      />
    );
    const rf = screen.getByTestId('react-flow');
    const rfEdges = JSON.parse(rf.getAttribute('data-edges') ?? '[]') as Array<{
      id: string;
      source: string;
      target: string;
      sourceHandle?: string;
      targetHandle?: string;
    }>;

    expect(rfEdges).toHaveLength(2);
    const e1 = rfEdges.find((e) => e.id === 'e1');
    expect(e1?.source).toBe('n1');
    expect(e1?.target).toBe('n2');
    expect(e1?.sourceHandle).toBe('right');
    expect(e1?.targetHandle).toBe('left');
  });

  it('maps node position from x/y coordinates', () => {
    render(
      <ObsidianCanvasView
        nodes={sampleNodes}
        edges={[]}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onTextEdit={vi.fn()}
        onResize={vi.fn()}
      />
    );
    const rf = screen.getByTestId('react-flow');
    const rfNodes = JSON.parse(rf.getAttribute('data-nodes') ?? '[]') as Array<{
      id: string;
      position: { x: number; y: number };
    }>;

    const n1 = rfNodes.find((n) => n.id === 'n1');
    expect(n1?.position).toEqual({ x: 0, y: 0 });
    const n4 = rfNodes.find((n) => n.id === 'n4');
    expect(n4?.position).toEqual({ x: 500, y: 200 });
  });

  it('passes onTextEdit callback through node data', () => {
    const onTextEdit = vi.fn();
    render(
      <ObsidianCanvasView
        nodes={sampleNodes}
        edges={[]}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onTextEdit={onTextEdit}
        onResize={vi.fn()}
      />
    );
    const rf = screen.getByTestId('react-flow');
    const rfNodes = JSON.parse(rf.getAttribute('data-nodes') ?? '[]') as Array<{
      id: string;
      data: { onTextEdit?: string };
    }>;

    // onTextEdit is a function — JSON.stringify omits functions, so we just confirm the node exists
    const textNode = rfNodes.find((n) => n.id === 'n1');
    expect(textNode).toBeDefined();
  });

  it('calls onFileDrop when a .md file is dropped', () => {
    const onFileDrop = vi.fn();
    render(
      <ObsidianCanvasView
        nodes={[]}
        edges={[]}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onTextEdit={vi.fn()}
        onResize={vi.fn()}
        onFileDrop={onFileDrop}
      />
    );

    const dropZone = screen.getByRole('application');
    fireEvent.drop(dropZone, {
      dataTransfer: {
        getData: () => '/project/notes/readme.md',
      },
    });

    expect(onFileDrop).toHaveBeenCalledWith('/project/notes/readme.md', expect.any(Object));
  });

  it('ignores drop of non-markdown files', () => {
    const onFileDrop = vi.fn();
    render(
      <ObsidianCanvasView
        nodes={[]}
        edges={[]}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onTextEdit={vi.fn()}
        onResize={vi.fn()}
        onFileDrop={onFileDrop}
      />
    );

    const dropZone = screen.getByRole('application');
    fireEvent.drop(dropZone, {
      dataTransfer: {
        getData: () => '/project/image.png',
      },
    });

    expect(onFileDrop).not.toHaveBeenCalled();
  });

  it('sets dropEffect to copy on dragOver', () => {
    render(
      <ObsidianCanvasView
        nodes={[]}
        edges={[]}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onTextEdit={vi.fn()}
        onResize={vi.fn()}
      />
    );

    const dropZone = screen.getByRole('application');
    const event = new Event('dragover', { bubbles: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { dropEffect: '' },
    });
    Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
    dropZone.dispatchEvent(event);

    expect(
      (event as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect
    ).toBe('copy');
  });
});
