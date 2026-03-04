import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianLinkNode } from './ObsidianLinkNode';

vi.mock('@xyflow/react', () => ({
  Handle: ({ type, position }: { type: string; position: string }) => (
    <div data-testid={`handle-${type}-${position}`} />
  ),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));

function renderLinkNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: 'link-node-1',
    type: 'obsidian-link' as const,
    data: {
      url: 'https://example.com/page',
      color: undefined as string | undefined,
    },
    selected: false,
    ...overrides,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<ObsidianLinkNode {...(defaultProps as any)} />);
}

describe('ObsidianLinkNode', () => {
  it('renders the URL', () => {
    renderLinkNode();
    expect(screen.getByText('https://example.com/page')).toBeInTheDocument();
  });

  it('renders all four handles', () => {
    renderLinkNode();
    expect(screen.getByTestId('handle-target-top')).toBeInTheDocument();
    expect(screen.getByTestId('handle-target-left')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source-right')).toBeInTheDocument();
  });

  it('renders a link icon', () => {
    renderLinkNode();
    expect(screen.getByTestId('link-icon')).toBeInTheDocument();
  });

  it('applies selected ring style when selected', () => {
    const { container } = renderLinkNode({ selected: true });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('ring-2');
  });

  it('renders color-based border for a colored node', () => {
    const { container } = renderLinkNode({
      data: { url: 'https://example.com', color: '1' },
    });
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.borderLeftColor).toBe('rgb(251, 70, 76)');
  });

  it('renders long URLs without overflow breaking layout', () => {
    renderLinkNode({
      data: {
        url: 'https://very-long-domain-name.example.com/path/to/some/resource?query=value',
        color: undefined,
      },
    });
    expect(screen.getByTestId('link-url')).toBeInTheDocument();
  });
});
