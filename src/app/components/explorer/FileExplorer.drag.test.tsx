import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileExplorer, type FileTreeNode } from './FileExplorer';
import { AUTO_EXPAND_MS } from './useTreeDrag';

const tree: FileTreeNode[] = [
  {
    name: 'src',
    path: '/p/src',
    isDirectory: true,
    expanded: true,
    children: [
      { name: 'lib', path: '/p/src/lib', isDirectory: true, expanded: false, children: [] },
      { name: 'main.ts', path: '/p/src/main.ts', isDirectory: false },
    ],
  },
  { name: 'docs', path: '/p/docs', isDirectory: true, expanded: false, children: [] },
  { name: 'a.md', path: '/p/a.md', isDirectory: false },
  { name: 'b.md', path: '/p/b.md', isDirectory: false },
];

const row = (path: string) => screen.getByTestId(`tree-item-${path}`);
const pane = () => screen.getByTestId('file-explorer-root-dropzone');

// jsdom has no layout, so the hit-test is pointed at an element by hand.
let underPointer: Element | null = null;
beforeEach(() => {
  underPointer = null;
  document.elementFromPoint = vi.fn(() => underPointer);
});
afterEach(async () => {
  vi.useRealTimers();
  // A finished drag swallows the click that follows it until the next task.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

function press(path: string, init: MouseEventInit = {}) {
  fireEvent.mouseDown(row(path), { button: 0, clientX: 10, clientY: 10, ...init });
}
function moveOver(target: Element, x = 60, y = 60) {
  underPointer = target;
  fireEvent.mouseMove(window, { clientX: x, clientY: y, buttons: 1 });
}
function release(target: Element) {
  underPointer = target;
  fireEvent.mouseUp(window, { clientX: 60, clientY: 60 });
}

function renderTree(props: Partial<React.ComponentProps<typeof FileExplorer>> = {}) {
  const handlers = {
    onSelectFile: vi.fn(),
    onToggleDir: vi.fn(),
    onMoveNodes: vi.fn(),
    onExpandDir: vi.fn(),
  };
  render(<FileExplorer tree={tree} selectedPath={null} rootPath="/p" {...handlers} {...props} />);
  return handlers;
}

describe('FileExplorer — dragging rows onto folders', () => {
  it('moves a file dropped onto a folder', () => {
    const { onMoveNodes } = renderTree();
    press('/p/a.md');
    moveOver(row('/p/docs'));
    expect(row('/p/docs')).toHaveAttribute('data-drop-target', 'valid');
    release(row('/p/docs'));
    expect(onMoveNodes).toHaveBeenCalledWith(['/p/a.md'], '/p/docs');
  });

  it('carries the whole selection when a selected row is grabbed', () => {
    const { onMoveNodes } = renderTree({
      selectedPath: '/p/b.md',
      selectedPaths: ['/p/a.md', '/p/b.md'],
    });
    press('/p/a.md');
    moveOver(row('/p/docs'));
    expect(screen.getByTestId('tree-drag-ghost')).toHaveTextContent('2 items');
    expect(row('/p/a.md')).toHaveClass('opacity-40');
    expect(row('/p/b.md')).toHaveClass('opacity-40');
    release(row('/p/docs'));
    expect(onMoveNodes).toHaveBeenCalledWith(['/p/a.md', '/p/b.md'], '/p/docs');
  });

  it('carries only the grabbed row when it is not part of the selection', () => {
    const { onMoveNodes } = renderTree({
      selectedPath: '/p/b.md',
      selectedPaths: ['/p/b.md', '/p/src/main.ts'],
    });
    press('/p/a.md');
    moveOver(row('/p/docs'));
    release(row('/p/docs'));
    expect(onMoveNodes).toHaveBeenCalledWith(['/p/a.md'], '/p/docs');
  });

  it('refuses a folder dropped onto itself or into its own subtree', () => {
    const { onMoveNodes } = renderTree();
    press('/p/src');
    moveOver(row('/p/src'));
    expect(row('/p/src')).toHaveAttribute('data-drop-target', 'invalid');
    moveOver(row('/p/src/lib'));
    expect(row('/p/src/lib')).toHaveAttribute('data-drop-target', 'invalid');
    release(row('/p/src/lib'));
    expect(onMoveNodes).not.toHaveBeenCalled();
  });

  it('drops onto a file row into the folder that file lives in', () => {
    const { onMoveNodes } = renderTree();
    press('/p/a.md');
    moveOver(row('/p/src/main.ts'));
    expect(row('/p/src')).toHaveAttribute('data-drop-target', 'valid');
    release(row('/p/src/main.ts'));
    expect(onMoveNodes).toHaveBeenCalledWith(['/p/a.md'], '/p/src');
  });

  it('drops onto empty space below the tree into the project root', () => {
    const { onMoveNodes } = renderTree();
    press('/p/src/main.ts');
    moveOver(pane());
    expect(pane()).toHaveAttribute('data-drop-target', 'valid');
    release(pane());
    expect(onMoveNodes).toHaveBeenCalledWith(['/p/src/main.ts'], '/p');
  });

  it('does nothing for an item dropped into the folder it already lives in', () => {
    const { onMoveNodes } = renderTree();
    press('/p/src/main.ts');
    moveOver(row('/p/src'));
    expect(row('/p/src')).toHaveAttribute('data-drop-target', 'invalid');
    release(row('/p/src'));
    expect(onMoveNodes).not.toHaveBeenCalled();
  });

  it('does nothing when released outside the explorer', () => {
    const { onMoveNodes } = renderTree();
    press('/p/a.md');
    moveOver(document.body);
    expect(screen.queryByTestId('tree-drag-ghost')).toBeInTheDocument();
    release(document.body);
    expect(onMoveNodes).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tree-drag-ghost')).not.toBeInTheDocument();
  });

  it('keeps a press without movement a plain click', () => {
    const { onMoveNodes, onSelectFile } = renderTree();
    press('/p/a.md');
    fireEvent.mouseMove(window, { clientX: 12, clientY: 11, buttons: 1 });
    release(row('/p/a.md'));
    fireEvent.click(row('/p/a.md'));
    expect(screen.queryByTestId('tree-drag-ghost')).not.toBeInTheDocument();
    expect(onMoveNodes).not.toHaveBeenCalled();
    expect(onSelectFile).toHaveBeenCalledWith('/p/a.md');
  });

  it('does not open the row under the pointer when a drag ends on it', () => {
    const { onSelectFile, onToggleDir } = renderTree();
    press('/p/a.md');
    moveOver(row('/p/docs'));
    release(row('/p/docs'));
    fireEvent.click(row('/p/docs'));
    expect(onToggleDir).not.toHaveBeenCalled();
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it('cancels the drag on Escape', () => {
    const { onMoveNodes } = renderTree();
    press('/p/a.md');
    moveOver(row('/p/docs'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('tree-drag-ghost')).not.toBeInTheDocument();
    release(row('/p/docs'));
    expect(onMoveNodes).not.toHaveBeenCalled();
  });

  it('ends a drag whose release never arrived instead of sticking to the pointer', () => {
    const { onMoveNodes } = renderTree();
    press('/p/a.md');
    moveOver(row('/p/docs'));
    underPointer = row('/p/docs');
    fireEvent.mouseMove(window, { clientX: 70, clientY: 70, buttons: 0 });
    expect(screen.queryByTestId('tree-drag-ghost')).not.toBeInTheDocument();
    release(row('/p/docs'));
    expect(onMoveNodes).not.toHaveBeenCalled();
  });

  it('ends the drag when the window loses focus', () => {
    const { onMoveNodes } = renderTree();
    press('/p/a.md');
    moveOver(row('/p/docs'));
    fireEvent.blur(window);
    expect(screen.queryByTestId('tree-drag-ghost')).not.toBeInTheDocument();
    release(row('/p/docs'));
    expect(onMoveNodes).not.toHaveBeenCalled();
  });

  it('ignores the right and middle mouse buttons', () => {
    renderTree();
    press('/p/a.md', { button: 2 });
    moveOver(row('/p/docs'));
    expect(screen.queryByTestId('tree-drag-ghost')).not.toBeInTheDocument();
  });

  it('cannot start a drag when moving is not wired', () => {
    renderTree({ onMoveNodes: undefined });
    press('/p/a.md');
    moveOver(row('/p/docs'));
    expect(screen.queryByTestId('tree-drag-ghost')).not.toBeInTheDocument();
  });

  it('opens a collapsed folder that is hovered long enough, without a click', () => {
    vi.useFakeTimers();
    const { onExpandDir, onToggleDir } = renderTree();
    press('/p/a.md');
    moveOver(row('/p/docs'));
    act(() => {
      vi.advanceTimersByTime(AUTO_EXPAND_MS - 1);
    });
    expect(onExpandDir).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onExpandDir).toHaveBeenCalledWith('/p/docs');
    expect(onToggleDir).not.toHaveBeenCalled();
  });

  it('does not open a folder the pointer only passed over', () => {
    vi.useFakeTimers();
    const { onExpandDir } = renderTree();
    press('/p/a.md');
    moveOver(row('/p/docs'));
    act(() => {
      vi.advanceTimersByTime(AUTO_EXPAND_MS / 2);
    });
    moveOver(row('/p/b.md'));
    act(() => {
      vi.advanceTimersByTime(AUTO_EXPAND_MS);
    });
    expect(onExpandDir).not.toHaveBeenCalled();
  });
});

describe('FileExplorer — selection gestures', () => {
  it('adds a range to the selection on Cmd+Shift+click', () => {
    const onRangeSelect = vi.fn();
    renderTree({
      selectedPath: '/p/src/main.ts',
      selectedPaths: ['/p/src', '/p/src/main.ts'],
      selectionAnchor: '/p/docs',
      onRangeSelect,
    });
    fireEvent.click(row('/p/b.md'), { shiftKey: true, metaKey: true });
    expect(onRangeSelect).toHaveBeenCalledWith(
      ['/p/src', '/p/src/main.ts', '/p/docs', '/p/a.md', '/p/b.md'],
      '/p/b.md'
    );
  });

  it('replaces the selection with the range on a plain Shift+click', () => {
    const onRangeSelect = vi.fn();
    renderTree({
      selectedPath: '/p/src/main.ts',
      selectedPaths: ['/p/src', '/p/src/main.ts'],
      selectionAnchor: '/p/docs',
      onRangeSelect,
    });
    fireEvent.click(row('/p/b.md'), { shiftKey: true });
    expect(onRangeSelect).toHaveBeenCalledWith(['/p/docs', '/p/a.md', '/p/b.md'], '/p/b.md');
  });

  it('selects a right-clicked row outside the selection before the menu opens', () => {
    const calls: string[] = [];
    renderTree({
      selectedPath: '/p/a.md',
      selectedPaths: ['/p/a.md', '/p/b.md'],
      onFocusNode: (path) => calls.push(`focus:${path}`),
      onContextMenu: (_e, node) => calls.push(`menu:${node.path}`),
    });
    fireEvent.contextMenu(row('/p/src/main.ts'));
    expect(calls).toEqual(['focus:/p/src/main.ts', 'menu:/p/src/main.ts']);
  });

  it('keeps the selection when a selected row is right-clicked', () => {
    const calls: string[] = [];
    renderTree({
      selectedPath: '/p/a.md',
      selectedPaths: ['/p/a.md', '/p/b.md'],
      onFocusNode: (path) => calls.push(`focus:${path}`),
      onContextMenu: (_e, node) => calls.push(`menu:${node.path}`),
    });
    fireEvent.contextMenu(row('/p/b.md'));
    expect(calls).toEqual(['menu:/p/b.md']);
  });
});
