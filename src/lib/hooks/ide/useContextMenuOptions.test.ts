import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
});
