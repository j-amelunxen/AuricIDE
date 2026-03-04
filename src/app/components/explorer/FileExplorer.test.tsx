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

  it('does not make non-markdown files draggable', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const tsButton = screen.getByTestId('tree-item-/src/main.ts');
    expect(tsButton).not.toHaveAttribute('draggable');
  });

  it('does not make directories draggable', () => {
    render(
      <FileExplorer
        tree={mockTree}
        selectedPath={null}
        onSelectFile={() => {}}
        onToggleDir={() => {}}
      />
    );
    const dirButton = screen.getByTestId('tree-item-/src');
    expect(dirButton).not.toHaveAttribute('draggable');
  });

  it('sets dataTransfer with file path on dragStart for .md files', () => {
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

    expect(setData).toHaveBeenCalledWith('text/plain', '/README.md');
    expect(dataTransfer.effectAllowed).toBe('copy');
  });
});
