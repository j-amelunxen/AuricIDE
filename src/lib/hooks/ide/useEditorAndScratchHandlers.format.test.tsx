import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { IDEState } from './liveIDEState';

const writes: Array<[string, string]> = [];
const store = { activeTabId: '/p/a.ts' as string | null, markDirty: vi.fn(), showToast: vi.fn() };

vi.mock('@/lib/tauri/fs', () => ({
  writeFile: vi.fn(async (path: string, content: string) => {
    writes.push([path, content]);
  }),
  readFile: vi.fn(),
  readFileBase64: vi.fn(),
  deleteFile: vi.fn(),
  movePath: vi.fn(),
}));

const mockFormatForSave = vi.fn<(path: string, content: string, trigger: string) => unknown>();
let blurFormatting = true;
vi.mock('@/lib/editor/format/formatOnSave', () => ({
  formatForSave: (path: string, content: string, trigger: string) =>
    mockFormatForSave(path, content, trigger),
  formatLanguageForTrigger: () => (blurFormatting ? 'typescript' : null),
}));

const mockApply = vi.fn<(path: string, before: string, after: string) => boolean>();
vi.mock('@/lib/editor/format/activeEditor', () => ({
  applyFormattedText: (path: string, before: string, after: string) =>
    mockApply(path, before, after),
}));

vi.mock('@/lib/store', () => ({
  useStore: Object.assign(() => undefined, {
    getState: () => ({
      ...store,
      openTabs: [],
      updateFileInIndex: vi.fn(),
      diagnostics: new Map(),
    }),
  }),
}));

const { useEditorAndScratchHandlers } = await import('./useEditorAndScratchHandlers');

const state = {
  activeTabId: '/p/a.ts' as string,
  editorContent: 'a',
  openTabs: [],
  getDiagnosticCounts: () => ({ errors: 0, warnings: 0 }),
  setEditorContent: vi.fn(),
  markDirty: vi.fn(),
} as unknown as IDEState;

function render() {
  return renderHook(() => useEditorAndScratchHandlers(state, vi.fn())).result.current;
}

beforeEach(() => {
  writes.length = 0;
  store.activeTabId = '/p/a.ts';
  state.activeTabId = '/p/a.ts';
  blurFormatting = true;
  mockFormatForSave.mockReset();
  mockApply.mockReset();
});

describe('⌘S with formatting', () => {
  it('writes the typed text before it asks the formatter', async () => {
    const order: string[] = [];
    mockFormatForSave.mockImplementation(async () => {
      order.push(`format after ${writes.length} write(s)`);
      return null;
    });
    const { handleSave } = render();
    await act(() => handleSave());
    expect(writes).toEqual([['/p/a.ts', 'a']]);
    expect(order).toEqual(['format after 1 write(s)']);
    expect(mockFormatForSave).toHaveBeenCalledWith('/p/a.ts', 'a', 'save');
  });

  it('hands the formatted text to the editor while the file is still open', async () => {
    mockFormatForSave.mockResolvedValue('a;\n');
    mockApply.mockReturnValue(true);
    const { handleSave } = render();
    await act(() => handleSave());
    expect(mockApply).toHaveBeenCalledWith('/p/a.ts', 'a', 'a;\n');
    // The editor's own onChange schedules the formatted write, not handleSave.
    expect(writes).toEqual([['/p/a.ts', 'a']]);
  });

  it('drops a result that arrives after the tab was left, rather than writing it', async () => {
    mockFormatForSave.mockImplementation(async () => {
      store.activeTabId = '/p/other.ts';
      return 'a;\n';
    });
    const { handleSave } = render();
    await act(() => handleSave());
    expect(mockApply).not.toHaveBeenCalled();
    expect(writes).toEqual([['/p/a.ts', 'a']]);
  });

  it('never writes an image, video or PDF tab', async () => {
    state.activeTabId = '/p/logo.png';
    const { handleSave } = render();
    await act(() => handleSave());
    expect(writes).toEqual([]);
    expect(mockFormatForSave).not.toHaveBeenCalled();
  });
});

describe('leaving the editor', () => {
  async function blur(handlers: ReturnType<typeof render>) {
    await act(async () => {
      handlers.handleEditorBlur();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('writes nothing for a file not typed into, so a stale buffer cannot overwrite disk', async () => {
    const handlers = render();
    await blur(handlers);
    expect(writes).toEqual([]);
    expect(mockFormatForSave).not.toHaveBeenCalled();
  });

  it('writes nothing while blur formatting is off, even after typing', async () => {
    blurFormatting = false;
    const handlers = render();
    act(() => handlers.handleEditorChange('ab'));
    await blur(handlers);
    expect(mockFormatForSave).not.toHaveBeenCalled();
  });

  it('formats a file typed into, once', async () => {
    mockFormatForSave.mockResolvedValue(null);
    const handlers = render();
    act(() => handlers.handleEditorChange('ab'));
    await blur(handlers);
    await blur(handlers);
    expect(mockFormatForSave).toHaveBeenCalledTimes(1);
    expect(mockFormatForSave).toHaveBeenCalledWith('/p/a.ts', 'a', 'blur');
  });
});
