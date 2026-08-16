import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * The two joins this hook owns and nobody else can see: the quit flush, and
 * the watcher → router → refresh-handler wiring. Everything else it sets up is
 * stubbed out — this is not a test of the hook's whole surface.
 */

const flushAgentLog = vi.fn(async () => undefined);
vi.mock('@/lib/agents/events/persistence', () => ({
  flushAgentLog: () => flushAgentLog(),
}));

// The only sub-hook not stubbed blind: it is the entry point of the wiring
// under test, so the test needs the callback the hook hands it.
let notifyWatcher: ((event: FsChangeEvent) => void) | null = null;
vi.mock('@/lib/hooks/useFileWatcher', () => ({
  useFileWatcher: (_rootPath: string | null, onEvent: (event: FsChangeEvent) => void) => {
    notifyWatcher = onEvent;
  },
}));

// The rest each own their own tests; here they only need to not touch a
// backend that does not exist in this environment.
vi.mock('@/lib/hooks/useAgentEvents', () => ({ useAgentEvents: () => undefined }));
vi.mock('@/lib/hooks/useAgentConsoleAutoOpen', () => ({
  useAgentConsoleAutoOpen: () => undefined,
}));
vi.mock('@/lib/hooks/useActiveTabContentLoader', () => ({
  useActiveTabContentLoader: () => undefined,
}));
vi.mock('@/lib/hooks/useActiveDiffLoader', () => ({ useActiveDiffLoader: () => undefined }));
vi.mock('@/lib/hooks/useCloseTabShortcut', () => ({ useCloseTabShortcut: () => undefined }));
vi.mock('@/lib/hooks/useMenuCommands', () => ({ useMenuCommands: () => undefined }));
vi.mock('@/lib/hooks/useNotificationInbox', () => ({ useNotificationInbox: () => undefined }));
vi.mock('@/lib/hooks/useTitleBarGutter', () => ({ useTitleBarGutter: () => undefined }));

vi.mock('@/lib/tauri/providers', () => ({ listProviders: vi.fn(async () => []) }));
vi.mock('@/lib/tauri/fs', () => ({ getProjectFilesInfo: vi.fn(async () => []) }));
vi.mock('@/lib/tauri/agents', () => ({ checkCliStatus: vi.fn(async () => false) }));
vi.mock('@/lib/config/migrateCredentials', () => ({
  migrateProjectCredentials: vi.fn(async () => ({ lifted: [] })),
}));

vi.mock('@/lib/store', () => ({
  useStore: {
    getState: () => ({
      initScratches: vi.fn(),
      loadInterruptedAgents: vi.fn(async () => undefined),
      loadProjectAgentSettings: vi.fn(async () => undefined),
      showToast: vi.fn(),
      // A non-DB change feeds the evidence lane as well as the tree; with no
      // open stations that lane returns immediately, which is what this is for.
      goalStationsDraft: [],
    }),
  },
}));

import type { FsChangeEvent } from '@/lib/tauri/watcher';
import { useIDEActions } from './useIDEActions';
import { type useIDEState } from './useIDEState';
import { type useIDEHandlers } from './useIDEHandlers';

/**
 * Everything the hook reaches for on a mount with no project open. Written out
 * rather than proxied so a field the hook starts using shows up as a failure
 * here instead of a silent no-op.
 */
const state = {
  rootPath: null,
  activeTabId: null,
  fileSelectorOpen: false,
  loadRecentProjects: vi.fn(),
  loadStarredProjects: vi.fn(),
  loadRecentCommands: vi.fn(),
  loadCustomSlashCommands: vi.fn(),
  loadSkillCombos: vi.fn(),
  loadBlueprintServerUrl: vi.fn(),
  setCliConnected: vi.fn(),
  setProviders: vi.fn(),
  setDefaultProvider: vi.fn(),
  setProjectFilesInfo: vi.fn(),
  appendAgentLog: vi.fn(),
  updateAgentStatus: vi.fn(),
} as unknown as ReturnType<typeof useIDEState>;

const handlers = {
  handleRefresh: vi.fn(),
  handleRefreshDirs: vi.fn(),
  loadTabContent: vi.fn(),
  handleCommandExecute: vi.fn(),
} as unknown as ReturnType<typeof useIDEHandlers>;

describe('useIDEActions – the agent history’s quit flush', () => {
  beforeEach(() => {
    flushAgentLog.mockClear();
  });

  it('writes whatever is still buffered when the window goes away', () => {
    renderHook(() => useIDEActions(state, handlers));

    window.dispatchEvent(new Event('pagehide'));

    expect(flushAgentLog).toHaveBeenCalledTimes(1);
  });

  it('does not write before the window goes away — the flush is not a mount effect', () => {
    renderHook(() => useIDEActions(state, handlers));

    expect(flushAgentLog).not.toHaveBeenCalled();
  });

  it('leaves no listener behind when the IDE unmounts', () => {
    const { unmount } = renderHook(() => useIDEActions(state, handlers));
    unmount();

    window.dispatchEvent(new Event('pagehide'));

    expect(flushAgentLog).not.toHaveBeenCalled();
  });
});

describe('useIDEActions – the file watcher’s route to the tree refresh', () => {
  beforeEach(() => {
    notifyWatcher = null;
    vi.mocked(handlers.handleRefreshDirs).mockClear();
  });

  it('refreshes the directory a watched file changed in', () => {
    // The router is real here on purpose. Both ends of this join are covered
    // elsewhere — the router against a stub in fsEventRouter.test.ts, the
    // handler by hand in useIDEHandlers.test.tsx — so a wrong argument, or no
    // call at all, is invisible to every other test in the suite.
    vi.useFakeTimers();
    try {
      renderHook(() => useIDEActions(state, handlers));

      notifyWatcher?.({ path: '/p/src/lib/example.ts', kind: 'modify' });
      // Past the router's tree debounce, whose timing is its own file's business.
      vi.advanceTimersByTime(1_000);

      expect(handlers.handleRefreshDirs).toHaveBeenCalledWith(['/p/src/lib']);
    } finally {
      vi.useRealTimers();
    }
  });
});
