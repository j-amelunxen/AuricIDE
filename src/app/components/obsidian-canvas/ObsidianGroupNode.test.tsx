import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianGroupNode } from './ObsidianGroupNode';

vi.mock('@xyflow/react', () => ({
  Handle: ({ type, position }: { type: string; position: string }) => (
    <div data-testid={`handle-${type}-${position}`} />
  ),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));

function renderGroupNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: 'group-node-1',
    type: 'obsidian-group' as const,
    data: {
      label: 'My Group',
      color: undefined as string | undefined,
    },
    selected: false,
    ...overrides,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<ObsidianGroupNode {...(defaultProps as any)} />);
}

describe('ObsidianGroupNode', () => {
  it('renders the group label', () => {
    renderGroupNode();
    expect(screen.getByText('My Group')).toBeInTheDocument();
  });

  it('renders without a label when none provided', () => {
    renderGroupNode({ data: { label: undefined, color: undefined } });
    // Should not throw; just renders the container
    expect(screen.getByTestId('group-node-container')).toBeInTheDocument();
  });

  it('renders all four handles', () => {
    renderGroupNode();
    expect(screen.getByTestId('handle-target-top')).toBeInTheDocument();
    expect(screen.getByTestId('handle-target-left')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source-right')).toBeInTheDocument();
  });

  it('has negative z-index so content nodes appear above it', () => {
    const { container } = renderGroupNode();
    const root = container.firstElementChild as HTMLElement;
    // zIndex is applied via inline style
    expect(root.style.zIndex).toBe('-1');
  });

  it('applies selected ring style when selected', () => {
    const { container } = renderGroupNode({ selected: true });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('ring-2');
  });

  it('renders label at the top of the container', () => {
    renderGroupNode();
    const label = screen.getByText('My Group');
    expect(label).toBeInTheDocument();
    // The label should be inside the group-node-container
    expect(screen.getByTestId('group-node-container')).toContainElement(label);
  });

  it('applies color border for colored group', () => {
    const { container } = renderGroupNode({
      data: { label: 'Colored', color: '6' },
    });
    const root = container.firstElementChild as HTMLElement;
    // color '6' maps to #a882ff
    expect(root.style.borderColor).toBe('rgb(168, 130, 255)');
  });
});
