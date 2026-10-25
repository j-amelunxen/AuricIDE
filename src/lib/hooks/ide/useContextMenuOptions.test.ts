import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mockOpenFileComparison = vi.hoisted(() => vi.fn());
vi.mock('@/lib/compare/compareFiles', () => ({
  openFileComparison: (...args: unknown[]) => mockOpenFileComparison(...args),
}));

import type { useIDEState } from '../useIDEState';
import { useLiveIDEState } from './liveIDEState';
import { useContextMenuOptions, type UseContextMenuOptionsProps } from './useContextMenuOptions';

type PageState = ReturnType<typeof useIDEState>;
const page = (fields: Record<string, unknown>) =>
  ({ rootPath: '/project', selectedPaths: [], repos: [], ...fields }) as unknown as PageState;

const noop = vi.fn();
const handlers: Omit<UseContextMenuOptionsProps, 'state'> = {
  clipboard: null,
  setClipboard: noop,
  handleCopyPath: noop,
  handleCopyPaths: noop,
  handleDeleteSelection: vi.fn(async () => {}),
  handleRenameRequest: noop,
  handlePaste: vi.fn(async () => {}),
  handleOpenTerminalHere: noop,
  handleNewDiagram: vi.fn(async () => {}),
  handleCreateTicketFromMarkdown: vi.fn(async () => {}),
  handleAddToGitignore: vi.fn(async () => {}),
  handleIgnoreGitRepo: vi.fn(async () => {}),
};

describe('useContextMenuOptions', () => {
  // The page hands the handler hooks one live object that never changes
  // identity (useLiveIDEState). A memo keyed on that object alone never
  // re-ran, so the menu kept the empty list from before it was opened.
  it('fills the menu once it opens, behind the live page state', () => {
    const { result, rerender } = renderHook(
      ({ pageState }) => useContextMenuOptions({ state: useLiveIDEState(pageState), ...handlers }),
      { initialProps: { pageState: page({ contextMenu: null }) } }
    );
    expect(result.current.contextMenuOptions).toEqual([]);

    const node = { path: '/project/.auric', name: '.auric', isDirectory: true };
    rerender({ pageState: page({ contextMenu: { x: 10, y: 20, node } }) });

    const labels = result.current.contextMenuOptions.flatMap((o) =>
      'label' in o ? [o.label] : []
    );
    expect(labels).toContain('New File');
    expect(labels).toContain('Rename');
  });

  describe('Compare Selected', () => {
    const tree = [
      {
        path: '/project/src',
        name: 'src',
        isDirectory: true,
        children: [
          { path: '/project/src/a.ts', name: 'a.ts', isDirectory: false },
          { path: '/project/src/b.ts', name: 'b.ts', isDirectory: false },
          { path: '/project/src/c.ts', name: 'c.ts', isDirectory: false },
        ],
      },
    ];

    beforeEach(() => vi.clearAllMocks());

    function optionsFor(selectedPaths: string[], target = selectedPaths[0]) {
      const node = { path: target, name: target.split('/').pop(), isDirectory: false };
      const { result } = renderHook(() =>
        useContextMenuOptions({
          state: useLiveIDEState(
            page({ selectedPaths, fileTree: tree, contextMenu: { x: 0, y: 0, node } })
          ),
          ...handlers,
        })
      );
      return result.current.contextMenuOptions;
    }
    const compareOption = (options: ReturnType<typeof optionsFor>) =>
      options.find((o) => 'label' in o && o.label === 'Compare Selected');

    it('is offered for exactly two selected files and opens them in selection order', () => {
      const option = compareOption(optionsFor(['/project/src/b.ts', '/project/src/a.ts']));
      expect(option).toBeDefined();

      (option as { action: () => void }).action();

      expect(mockOpenFileComparison).toHaveBeenCalledWith('/project/src/b.ts', '/project/src/a.ts');
    });

    it('is offered when the menu was opened on the second selected file', () => {
      const paths = ['/project/src/a.ts', '/project/src/b.ts'];
      expect(compareOption(optionsFor(paths, paths[1]))).toBeDefined();
    });

    it('is not offered for a single file', () => {
      expect(compareOption(optionsFor(['/project/src/a.ts']))).toBeUndefined();
    });

    it('is not offered for three files', () => {
      const paths = ['/project/src/a.ts', '/project/src/b.ts', '/project/src/c.ts'];
      expect(compareOption(optionsFor(paths))).toBeUndefined();
    });

    it('is not offered when one of the two is a folder', () => {
      expect(compareOption(optionsFor(['/project/src/a.ts', '/project/src']))).toBeUndefined();
    });

    it('is not offered when a selected path is not in the tree', () => {
      expect(compareOption(optionsFor(['/project/src/a.ts', '/project/gone.ts']))).toBeUndefined();
    });
  });
});
