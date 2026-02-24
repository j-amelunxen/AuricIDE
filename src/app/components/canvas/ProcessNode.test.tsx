import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProcessNode } from './ProcessNode';

vi.mock('@xyflow/react', () => ({
  Handle: ({ type, ...props }: Record<string, unknown>) => (
    <div data-testid={`handle-${type}`} {...props} />
  ),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));

function renderProcessNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: 'test-node',
    type: 'process' as const,
    data: {
      title: 'Test Node',
      description: 'A test node description.',
      nodeType: 'agent' as const,
      tags: ['test', 'sample'],
    },
    selected: false,
    ...overrides,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<ProcessNode {...(defaultProps as any)} />);
}

describe('ProcessNode', () => {
  it('renders the node title', () => {
    renderProcessNode();
    expect(screen.getByText('Test Node')).toBeInTheDocument();
  });

  it('shows the correct description', () => {
    renderProcessNode();
    expect(screen.getByText('A test node description.')).toBeInTheDocument();
  });

  it('renders tags', () => {
    renderProcessNode();
    expect(screen.getByText('test')).toBeInTheDocument();
    expect(screen.getByText('sample')).toBeInTheDocument();
  });

  it('renders source and target handles for connections', () => {
    renderProcessNode();
    expect(screen.getByTestId('handle-target')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source')).toBeInTheDocument();
  });

  it('applies correct border color for trigger type', () => {
    const { container } = renderProcessNode({
      data: {
        title: 'Trigger',
        description: '',
        nodeType: 'trigger',
      },
    });
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-l-purple-500');
  });

  it('applies correct border color for agent type', () => {
    const { container } = renderProcessNode({
      data: {
        title: 'Agent',
        description: '',
        nodeType: 'agent',
      },
    });
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-l-blue-500');
  });

  it('applies correct border color for script type', () => {
    const { container } = renderProcessNode({
      data: {
        title: 'Script',
        description: '',
        nodeType: 'script',
      },
    });
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-l-orange-500');
  });

  it('applies correct border color for output type', () => {
    const { container } = renderProcessNode({
      data: {
        title: 'Output',
        description: '',
        nodeType: 'output',
      },
    });
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-l-green-500');
  });

  it('applies selected styling when selected', () => {
    const { container } = renderProcessNode({ selected: true });
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-2');
  });

  it('renders without tags when none provided', () => {
    renderProcessNode({
      data: {
        title: 'No Tags',
        description: 'Tagless.',
        nodeType: 'agent',
      },
    });
    expect(screen.getByText('No Tags')).toBeInTheDocument();
    expect(screen.getByText('Tagless.')).toBeInTheDocument();
  });
});
