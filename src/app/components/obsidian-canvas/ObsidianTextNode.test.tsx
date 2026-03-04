import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianTextNode } from './ObsidianTextNode';

vi.mock('@xyflow/react', () => ({
  Handle: ({ type, position }: { type: string; position: string }) => (
    <div data-testid={`handle-${type}-${position}`} />
  ),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
  NodeResizeControl: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="node-resize-control">{children}</div>
  ),
}));

// react-markdown and remark-gfm are ESM-only packages; the jsdom environment in
// Vitest handles them correctly without any special mock needed.

function renderTextNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: 'text-node-1',
    type: 'obsidian-text' as const,
    data: {
      text: 'Hello canvas world',
      color: undefined as string | undefined,
      onTextEdit: vi.fn(),
      onResize: vi.fn(),
    },
    selected: false,
    ...overrides,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<ObsidianTextNode {...(defaultProps as any)} />);
}

describe('ObsidianTextNode', () => {
  it('renders the text content', () => {
    renderTextNode();
    expect(screen.getByText('Hello canvas world')).toBeInTheDocument();
  });

  it('shows "(empty)" when text is blank', () => {
    renderTextNode({
      data: { text: '', color: undefined, onTextEdit: vi.fn(), onResize: vi.fn() },
    });
    expect(screen.getByText('(empty)')).toBeInTheDocument();
  });

  it('renders all four handles', () => {
    renderTextNode();
    expect(screen.getByTestId('handle-target-top')).toBeInTheDocument();
    expect(screen.getByTestId('handle-target-left')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source-right')).toBeInTheDocument();
  });

  it('enters edit mode on double-click', () => {
    renderTextNode();
    const textEl = screen.getByText('Hello canvas world');
    fireEvent.dblClick(textEl.closest('[data-testid="text-node-content"]') ?? textEl);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('commits edit on blur', () => {
    const onTextEdit = vi.fn();
    renderTextNode({
      data: { text: 'Original', color: undefined, onTextEdit, onResize: vi.fn() },
    });
    const content = screen.getByTestId('text-node-content');
    fireEvent.dblClick(content);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Updated text' } });
    fireEvent.blur(textarea);
    expect(onTextEdit).toHaveBeenCalledWith('text-node-1', 'Updated text');
  });

  it('cancels edit on Escape', () => {
    const onTextEdit = vi.fn();
    renderTextNode({
      data: { text: 'Original', color: undefined, onTextEdit, onResize: vi.fn() },
    });
    const content = screen.getByTestId('text-node-content');
    fireEvent.dblClick(content);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Typed but cancelled' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onTextEdit).not.toHaveBeenCalled();
    expect(screen.getByText('Original')).toBeInTheDocument();
  });

  it('commits edit on Cmd+Enter', () => {
    const onTextEdit = vi.fn();
    renderTextNode({
      data: { text: 'Original', color: undefined, onTextEdit, onResize: vi.fn() },
    });
    const content = screen.getByTestId('text-node-content');
    fireEvent.dblClick(content);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Cmd saved' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onTextEdit).toHaveBeenCalledWith('text-node-1', 'Cmd saved');
  });

  it('commits edit on Ctrl+Enter', () => {
    const onTextEdit = vi.fn();
    renderTextNode({
      data: { text: 'Original', color: undefined, onTextEdit, onResize: vi.fn() },
    });
    const content = screen.getByTestId('text-node-content');
    fireEvent.dblClick(content);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Ctrl saved' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onTextEdit).toHaveBeenCalledWith('text-node-1', 'Ctrl saved');
  });

  it('does not call onTextEdit when text is unchanged', () => {
    const onTextEdit = vi.fn();
    renderTextNode({
      data: { text: 'Same text', color: undefined, onTextEdit, onResize: vi.fn() },
    });
    const content = screen.getByTestId('text-node-content');
    fireEvent.dblClick(content);
    const textarea = screen.getByRole('textbox');
    fireEvent.blur(textarea);
    expect(onTextEdit).not.toHaveBeenCalled();
  });

  it('applies selected ring style when selected', () => {
    const { container } = renderTextNode({ selected: true });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('ring-2');
  });

  describe('markdown rendering in view mode', () => {
    it('renders a markdown heading as an h1 element', () => {
      renderTextNode({
        data: { text: '# My Heading', color: undefined, onTextEdit: vi.fn(), onResize: vi.fn() },
      });
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toBeInTheDocument();
      expect(heading.textContent).toBe('My Heading');
    });

    it('renders a markdown h2 heading as an h2 element', () => {
      renderTextNode({
        data: {
          text: '## Sub Heading',
          color: undefined,
          onTextEdit: vi.fn(),
          onResize: vi.fn(),
        },
      });
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toBeInTheDocument();
      expect(heading.textContent).toBe('Sub Heading');
    });

    it('renders a markdown list item as an li element', () => {
      renderTextNode({
        data: {
          text: '- first item\n- second item',
          color: undefined,
          onTextEdit: vi.fn(),
          onResize: vi.fn(),
        },
      });
      const items = screen.getAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(items[0].textContent).toBe('first item');
      expect(items[1].textContent).toBe('second item');
    });

    it('renders **bold** text as a strong element', () => {
      renderTextNode({
        data: {
          text: '**bold text**',
          color: undefined,
          onTextEdit: vi.fn(),
          onResize: vi.fn(),
        },
      });
      const strong = screen.getByText('bold text').closest('strong');
      expect(strong).toBeInTheDocument();
    });

    it('renders *italic* text as an em element', () => {
      renderTextNode({
        data: {
          text: '*italic text*',
          color: undefined,
          onTextEdit: vi.fn(),
          onResize: vi.fn(),
        },
      });
      const em = screen.getByText('italic text').closest('em');
      expect(em).toBeInTheDocument();
    });

    it('does not enter edit mode on double-click of rendered markdown heading', () => {
      renderTextNode({
        data: { text: '# Heading', color: undefined, onTextEdit: vi.fn(), onResize: vi.fn() },
      });
      const heading = screen.getByRole('heading', { level: 1 });
      fireEvent.dblClick(heading.closest('[data-testid="text-node-content"]') ?? heading);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
  });
});
