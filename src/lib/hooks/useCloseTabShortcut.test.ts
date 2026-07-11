import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCloseTabShortcut } from './useCloseTabShortcut';

const mockCloseTab = vi.fn();
let mockActiveTabId: string | null = null;

vi.mock('@/lib/store', () => ({
  useStore: {
    getState: () => ({
      activeTabId: mockActiveTabId,
      closeTab: mockCloseTab,
    }),
  },
}));

const mockWindowClose = vi.fn(async () => {});
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ close: mockWindowClose }),
}));

type MenuHandler = () => void;
let menuHandlers: Record<string, MenuHandler> = {};
const mockUnlisten = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (event: string, handler: MenuHandler) => {
    menuHandlers[event] = handler;
    return mockUnlisten;
  },
}));

function pressCloseShortcut(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'w',
    metaKey: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(event);
  return event;
}

describe('useCloseTabShortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTabId = null;
    menuHandlers = {};
  });

  it('Cmd+W closes the active tab, not the window', async () => {
    mockActiveTabId = '/project/notes.md';
    renderHook(() => useCloseTabShortcut());

    const event = pressCloseShortcut();

    await waitFor(() => expect(mockCloseTab).toHaveBeenCalledWith('/project/notes.md'));
    expect(event.defaultPrevented).toBe(true);
    expect(mockWindowClose).not.toHaveBeenCalled();
  });

  it('Ctrl+W works the same way (Windows/Linux)', async () => {
    mockActiveTabId = '/project/notes.md';
    renderHook(() => useCloseTabShortcut());

    pressCloseShortcut({ metaKey: false, ctrlKey: true });

    await waitFor(() => expect(mockCloseTab).toHaveBeenCalledWith('/project/notes.md'));
  });

  it('Cmd+W without any open tab closes the window', async () => {
    mockActiveTabId = null;
    renderHook(() => useCloseTabShortcut());

    pressCloseShortcut();

    await waitFor(() => expect(mockWindowClose).toHaveBeenCalled());
    expect(mockCloseTab).not.toHaveBeenCalled();
  });

  it('Cmd+Shift+W is left alone (native Close Window path)', async () => {
    mockActiveTabId = '/project/notes.md';
    renderHook(() => useCloseTabShortcut());

    const event = pressCloseShortcut({ shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(mockCloseTab).not.toHaveBeenCalled();
  });

  it('the macOS menu event closes the active tab too', async () => {
    mockActiveTabId = '/project/notes.md';
    renderHook(() => useCloseTabShortcut());

    await waitFor(() => expect(menuHandlers['menu:close-tab']).toBeDefined());
    menuHandlers['menu:close-tab']();

    await waitFor(() => expect(mockCloseTab).toHaveBeenCalledWith('/project/notes.md'));
  });

  it('unsubscribes from the menu event on unmount', async () => {
    const hook = renderHook(() => useCloseTabShortcut());
    await waitFor(() => expect(menuHandlers['menu:close-tab']).toBeDefined());
    hook.unmount();
    expect(mockUnlisten).toHaveBeenCalled();
  });
});
