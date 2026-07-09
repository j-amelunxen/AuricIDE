import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileExplorer, type FileTreeNode } from './FileExplorer';

const mockTree: FileTreeNode[] = [
  {
    name: 'src',
    path: '/src',
    isDirectory: true,
    expanded: true,
    gitStatus: 'modified',
    children: [
      { name: 'main.ts', path: '/src/main.ts', isDirectory: false },
      { name: 'utils.ts', path: '/src/utils.ts', isDirectory: false, gitStatus: 'added' },
    ],
  },
  { name: 'README.md', path: '/README.md', isDirectory: false, gitStatus: 'modified' },
];

describe('FileExplorer', () => {
  it('renders the file tree', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('shows children of expanded directories', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    expect(screen.getByText('main.ts')).toBeInTheDocument();
    expect(screen.getByText('utils.ts')).toBeInTheDocument();
  });

  it('calls onSelectFile when a file is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={onSelect}
        onToggleDir={() => {}}
      />
    );

    await user.click(screen.getByText('README.md'));
    expect(onSelect).toHaveBeenCalledWith('/README.md');
  });

  it('calls onToggleDir when a directory is clicked', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={onToggle}
      />
    );

    await user.click(screen.getByText('src'));
    expect(onToggle).toHaveBeenCalledWith('/src');
  });

  it('shows git status badges', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    expect(screen.getByTestId('git-badge-/src/utils.ts')).toHaveTextContent('A');
    expect(screen.getByTestId('git-badge-/README.md')).toHaveTextContent('M');
  });

  it('dims git badge on directories', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const dirBadge = screen.getByTestId('git-badge-/src');
    const fileBadge = screen.getByTestId('git-badge-/src/utils.ts');

    expect(dirBadge).toHaveClass('opacity-50');
    expect(fileBadge).not.toHaveClass('opacity-50');
  });

  it('highlights selected file', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath="/README.md"
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    expect(screen.getByTestId('tree-item-/README.md')).toHaveClass('bg-primary/10');
  });

  it('makes .md files draggable', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const mdButton = screen.getByTestId('tree-item-/README.md');
    expect(mdButton).toHaveAttribute('draggable', 'true');
  });

  it('makes non-markdown files draggable so they can be moved', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const tsButton = screen.getByTestId('tree-item-/src/main.ts');
    expect(tsButton).toHaveAttribute('draggable', 'true');
  });

  it('makes directories draggable so they can be moved', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const dirButton = screen.getByTestId('tree-item-/src');
    expect(dirButton).toHaveAttribute('draggable', 'true');
  });

  it('exposes toolbar controls by accessible labels', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: 'Open Folder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('hides icon glyphs from assistive technology', () => {
    const { container } = render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const icons = container.querySelectorAll('.material-symbols-outlined');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  });

  it('sets both the editor-embed and move payloads on dragStart for .md files', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const mdButton = screen.getByTestId('tree-item-/README.md');
    const setData = vi.fn();
    const dataTransfer = { setData, effectAllowed: '' };
    const event = new Event('dragstart', { bubbles: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    mdButton.dispatchEvent(event);

    // Editor embed payload preserved…
    expect(setData).toHaveBeenCalledWith('text/plain', '/README.md');
    // …plus the explorer-internal move payload.
    expect(setData).toHaveBeenCalledWith('application/x-auric-move', '/README.md');
    expect(dataTransfer.effectAllowed).toBe('copyMove');
  });

  it('sets the move payload on dragStart for non-markdown files', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const tsButton = screen.getByTestId('tree-item-/src/main.ts');
    const setData = vi.fn();
    const dataTransfer = { setData, effectAllowed: '' };
    const event = new Event('dragstart', { bubbles: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    tsButton.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith('application/x-auric-move', '/src/main.ts');
    expect(dataTransfer.effectAllowed).toBe('move');
  });

  it('calls onMoveNode when a file is dropped onto a folder', () => {
    const onMoveNode = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onMoveNode={onMoveNode}
      />
    );
    const folder = screen.getByTestId('tree-item-/src');
    const dataTransfer = {
      types: ['application/x-auric-move'],
      getData: (t: string) => (t === 'application/x-auric-move' ? '/README.md' : ''),
      dropEffect: '',
    };
    const event = new Event('drop', { bubbles: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    folder.dispatchEvent(event);

    expect(onMoveNode).toHaveBeenCalledWith('/README.md', '/src');
  });

  it('does not call onMoveNode when a folder is dropped onto itself', () => {
    const onMoveNode = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onMoveNode={onMoveNode}
      />
    );
    const folder = screen.getByTestId('tree-item-/src');
    const dataTransfer = {
      types: ['application/x-auric-move'],
      getData: (t: string) => (t === 'application/x-auric-move' ? '/src' : ''),
      dropEffect: '',
    };
    const event = new Event('drop', { bubbles: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    folder.dispatchEvent(event);

    expect(onMoveNode).not.toHaveBeenCalled();
  });

  it('allows the drop by preventing default on dragOver over a folder (WebKit-safe)', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onMoveNode={() => {}}
      />
    );
    const folder = screen.getByTestId('tree-item-/src');
    // WebKit doesn't expose custom MIME types in `types` during dragover, so the
    // handler must preventDefault regardless — otherwise the browser rejects the drop.
    let defaultPrevented = false;
    const dataTransfer = { types: [] as string[], dropEffect: '' };
    const event = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    Object.defineProperty(event, 'preventDefault', {
      value: () => {
        defaultPrevented = true;
      },
    });
    folder.dispatchEvent(event);
    expect(defaultPrevented).toBe(true);
  });

  it('allows the drop by preventing default on dragOver over the root dropzone', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onMoveNode={() => {}}
        rootPath="/"
      />
    );
    const zone = screen.getByTestId('file-explorer-root-dropzone');
    let defaultPrevented = false;
    const dataTransfer = { types: [] as string[], dropEffect: '' };
    const event = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    Object.defineProperty(event, 'preventDefault', {
      value: () => {
        defaultPrevented = true;
      },
    });
    zone.dispatchEvent(event);
    expect(defaultPrevented).toBe(true);
  });

  it('does not call onMoveNode when a file is dropped onto the folder it already lives in', () => {
    const onMoveNode = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onMoveNode={onMoveNode}
      />
    );
    // main.ts already lives in /src — dropping it back onto /src is a no-op.
    const folder = screen.getByTestId('tree-item-/src');
    const dataTransfer = {
      types: ['application/x-auric-move'],
      getData: (t: string) => (t === 'application/x-auric-move' ? '/src/main.ts' : ''),
      dropEffect: '',
    };
    const event = new Event('drop', { bubbles: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    folder.dispatchEvent(event);

    expect(onMoveNode).not.toHaveBeenCalled();
  });
});
