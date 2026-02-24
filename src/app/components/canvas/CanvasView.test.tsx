import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasView } from './CanvasView';

vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ children, ...props }: Record<string, unknown>) => (
    <div data-testid="react-flow" {...props}>
      {children as React.ReactNode}
    </div>
  ),
  Background: (props: Record<string, unknown>) => <div data-testid="rf-background" {...props} />,
  BackgroundVariant: { Dots: 'dots' },
  Controls: (props: Record<string, unknown>) => <div data-testid="rf-controls" {...props} />,
  Handle: ({ type }: { type: string }) => <div data-testid={`handle-${type}`} />,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useNodesState: () => [[], vi.fn(), vi.fn()],
  useEdgesState: () => [[], vi.fn(), vi.fn()],
}));

describe('CanvasView', () => {
  it('renders the canvas container', () => {
    render(<CanvasView nodes={[]} edges={[]} />);
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
  });

  it('renders background with dots variant', () => {
    render(<CanvasView nodes={[]} edges={[]} />);
    const bg = screen.getByTestId('rf-background');
    expect(bg).toBeInTheDocument();
    expect(bg).toHaveAttribute('variant', 'dots');
  });

  it('renders controls', () => {
    render(<CanvasView nodes={[]} edges={[]} />);
    expect(screen.getByTestId('rf-controls')).toBeInTheDocument();
  });

  it('passes nodes and edges to ReactFlow', () => {
    const nodes = [
      {
        id: 'n1',
        type: 'trigger' as const,
        title: 'Node 1',
        description: 'Desc.',
        position: { x: 0, y: 0 },
      },
    ];
    const edges = [{ source: 'n1', target: 'n2' }];

    render(<CanvasView nodes={nodes} edges={edges} />);
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
  });
});
