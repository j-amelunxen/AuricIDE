import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInboxData } from './useInboxData';
import { useStore } from '@/lib/store';
import type { InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';

const inboxListMock = vi.fn(async (): Promise<InboxItem[]> => []);
const projectsPmOverviewMock = vi.fn(async (paths: string[]): Promise<ProjectPmOverview[]> =>
  paths.map((projectPath) => ({
    projectPath,
    projectName: projectPath.split('/').pop() ?? projectPath,
    hasDb: true,
    open: 0,
    inProgress: 0,
    inReview: 0,
    done: 0,
    epics: [],
    tickets: [],
    error: null,
  }))
);

vi.mock('@/lib/tauri/inbox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/inbox')>();
  return {
    ...actual,
    inboxList: () => inboxListMock(),
    projectsPmOverview: (paths: string[]) => projectsPmOverviewMock(paths),
  };
});

function assignedItem(id: string, projectPath: string): InboxItem {
  return {
    id,
    title: 'Task',
    notes: '',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    projectPath,
    projectName: 'alpha',
    ticketId: 't1',
    assignedAt: '2026-01-01 00:00:00',
    dismissedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useStore.setState({
    inboxItems: [],
    inboxOverview: {},
    starredProjects: [],
    recentProjects: [],
    rootPath: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useInboxData', () => {
  it('loads the inbox on mount', () => {
    renderHook(() => useInboxData());
    expect(inboxListMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh the overview when there is nothing to show it for', () => {
    renderHook(() => useInboxData());
    expect(projectsPmOverviewMock).not.toHaveBeenCalled();
  });

  // The overview refresh fans out to every starred + recent + open project —
  // dozens of db reads. An empty inbox has nothing to show a ticket status
  // for, so none of that is worth doing every 30s with no panel even mounted.
  it('does not refresh the overview when the inbox has no items, even with an open project', () => {
    useStore.setState({ rootPath: '/repos/alpha' });

    renderHook(() => useInboxData());

    expect(projectsPmOverviewMock).not.toHaveBeenCalled();
  });

  it('never runs the periodic refresh either while the inbox stays empty', () => {
    useStore.setState({ rootPath: '/repos/alpha' });

    renderHook(() => useInboxData());
    vi.advanceTimersByTime(60_000);

    expect(projectsPmOverviewMock).not.toHaveBeenCalled();
  });

  it('refreshes the overview for the open project on mount once the inbox has an item', () => {
    useStore.setState({
      rootPath: '/repos/alpha',
      inboxItems: [assignedItem('i1', '/repos/alpha')],
    });

    renderHook(() => useInboxData());

    expect(projectsPmOverviewMock).toHaveBeenCalledWith(['/repos/alpha']);
  });

  it('starts refreshing once the first item appears, even an unassigned one', () => {
    useStore.setState({ rootPath: '/repos/alpha' });
    const { rerender } = renderHook(() => useInboxData());
    expect(projectsPmOverviewMock).not.toHaveBeenCalled();

    useStore.setState({
      inboxItems: [
        {
          id: 'i1',
          title: 'Task',
          notes: '',
          createdAt: '2026-01-01 00:00:00',
          updatedAt: '2026-01-01 00:00:00',
          projectPath: null,
          projectName: null,
          ticketId: null,
          assignedAt: null,
          dismissedAt: null,
        },
      ],
    });
    rerender();

    expect(projectsPmOverviewMock).toHaveBeenCalledWith(['/repos/alpha']);
  });

  it('refreshes again when the set of assigned projects changes', () => {
    useStore.setState({ inboxItems: [assignedItem('i1', '/repos/alpha')] });
    const { rerender } = renderHook(() => useInboxData());
    expect(projectsPmOverviewMock).toHaveBeenCalledTimes(1);

    useStore.setState({
      inboxItems: [assignedItem('i1', '/repos/alpha'), assignedItem('i2', '/repos/beta')],
    });
    rerender();

    expect(projectsPmOverviewMock).toHaveBeenCalledTimes(2);
    expect(projectsPmOverviewMock).toHaveBeenLastCalledWith(['/repos/alpha', '/repos/beta']);
  });

  it('does not refresh again for an unrelated item edit', () => {
    useStore.setState({ inboxItems: [assignedItem('i1', '/repos/alpha')] });
    const { rerender } = renderHook(() => useInboxData());
    expect(projectsPmOverviewMock).toHaveBeenCalledTimes(1);

    useStore.setState({
      inboxItems: [{ ...assignedItem('i1', '/repos/alpha'), title: 'Renamed' }],
    });
    rerender();

    expect(projectsPmOverviewMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes again after 30 seconds while the tab is visible', () => {
    useStore.setState({
      rootPath: '/repos/alpha',
      inboxItems: [assignedItem('i1', '/repos/alpha')],
    });
    renderHook(() => useInboxData());
    expect(projectsPmOverviewMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);

    expect(projectsPmOverviewMock).toHaveBeenCalledTimes(2);
  });

  it('skips the periodic refresh while the tab is hidden', () => {
    useStore.setState({
      rootPath: '/repos/alpha',
      inboxItems: [assignedItem('i1', '/repos/alpha')],
    });
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    renderHook(() => useInboxData());
    expect(projectsPmOverviewMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);

    expect(projectsPmOverviewMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  // Without this, coming back to the tab after a break shows up to 30s of
  // stale ticket statuses — the periodic timer is the only other thing that
  // would catch it up, and it may not fire for a while yet.
  it('refreshes once when the tab becomes visible again', () => {
    useStore.setState({
      rootPath: '/repos/alpha',
      inboxItems: [assignedItem('i1', '/repos/alpha')],
    });
    renderHook(() => useInboxData());
    expect(projectsPmOverviewMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(projectsPmOverviewMock).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('does not refresh on a visibilitychange event that leaves the tab hidden', () => {
    useStore.setState({
      rootPath: '/repos/alpha',
      inboxItems: [assignedItem('i1', '/repos/alpha')],
    });
    renderHook(() => useInboxData());
    expect(projectsPmOverviewMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(projectsPmOverviewMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('removes the visibilitychange listener on unmount', () => {
    useStore.setState({
      rootPath: '/repos/alpha',
      inboxItems: [assignedItem('i1', '/repos/alpha')],
    });
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() => useInboxData());
    unmount();

    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    removeSpy.mockRestore();
  });
});
