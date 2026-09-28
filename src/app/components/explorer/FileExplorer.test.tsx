import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileExplorer, flattenVisibleTree, type FileTreeNode } from './FileExplorer';

// Every file row asks for its icon exactly once per render, so counting the
// calls by name counts row renders without touching the component.
const iconLookups = vi.hoisted(() => new Map<string, number>());
vi.mock('./fileTreeIcons', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fileTreeIcons')>();
  return {
    ...actual,
    getFileIcon: (name: string) => {
      iconLookups.set(name, (iconLookups.get(name) ?? 0) + 1);
      return actual.getFileIcon(name);
    },
  };
});

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
    const icons = container.querySelectorAll('[data-icon]');
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

describe('flattenVisibleTree', () => {
  it('excludes children of collapsed directories', () => {
    const flat = flattenVisibleTree(mockTree);
    // src is expanded in mockTree, so its children are visible.
    expect(flat.map((f) => f.path)).toEqual([
      '/src',
      '/src/main.ts',
      '/src/utils.ts',
      '/README.md',
    ]);
  });

  it('omits a collapsed directory’s children entirely', () => {
    const collapsedTree: FileTreeNode[] = [{ ...mockTree[0], expanded: false }, mockTree[1]];
    const flat = flattenVisibleTree(collapsedTree);
    expect(flat.map((f) => f.path)).toEqual(['/src', '/README.md']);
  });
});

describe('FileExplorer — root-area context menu', () => {
  it('calls onRootContextMenu when right-clicking the empty area', () => {
    const onRootContextMenu = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onRootContextMenu={onRootContextMenu}
      />
    );
    const zone = screen.getByTestId('file-explorer-root-dropzone');
    const event = new Event('contextmenu', { bubbles: true, cancelable: true });
    zone.dispatchEvent(event);
    expect(onRootContextMenu).toHaveBeenCalledTimes(1);
  });

  it('does not bubble a row right-click into the root context menu', () => {
    const onRootContextMenu = vi.fn();
    const onContextMenu = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onRootContextMenu={onRootContextMenu}
        onContextMenu={onContextMenu}
      />
    );
    const row = screen.getByTestId('tree-item-/README.md');
    const event = new Event('contextmenu', { bubbles: true, cancelable: true });
    row.dispatchEvent(event);
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onRootContextMenu).not.toHaveBeenCalled();
  });
});

describe('FileExplorer — multi-select', () => {
  it('highlights every path in selectedPaths', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath="/src/main.ts"
        selectedPaths={['/src/main.ts', '/README.md']}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    expect(screen.getByTestId('tree-item-/src/main.ts')).toHaveClass('bg-primary/10');
    expect(screen.getByTestId('tree-item-/README.md')).toHaveClass('bg-primary/10');
    expect(screen.getByTestId('tree-item-/src/utils.ts')).not.toHaveClass('bg-primary/10');
  });

  it('marks only the primary selection with the left accent border', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath="/src/main.ts"
        selectedPaths={['/src/main.ts', '/README.md']}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    expect(screen.getByTestId('tree-item-/src/main.ts')).toHaveClass('border-l-2');
    expect(screen.getByTestId('tree-item-/README.md')).not.toHaveClass('border-l-2');
  });

  it('calls onToggleSelect on cmd/ctrl-click instead of onSelectFile', () => {
    const onSelectFile = vi.fn();
    const onToggleSelect = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={onSelectFile}
        onToggleDir={() => {}}
        onToggleSelect={onToggleSelect}
      />
    );
    fireEvent.click(screen.getByTestId('tree-item-/README.md'), { metaKey: true });
    expect(onToggleSelect).toHaveBeenCalledWith('/README.md');
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it('calls onRangeSelect with the resolved range on shift-click', () => {
    const onRangeSelect = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath="/src/main.ts"
        selectionAnchor="/src/main.ts"
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onRangeSelect={onRangeSelect}
      />
    );
    fireEvent.click(screen.getByTestId('tree-item-/README.md'), { shiftKey: true });
    // Anchor is /src/main.ts, target is /README.md — everything between in
    // visible order: main.ts, utils.ts, README.md.
    expect(onRangeSelect).toHaveBeenCalledWith(
      ['/src/main.ts', '/src/utils.ts', '/README.md'],
      '/README.md'
    );
  });
});

