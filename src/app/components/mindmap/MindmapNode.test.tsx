import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MindmapNode } from './MindmapNode';

vi.mock('@xyflow/react', () => ({
  Handle: ({ type, ...props }: Record<string, unknown>) => (
    <div data-testid={`handle-${type}`} {...props} />
  ),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));

function renderHeadingNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: 'test-node',
    type: 'mindmap' as const,
    data: { content: 'Test Heading', level: 1, onEdit: vi.fn() },
    selected: false,
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<MindmapNode {...(defaultProps as any)} />);
}

function renderLeafNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: 'leaf-node',
    type: 'mindmap' as const,
    data: { content: 'This is a leaf content paragraph.', level: 7, onEdit: vi.fn() },
    selected: false,
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<MindmapNode {...(defaultProps as any)} />);
}

describe('MindmapNode – heading', () => {
  it('renders content text correctly', () => {
    renderHeadingNode();
    expect(screen.getByText('Test Heading')).toBeInTheDocument();
  });

  it('double-click activates inline edit mode with textarea', () => {
    const { container } = renderHeadingNode();
    fireEvent.doubleClick(container.firstElementChild as HTMLElement);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue('Test Heading');
  });

  it('blur commits edit and calls onEdit with new content', () => {
    const onEdit = vi.fn();
    const { container } = renderHeadingNode({ data: { content: 'Original', level: 1, onEdit } });
    fireEvent.doubleClick(container.firstElementChild as HTMLElement);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Updated' } });
    fireEvent.blur(textarea);
    expect(onEdit).toHaveBeenCalledWith('test-node', 'Updated');
  });

  it('blur without change does NOT call onEdit', () => {
    const onEdit = vi.fn();
    const { container } = renderHeadingNode({ data: { content: 'Original', level: 1, onEdit } });
    fireEvent.doubleClick(container.firstElementChild as HTMLElement);
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('Escape cancels edit without calling onEdit', () => {
    const onEdit = vi.fn();
    const { container } = renderHeadingNode({ data: { content: 'Original', level: 1, onEdit } });
    fireEvent.doubleClick(container.firstElementChild as HTMLElement);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Changed' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('Enter key commits edit', () => {
    const onEdit = vi.fn();
    const { container } = renderHeadingNode({ data: { content: 'Original', level: 1, onEdit } });
    fireEvent.doubleClick(container.firstElementChild as HTMLElement);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Enter Edit' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('test-node', 'Enter Edit');
  });

  it('applies purple border class for level 1', () => {
    const { container } = renderHeadingNode({
      data: { content: 'Level 1', level: 1, onEdit: vi.fn() },
    });
    expect(container.firstElementChild!.className).toContain('border-l-purple-500');
  });

  it('has target and source handles', () => {
    renderHeadingNode();
    expect(screen.getByTestId('handle-target')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source')).toBeInTheDocument();
  });
});

describe('MindmapNode – leaf', () => {
  it('renders leaf content text as preview', () => {
    renderLeafNode();
    expect(screen.getByText('This is a leaf content paragraph.')).toBeInTheDocument();
  });

  it('has target and source handles', () => {
    renderLeafNode();
    expect(screen.getByTestId('handle-target')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source')).toBeInTheDocument();
  });

  it('click opens modal with full content in textarea', () => {
    renderLeafNode();
    fireEvent.click(screen.getByTestId('leaf-node'));
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue('This is a leaf content paragraph.');
  });

  it('modal Save calls onEdit and closes modal', () => {
    const onEdit = vi.fn();
    renderLeafNode({ data: { content: 'Original leaf', level: 7, onEdit } });
    fireEvent.click(screen.getByTestId('leaf-node'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Updated leaf' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onEdit).toHaveBeenCalledWith('leaf-node', 'Updated leaf');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('modal Save with unchanged content does NOT call onEdit', () => {
    const onEdit = vi.fn();
    renderLeafNode({ data: { content: 'Same', level: 7, onEdit } });
    fireEvent.click(screen.getByTestId('leaf-node'));
    fireEvent.click(screen.getByText('Save'));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('modal Cancel closes without calling onEdit', () => {
    const onEdit = vi.fn();
    renderLeafNode({ data: { content: 'Original leaf', level: 7, onEdit } });
    fireEvent.click(screen.getByTestId('leaf-node'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('modal ✕ button closes without calling onEdit', () => {
    const onEdit = vi.fn();
    renderLeafNode({ data: { content: 'Text', level: 7, onEdit } });
    fireEvent.click(screen.getByTestId('leaf-node'));
    fireEvent.click(screen.getByText('✕'));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
