import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { LinkGraphNode } from './LinkGraphNode';
import type { LinkGraphNodeData } from '@/lib/graph/linkGraphLayout';

function renderNode(data: Partial<LinkGraphNodeData> = {}) {
  const props = {
    id: 'test-node',
    type: 'linkGraph' as const,
    data: {
      label: 'readme.md',
      fullPath: '/project/readme.md',
      isActive: false,
      isBroken: false,
      linkCount: 0,
      backlinkCount: 0,
      ...data,
    },
    // Minimal NodeProps fields
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
    sourcePosition: undefined,
    targetPosition: undefined,
  };

  return render(
    <ReactFlowProvider>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <LinkGraphNode {...(props as unknown as any)} />
    </ReactFlowProvider>
  );
}

describe('LinkGraphNode', () => {
  it('renders the label', () => {
    renderNode({ label: 'notes.md' });
    expect(screen.getByText('notes.md')).toBeDefined();
  });

  it('renders the node test id', () => {
    renderNode();
    expect(screen.getByTestId('link-graph-node')).toBeDefined();
  });

  it('shows link counts when present', () => {
    renderNode({ linkCount: 3, backlinkCount: 2 });
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
  });

  it('does not show link counts when zero', () => {
    const { container } = renderNode({ linkCount: 0, backlinkCount: 0 });
    expect(container.querySelector('.text-foreground-muted')).toBeNull();
  });

  it('applies active styling', () => {
    renderNode({ isActive: true });
    const node = screen.getByTestId('link-graph-node');
    expect(node.className).toContain('neon-glow');
    expect(node.className).toContain('border-primary');
  });

  it('applies broken styling', () => {
    renderNode({ isBroken: true });
    const node = screen.getByTestId('link-graph-node');
    expect(node.className).toContain('border-dashed');
    expect(node.className).toContain('opacity-70');
  });
});