describe('FileExplorer — keyboard navigation', () => {
  it('ArrowDown moves focus to the next visible row via onFocusNode', async () => {
    const onFocusNode = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath="/src"
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onFocusNode={onFocusNode}
      />
    );
    screen.getByTestId('tree-item-/src').focus();
    const user = userEvent.setup();
    await user.keyboard('{ArrowDown}');
    expect(onFocusNode).toHaveBeenCalledWith('/src/main.ts');
  });

  it('ArrowUp moves focus to the previous visible row', async () => {
    const onFocusNode = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath="/src/utils.ts"
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onFocusNode={onFocusNode}
      />
    );
    screen.getByTestId('tree-item-/src/utils.ts').focus();
    const user = userEvent.setup();
    await user.keyboard('{ArrowUp}');
    expect(onFocusNode).toHaveBeenCalledWith('/src/main.ts');
  });

  it('Enter opens the selected file', async () => {
    const onSelectFile = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath="/README.md"
        onSelectFile={onSelectFile}
        onToggleDir={() => {}}
      />
    );
    screen.getByTestId('tree-item-/README.md').focus();
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    expect(onSelectFile).toHaveBeenCalledWith('/README.md');
  });

  it('Enter toggles a directory instead of opening it', async () => {
    const onToggleDir = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath="/src"
        onSelectFile={() => {}}
        onToggleDir={onToggleDir}
      />
    );
    screen.getByTestId('tree-item-/src').focus();
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    expect(onToggleDir).toHaveBeenCalledWith('/src');
  });

  it('F2 requests rename for the focused node', async () => {
    const onRenameRequest = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath="/README.md"
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onRenameRequest={onRenameRequest}
      />
    );
    screen.getByTestId('tree-item-/README.md').focus();
    const user = userEvent.setup();
    await user.keyboard('{F2}');
    expect(onRenameRequest).toHaveBeenCalledWith(expect.objectContaining({ path: '/README.md' }));
  });

  it('Delete requests deletion of the whole multi-selection', async () => {
    const onDeleteSelection = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath="/README.md"
        selectedPaths={['/README.md', '/src/main.ts']}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onDeleteSelection={onDeleteSelection}
      />
    );
    screen.getByTestId('tree-item-/README.md').focus();
    const user = userEvent.setup();
    await user.keyboard('{Delete}');
    expect(onDeleteSelection).toHaveBeenCalledWith(['/README.md', '/src/main.ts']);
  });

  it('Escape clears a multi-selection', async () => {
    const onClearSelection = vi.fn();
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath="/README.md"
        selectedPaths={['/README.md', '/src/main.ts']}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onClearSelection={onClearSelection}
      />
    );
    screen.getByTestId('tree-item-/README.md').focus();
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });
});

describe('FileExplorer — drag-and-drop polish', () => {
  it('dims the row currently being dragged', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onMoveNode={() => {}}
      />
    );
    const mdButton = screen.getByTestId('tree-item-/README.md');
    fireEvent.dragStart(mdButton, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });

    expect(mdButton).toHaveClass('opacity-40');
  });

  it('shows an invalid-drop indicator and dropEffect "none" for an illegal move', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onMoveNode={() => {}}
      />
    );
    // Start dragging /src itself, then drag it over itself — an illegal move.
    const srcButton = screen.getByTestId('tree-item-/src');
    fireEvent.dragStart(srcButton, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });

    const overData = { types: [] as string[], dropEffect: '' };
    fireEvent.dragOver(srcButton, { dataTransfer: overData });

    expect(srcButton).toHaveClass('cursor-not-allowed');
    expect(overData.dropEffect).toBe('none');
  });

  it('shows a valid-drop indicator and dropEffect "move" for a legal move', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
        onMoveNode={() => {}}
      />
    );
    const mdButton = screen.getByTestId('tree-item-/README.md');
    fireEvent.dragStart(mdButton, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });

    const srcButton = screen.getByTestId('tree-item-/src');
    const overData = { types: [] as string[], dropEffect: '' };
    fireEvent.dragOver(srcButton, { dataTransfer: overData });

    expect(srcButton).toHaveClass('ring-primary/60');
    expect(overData.dropEffect).toBe('move');
  });
});

