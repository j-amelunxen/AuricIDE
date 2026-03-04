import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ObsidianFileNode } from './ObsidianFileNode';

vi.mock('@xyflow/react', () => ({
  Handle: ({ type, position }: { type: string; position: string }) => (
    <div data-testid={`handle-${type}-${position}`} />
  ),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="react-markdown">{children}</div>
  ),
}));

vi.mock('remark-gfm', () => ({ default: () => {} }));

function renderFileNode(overrides: Record<string, unknown> = {}) {
  const defaultProps = {
    id: 'file-node-1',
    type: 'obsidian-file' as const,
    data: {
      file: 'notes/my-document.md',
      color: undefined as string | undefined,
      onFileOpen: vi.fn(),
      loadFileContent: undefined as ((path: string) => Promise<string>) | undefined,
    },
    selected: false,
    ...overrides,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<ObsidianFileNode {...(defaultProps as any)} />);
}

describe('ObsidianFileNode', () => {
  it('renders the file basename', () => {
    renderFileNode();
    expect(screen.getByText('my-document.md')).toBeInTheDocument();
  });

  it('renders the full file path as subtitle', () => {
    renderFileNode();
    expect(screen.getByText('notes/my-document.md')).toBeInTheDocument();
  });

  it('renders all four handles', () => {
    renderFileNode();
    expect(screen.getByTestId('handle-target-top')).toBeInTheDocument();
    expect(screen.getByTestId('handle-target-left')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source-right')).toBeInTheDocument();
  });

  it('renders a file icon', () => {
    renderFileNode();
    expect(screen.getByTestId('file-icon')).toBeInTheDocument();
  });

  it('calls onFileOpen with file path on double-click', () => {
    const onFileOpen = vi.fn();
    renderFileNode({ data: { file: 'vault/note.md', color: undefined, onFileOpen } });
    const node = screen.getByTestId('file-node-card');
    fireEvent.dblClick(node);
    expect(onFileOpen).toHaveBeenCalledWith('vault/note.md');
  });

  it('does not throw when onFileOpen is not provided', () => {
    renderFileNode({ data: { file: 'vault/note.md', color: undefined, onFileOpen: undefined } });
    const node = screen.getByTestId('file-node-card');
    expect(() => fireEvent.dblClick(node)).not.toThrow();
  });

  it('applies selected ring style when selected', () => {
    const { container } = renderFileNode({ selected: true });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('ring-2');
  });

  it('shows just the filename when path has no directory', () => {
    renderFileNode({ data: { file: 'standalone.md', color: undefined, onFileOpen: vi.fn() } });
    // When there is no directory, basename equals the full path — both title and subtitle show it
    const matches = screen.getAllByText('standalone.md');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  // --- Markdown Preview Tests ---

  it('shows loading state when loadFileContent is provided', () => {
    const loadFileContent = vi.fn(() => new Promise<string>(() => {})); // never resolves
    renderFileNode({
      data: {
        file: 'notes/doc.md',
        color: undefined,
        onFileOpen: vi.fn(),
        loadFileContent,
      },
    });
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders markdown content after loadFileContent resolves', async () => {
    const loadFileContent = vi.fn().mockResolvedValue('# Hello World');
    renderFileNode({
      data: {
        file: 'notes/doc.md',
        color: undefined,
        onFileOpen: vi.fn(),
        loadFileContent,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('react-markdown')).toBeInTheDocument();
    });
    expect(screen.getByTestId('react-markdown')).toHaveTextContent('# Hello World');
    expect(loadFileContent).toHaveBeenCalledWith('notes/doc.md');
  });

  it('shows error state when loadFileContent rejects', async () => {
    const loadFileContent = vi.fn().mockRejectedValue(new Error('Not found'));
    renderFileNode({
      data: {
        file: 'notes/missing.md',
        color: undefined,
        onFileOpen: vi.fn(),
        loadFileContent,
      },
    });

    await waitFor(() => {
      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });
  });

  it('does not show loading when loadFileContent is not provided', () => {
    renderFileNode();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });
});