describe('FileExplorer — recently created glow', () => {
  const now = 1_700_000_000_000;
  const recentTree: FileTreeNode[] = [
    {
      name: 'fresh.ts',
      path: '/fresh.ts',
      isDirectory: false,
      createdAt: now - 30_000,
    },
    {
      name: 'old.ts',
      path: '/old.ts',
      isDirectory: false,
      createdAt: now - 6 * 60 * 1000,
    },
    {
      name: 'plain.ts',
      path: '/plain.ts',
      isDirectory: false,
    },
    {
      name: 'new-folder',
      path: '/new-folder',
      isDirectory: true,
      createdAt: now - 10_000,
    },
  ];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('glows a file created in the last 5 minutes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(
      <FileExplorer
        tree={recentTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const fresh = screen.getByTestId('tree-item-/fresh.ts');
    expect(fresh).toHaveAttribute('data-recently-created', 'true');
    expect(fresh).toHaveClass('explorer-recent-glow');
  });

  it('does not glow an older file, a file without createdAt, or an empty folder', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(
      <FileExplorer
        tree={recentTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    expect(screen.getByTestId('tree-item-/old.ts')).not.toHaveAttribute('data-recently-created');
    expect(screen.getByTestId('tree-item-/plain.ts')).not.toHaveAttribute('data-recently-created');
    expect(screen.getByTestId('tree-item-/new-folder')).not.toHaveAttribute(
      'data-recently-created'
    );
    expect(screen.getByTestId('tree-item-/new-folder')).not.toHaveAttribute('data-contains-recent');
    expect(screen.getByTestId('tree-item-/old.ts')).not.toHaveClass('explorer-recent-glow');
  });

  it('glows folders that contain a recently created file, including ancestors', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(
      <FileExplorer
        tree={[
          {
            name: 'src',
            path: '/src',
            isDirectory: true,
            expanded: true,
            children: [
              {
                name: 'lib',
                path: '/src/lib',
                isDirectory: true,
                expanded: false,
                children: [
                  {
                    name: 'fresh.ts',
                    path: '/src/lib/fresh.ts',
                    isDirectory: false,
                    createdAt: now - 20_000,
                  },
                ],
              },
              {
                name: 'old.ts',
                path: '/src/old.ts',
                isDirectory: false,
                createdAt: now - 10 * 60 * 1000,
              },
            ],
          },
        ]}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const src = screen.getByTestId('tree-item-/src');
    const lib = screen.getByTestId('tree-item-/src/lib');
    expect(src).toHaveAttribute('data-contains-recent', 'true');
    expect(lib).toHaveAttribute('data-contains-recent', 'true');
    expect(src).toHaveClass('explorer-recent-glow-folder');
    expect(lib).toHaveClass('explorer-recent-glow-folder');
    expect(src).not.toHaveClass('explorer-recent-glow');
    expect(screen.queryByTestId('tree-item-/src/lib/fresh.ts')).not.toBeInTheDocument();
  });

  it('glows a file that appears long after mount, measured against the current clock', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const props = {
      selectedPath: null,
      onSelectFile: () => {},
      onToggleDir: () => {},
    };
    const { rerender } = render(
      <FileExplorer
        tree={[
          { name: 'old.ts', path: '/old.ts', isDirectory: false, createdAt: now - 6 * 60 * 1000 },
        ]}
        {...props}
      />
    );

    // Half an hour of the session goes by, then the watcher hands over a tree
    // containing a file born seconds ago.
    const later = now + 30 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    rerender(
      <FileExplorer
        tree={[
          { name: 'old.ts', path: '/old.ts', isDirectory: false, createdAt: now - 6 * 60 * 1000 },
          { name: 'fresh.ts', path: '/fresh.ts', isDirectory: false, createdAt: later - 5_000 },
          {
            name: 'src',
            path: '/src',
            isDirectory: true,
            expanded: false,
            children: [],
            newestFileCreatedAt: later - 5_000,
          },
        ]}
        {...props}
      />
    );

    const fresh = screen.getByTestId('tree-item-/fresh.ts');
    expect(fresh).toHaveAttribute('data-recently-created', 'true');
    expect(fresh).toHaveClass('explorer-recent-glow');
    expect(screen.getByTestId('tree-item-/src')).toHaveAttribute('data-contains-recent', 'true');
  });

  it('glows a collapsed folder from newestFileCreatedAt when children are not loaded', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(
      <FileExplorer
        tree={[
          {
            name: 'src',
            path: '/src',
            isDirectory: true,
            expanded: false,
            children: [],
            newestFileCreatedAt: now - 10_000,
          },
        ]}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const src = screen.getByTestId('tree-item-/src');
    expect(src).toHaveAttribute('data-contains-recent', 'true');
    expect(src).toHaveClass('explorer-recent-glow-folder');
  });

  it('glows a file modified in the last 5 minutes, in its own color', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(
      <FileExplorer
        tree={[
          { name: 'touched.ts', path: '/touched.ts', isDirectory: false, modifiedAt: now - 30_000 },
        ]}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const touched = screen.getByTestId('tree-item-/touched.ts');
    expect(touched).toHaveAttribute('data-recently-modified', 'true');
    expect(touched).toHaveClass('explorer-recent-glow-modified');
    expect(touched).not.toHaveClass('explorer-recent-glow');
  });

  it('does not glow a folder for a recently modified descendant — modified never rolls up', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(
      <FileExplorer
        tree={[
          {
            name: 'src',
            path: '/src',
            isDirectory: true,
            expanded: true,
            children: [
              {
                name: 'touched.ts',
                path: '/src/touched.ts',
                isDirectory: false,
                modifiedAt: now - 5_000,
              },
            ],
          },
        ]}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const src = screen.getByTestId('tree-item-/src');
    expect(src).not.toHaveAttribute('data-contains-recent');
    expect(src).not.toHaveClass('explorer-recent-glow-folder');
    expect(src).not.toHaveClass('explorer-recent-glow-modified');
  });

  it('prefers the created glow over the modified glow when a file is both', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(
      <FileExplorer
        tree={[
          {
            name: 'both.ts',
            path: '/both.ts',
            isDirectory: false,
            createdAt: now - 10_000,
            modifiedAt: now - 10_000,
          },
        ]}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const both = screen.getByTestId('tree-item-/both.ts');
    expect(both).toHaveClass('explorer-recent-glow');
    expect(both).not.toHaveClass('explorer-recent-glow-modified');
  });

  it('does not glow a file modified more than 5 minutes ago', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(
      <FileExplorer
        tree={[
          {
            name: 'stale.ts',
            path: '/stale.ts',
            isDirectory: false,
            modifiedAt: now - 6 * 60 * 1000,
          },
        ]}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    expect(screen.getByTestId('tree-item-/stale.ts')).not.toHaveAttribute('data-recently-modified');
  });
});

describe('FileExplorer — row re-renders', () => {
  const noop = () => {};

  it('a tree update re-renders the rows whose node changed, not their unchanged siblings', () => {
    const untouched: FileTreeNode = {
      name: 'untouched.ts',
      path: '/untouched.ts',
      isDirectory: false,
    };
    const before: FileTreeNode = { name: 'changing.ts', path: '/changing.ts', isDirectory: false };
    const { rerender } = render(
      <FileExplorer
        tree={[untouched, before]}
        selectedPath={null}
        onSelectFile={noop}
        onToggleDir={noop}
      />
    );
    iconLookups.clear();

    // What a watcher refresh does: a new node for the changed file, the rest
    // carried over by reference.
    rerender(
      <FileExplorer
        tree={[untouched, { ...before, gitStatus: 'modified' }]}
        selectedPath={null}
        onSelectFile={noop}
        onToggleDir={noop}
      />
    );

    expect(iconLookups.get('changing.ts')).toBe(1);
    expect(iconLookups.get('untouched.ts')).toBeUndefined();
  });
});

describe('FileExplorer — windowed rows', () => {
  // jsdom lays nothing out, so the explorer falls back to the window height
  // (768px) for its viewport: with 20px rows that is ~40 rows plus overscan.
  const FILES = 3000;
  const bigTree = (): FileTreeNode[] => [
    {
      name: 'big',
      path: '/big',
      isDirectory: true,
      expanded: true,
      children: Array.from({ length: FILES }, (_, i) => ({
        name: `f${i}.ts`,
        path: `/big/f${i}.ts`,
        isDirectory: false,
      })),
    },
  ];
  const noop = () => {};
  const mountedRows = () => document.querySelectorAll('[data-testid^="tree-item-"]');
  const scrollTo = (top: number) => {
    const pane = screen.getByTestId('file-explorer-root-dropzone');
    act(() => {
      pane.scrollTop = top;
      fireEvent.scroll(pane);
    });
  };

  it('mounts a window of rows, not the whole expanded tree', () => {
    render(
      <FileExplorer tree={bigTree()} selectedPath={null} onSelectFile={noop} onToggleDir={noop} />
    );

    expect(mountedRows().length).toBeGreaterThan(30);
    expect(mountedRows().length).toBeLessThan(100);
    expect(screen.getByTestId('tree-item-/big/f0.ts')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-item-/big/f2999.ts')).toBeNull();
  });

  it('keeps the scroll height of the full list', () => {
    render(
      <FileExplorer tree={bigTree()} selectedPath={null} onSelectFile={noop} onToggleDir={noop} />
    );
    const pane = screen.getByTestId('file-explorer-root-dropzone');

    const rowPx = 20;
    const gapPx = [...pane.children].reduce(
      (sum, el) => sum + (parseFloat((el as HTMLElement).style.height) || 0),
      0
    );
    expect(gapPx + mountedRows().length * rowPx).toBe((FILES + 1) * rowPx);
  });

  it('re-measures the row height when a row resizes without a tree change (zoom, font)', () => {
    // A stand-in ResizeObserver that lets the test play the browser's part.
    const observers: Array<{ cb: ResizeObserverCallback; targets: Set<Element> }> = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      private entry: { cb: ResizeObserverCallback; targets: Set<Element> };
      constructor(cb: ResizeObserverCallback) {
        this.entry = { cb, targets: new Set() };
        observers.push(this.entry);
      }
      observe(el: Element) {
        this.entry.targets.add(el);
      }
      unobserve(el: Element) {
        this.entry.targets.delete(el);
      }
      disconnect() {
        this.entry.targets.clear();
      }
    } as unknown as typeof ResizeObserver;
    try {
      render(
        <FileExplorer tree={bigTree()} selectedPath={null} onSelectFile={noop} onToggleDir={noop} />
      );
      const observed = observers.find((o) =>
        [...o.targets].some((t) => t.getAttribute('data-testid')?.startsWith('tree-item-'))
      );
      expect(observed, 'no mounted row is observed').toBeDefined();
      const row = [...observed!.targets][0];

      act(() =>
        observed!.cb(
          [{ target: row, borderBoxSize: [{ blockSize: 30, inlineSize: 200 }] } as never],
          {} as ResizeObserver
        )
      );

      const pane = screen.getByTestId('file-explorer-root-dropzone');
      const gapPx = [...pane.children].reduce(
        (sum, el) => sum + (parseFloat((el as HTMLElement).style.height) || 0),
        0
      );
      expect(gapPx + mountedRows().length * 30).toBe((FILES + 1) * 30);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it('mounts the rows at the scroll position', () => {
    render(
      <FileExplorer tree={bigTree()} selectedPath={null} onSelectFile={noop} onToggleDir={noop} />
    );

    scrollTo(2000 * 20);

    expect(screen.getByTestId('tree-item-/big/f2000.ts')).toBeInTheDocument();
    expect(screen.queryByTestId('tree-item-/big/f0.ts')).toBeNull();
  });

  it('ArrowDown past the window edge focuses the next row', async () => {
    const tree = bigTree();
    const { rerender } = render(
      <FileExplorer tree={tree} selectedPath="/big/f0.ts" onSelectFile={noop} onToggleDir={noop} />
    );
    const lastMounted = [...mountedRows()].at(-1)!;
    const lastPath = lastMounted.getAttribute('data-testid')!.slice('tree-item-'.length);
    const lastIndex = Number(lastPath.match(/f(\d+)/)![1]);
    rerender(
      <FileExplorer tree={tree} selectedPath={lastPath} onSelectFile={noop} onToggleDir={noop} />
    );
    (lastMounted as HTMLElement).focus();

    await userEvent.setup().keyboard('{ArrowDown}');

    expect(document.activeElement).toBe(screen.getByTestId(`tree-item-/big/f${lastIndex + 1}.ts`));
  });

  it('ArrowLeft reaches a parent folder scrolled far out of the window', async () => {
    render(
      <FileExplorer
        tree={bigTree()}
        selectedPath="/big/f2500.ts"
        onSelectFile={noop}
        onToggleDir={noop}
      />
    );
    scrollTo(2500 * 20);
    screen.getByTestId('tree-item-/big/f2500.ts').focus();

    await userEvent.setup().keyboard('{ArrowLeft}');

    expect(document.activeElement).toBe(screen.getByTestId('tree-item-/big'));
  });

  it('Tab from the last mounted row moves to the next row, as it did with every row mounted', async () => {
    render(
      <FileExplorer tree={bigTree()} selectedPath={null} onSelectFile={noop} onToggleDir={noop} />
    );
    const lastMounted = [...mountedRows()].at(-1) as HTMLElement;
    const lastIndex = Number(lastMounted.getAttribute('data-testid')!.match(/f(\d+)/)![1]);
    lastMounted.focus();

    await userEvent.setup().keyboard('{Tab}');

    expect(document.activeElement).toBe(screen.getByTestId(`tree-item-/big/f${lastIndex + 1}.ts`));
  });

  it('moves keyboard focus between rows on Windows paths', async () => {
    const tree: FileTreeNode[] = [
      { name: 'b.ts', path: 'C:\\big\\b.ts', isDirectory: false },
      { name: 'f.ts', path: 'C:\\big\\f.ts', isDirectory: false },
    ];
    render(
      <FileExplorer
        tree={tree}
        selectedPath={tree[0].path}
        onSelectFile={noop}
        onToggleDir={noop}
      />
    );
    screen.getByTestId('tree-item-C:\\big\\b.ts').focus();

    await userEvent.setup().keyboard('{ArrowDown}');

    expect(document.activeElement).toBe(screen.getByTestId('tree-item-C:\\big\\f.ts'));
  });

  it('Tab and arrows work on file names a CSS selector cannot carry', async () => {
    const tree: FileTreeNode[] = [
      { name: 'say "hi".ts', path: '/q/say "hi".ts', isDirectory: false },
      { name: 'back\\slash.ts', path: '/q/back\\slash.ts', isDirectory: false },
      { name: 'last.ts', path: '/q/last.ts', isDirectory: false },
    ];
    render(
      <FileExplorer
        tree={tree}
        selectedPath={tree[0].path}
        onSelectFile={noop}
        onToggleDir={noop}
      />
    );
    screen.getByTestId('tree-item-/q/say "hi".ts').focus();
    const user = userEvent.setup();

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByTestId('tree-item-/q/back\\slash.ts'));

    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByTestId('tree-item-/q/last.ts'));
  });

  it('keeps the focused row mounted when it is scrolled out of view', () => {
    render(
      <FileExplorer tree={bigTree()} selectedPath={null} onSelectFile={noop} onToggleDir={noop} />
    );
    const row = screen.getByTestId('tree-item-/big/f3.ts');
    row.focus();

    scrollTo(2000 * 20);

    expect(row.isConnected).toBe(true);
    expect(document.activeElement).toBe(row);
  });

  it('keeps the dragged row mounted so its drag can end', () => {
    render(
      <FileExplorer
        tree={bigTree()}
        selectedPath={null}
        onSelectFile={noop}
        onToggleDir={noop}
        onMoveNode={noop}
      />
    );
    const row = screen.getByTestId('tree-item-/big/f3.ts');
    fireEvent.dragStart(row, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });

    scrollTo(2000 * 20);
    expect(row.isConnected).toBe(true);

    fireEvent.dragEnd(row);
    // The drag is over, so the row is no longer pinned and leaves with the
    // window; scrolled back, it is no longer dimmed.
    scrollTo(0);
    expect(screen.getByTestId('tree-item-/big/f3.ts')).not.toHaveClass('opacity-40');
  });
});
