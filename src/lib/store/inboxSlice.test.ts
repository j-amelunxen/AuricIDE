import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand';
import type { InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';

const mockList = vi.fn();
const mockAdd = vi.fn();
const mockUpdate = vi.fn();
const mockDismiss = vi.fn();
const mockAssign = vi.fn();
const mockUnassign = vi.fn();
const mockOverview = vi.fn();

vi.mock('@/lib/tauri/inbox', () => ({
  inboxList: (...args: unknown[]) => mockList(...args),
  inboxAdd: (...args: unknown[]) => mockAdd(...args),
  inboxUpdate: (...args: unknown[]) => mockUpdate(...args),
  inboxDismiss: (...args: unknown[]) => mockDismiss(...args),
  inboxAssign: (...args: unknown[]) => mockAssign(...args),
  inboxUnassign: (...args: unknown[]) => mockUnassign(...args),
  projectsPmOverview: (...args: unknown[]) => mockOverview(...args),
}));

import { createInboxSlice, type InboxSlice } from './inboxSlice';

let idCounter = 0;

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  idCounter += 1;
  return {
    id: `item-${idCounter}`,
    title: `Task ${idCounter}`,
    notes: '',
    createdAt: '2026-08-17T10:00:00Z',
    updatedAt: '2026-08-17T10:00:00Z',
    projectPath: null,
    projectName: null,
    ticketId: null,
    assignedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

function makeOverview(overrides: Partial<ProjectPmOverview> = {}): ProjectPmOverview {
  return {
    projectPath: '/repo/alpha',
    projectName: 'alpha',
    hasDb: true,
    open: 0,
    inProgress: 0,
    inReview: 0,
    done: 0,
    epics: [],
    tickets: [],
    error: null,
    ...overrides,
  };
}

describe('inboxSlice', () => {
  let store: StoreApi<InboxSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    idCounter = 0;
    // assignInboxItem/unassignInboxItem always follow up with a real overview
    // refresh; give it a harmless default so tests that aren't about the
    // overview itself don't have to stub it.
    mockOverview.mockResolvedValue([]);
    store = createStore<InboxSlice>()((...a) => ({ ...createInboxSlice(...a) }));
  });

  describe('loadInbox', () => {
    it('populates inboxItems from the backend', async () => {
      const items = [makeItem(), makeItem()];
      mockList.mockResolvedValue(items);

      await store.getState().loadInbox();

      expect(store.getState().inboxItems).toEqual(items);
      expect(store.getState().inboxLoading).toBe(false);
      expect(store.getState().inboxError).toBeNull();
    });

    it('sets inboxError instead of throwing when the backend call fails', async () => {
      mockList.mockRejectedValue(new Error('db locked'));

      await expect(store.getState().loadInbox()).resolves.toBeUndefined();

      expect(store.getState().inboxItems).toEqual([]);
      expect(store.getState().inboxError).toBe('db locked');
      expect(store.getState().inboxLoading).toBe(false);
    });
  });

  describe('addInboxItem', () => {
    it('adds the stored item to the front of the list and returns it', async () => {
      const existing = makeItem({ title: 'existing' });
      store.setState({ inboxItems: [existing] });
      const stored = makeItem({ title: 'Buy milk' });
      mockAdd.mockResolvedValue(stored);

      const result = await store.getState().addInboxItem('Buy milk');

      expect(mockAdd).toHaveBeenCalledWith({ title: 'Buy milk', notes: '' });
      expect(result).toEqual(stored);
      expect(store.getState().inboxItems).toEqual([stored, existing]);
    });

    it('passes notes through when supplied', async () => {
      mockAdd.mockResolvedValue(makeItem());

      await store.getState().addInboxItem('Buy milk', 'two liters');

      expect(mockAdd).toHaveBeenCalledWith({ title: 'Buy milk', notes: 'two liters' });
    });

    it('returns null and sets inboxError without throwing on failure', async () => {
      mockAdd.mockRejectedValue(new Error('title empty'));

      const result = await store.getState().addInboxItem('');

      expect(result).toBeNull();
      expect(store.getState().inboxItems).toEqual([]);
      expect(store.getState().inboxError).toBe('title empty');
    });
  });

  describe('updateInboxItem', () => {
    it('replaces the item in place with the backend response', async () => {
      const original = makeItem({ title: 'old' });
      const updated = { ...original, title: 'new' };
      store.setState({ inboxItems: [original] });
      mockUpdate.mockResolvedValue(updated);

      await store.getState().updateInboxItem(original.id, { title: 'new' });

      expect(mockUpdate).toHaveBeenCalledWith(original.id, { title: 'new' });
      expect(store.getState().inboxItems).toEqual([updated]);
    });

    it('leaves the list untouched and sets inboxError on failure', async () => {
      const original = makeItem();
      store.setState({ inboxItems: [original] });
      mockUpdate.mockRejectedValue(new Error('not found'));

      await store.getState().updateInboxItem(original.id, { title: 'new' });

      expect(store.getState().inboxItems).toEqual([original]);
      expect(store.getState().inboxError).toBe('not found');
    });
  });

  describe('dismissInboxItem', () => {
    it('removes the item from the list', async () => {
      const a = makeItem();
      const b = makeItem();
      store.setState({ inboxItems: [a, b] });
      mockDismiss.mockResolvedValue(undefined);

      await store.getState().dismissInboxItem(a.id);

      expect(mockDismiss).toHaveBeenCalledWith(a.id);
      expect(store.getState().inboxItems).toEqual([b]);
    });

    it('keeps the item and sets inboxError on failure', async () => {
      const a = makeItem();
      store.setState({ inboxItems: [a] });
      mockDismiss.mockRejectedValue(new Error('gone'));

      await store.getState().dismissInboxItem(a.id);

      expect(store.getState().inboxItems).toEqual([a]);
      expect(store.getState().inboxError).toBe('gone');
    });
  });

  describe('assignInboxItem', () => {
    it('replaces the item with the assigned version the backend returns', async () => {
      const original = makeItem();
      const assigned = makeItem({
        id: original.id,
        projectPath: '/repo/alpha',
        projectName: 'alpha',
        ticketId: 'ticket-1',
        assignedAt: '2026-08-17T11:00:00Z',
      });
      store.setState({ inboxItems: [original] });
      mockAssign.mockResolvedValue(assigned);

      await store.getState().assignInboxItem({ itemId: original.id, projectPath: '/repo/alpha' });

      expect(mockAssign).toHaveBeenCalledWith({
        itemId: original.id,
        projectPath: '/repo/alpha',
      });
      expect(store.getState().inboxItems).toEqual([assigned]);
    });

    it('sets inboxError without throwing when assignment fails', async () => {
      const original = makeItem();
      store.setState({ inboxItems: [original] });
      mockAssign.mockRejectedValue(new Error('already assigned'));

      await expect(
        store.getState().assignInboxItem({ itemId: original.id, projectPath: '/repo/alpha' })
      ).resolves.toBeUndefined();

      expect(store.getState().inboxItems).toEqual([original]);
      expect(store.getState().inboxError).toBe('already assigned');
    });

    // Without this, a second item assigned to the same project shows the
    // FIRST item's ticket as 'done' for up to 30s — the overview snapshot
    // taken before the ticket existed never gets refreshed, so the group
    // lookup falls through to "not in the (non-done) ticket list" → done.
    it('refreshes the overview for the assigned project, keeping already-tracked projects fresh', async () => {
      const original = makeItem();
      const existingOverview = makeOverview({
        projectPath: '/repo/existing',
        projectName: 'existing',
      });
      store.setState({
        inboxItems: [original],
        inboxOverview: { '/repo/existing': existingOverview },
      });
      mockAssign.mockResolvedValue(
        makeItem({
          id: original.id,
          projectPath: '/repo/alpha',
          projectName: 'alpha',
          ticketId: 't1',
        })
      );
      const refreshedExisting = makeOverview({
        projectPath: '/repo/existing',
        projectName: 'existing',
        open: 3,
      });
      const alphaOverview = makeOverview({ projectPath: '/repo/alpha', projectName: 'alpha' });
      mockOverview.mockResolvedValue([refreshedExisting, alphaOverview]);

      await store.getState().assignInboxItem({ itemId: original.id, projectPath: '/repo/alpha' });

      const [requestedPaths] = mockOverview.mock.calls[0] as [string[]];
      expect(new Set(requestedPaths)).toEqual(new Set(['/repo/existing', '/repo/alpha']));
      expect(store.getState().inboxOverview).toEqual({
        '/repo/existing': refreshedExisting,
        '/repo/alpha': alphaOverview,
      });
    });

    it('requests only the assigned project when nothing else was tracked yet', async () => {
      const original = makeItem();
      store.setState({ inboxItems: [original] });
      mockAssign.mockResolvedValue(makeItem({ id: original.id, projectPath: '/repo/alpha' }));

      await store.getState().assignInboxItem({ itemId: original.id, projectPath: '/repo/alpha' });

      expect(mockOverview).toHaveBeenCalledWith(['/repo/alpha']);
    });

    // M4 hardening: the open project's own PM draft is a separate cache
    // (pmSlice) from the inbox overview. Without this, assigning a task to
    // the project you already have open leaves its ticket list/epic counts
    // stale until the next unrelated refresh.
    it("refreshes the open project's PM data when the assigned project is the one currently open", async () => {
      const refreshPmData = vi.fn().mockResolvedValue(undefined);
      store.setState({ rootPath: '/repo/alpha', refreshPmData } as unknown as Partial<InboxSlice>);
      const original = makeItem();
      store.setState({ inboxItems: [original] });
      mockAssign.mockResolvedValue(makeItem({ id: original.id, projectPath: '/repo/alpha' }));

      await store.getState().assignInboxItem({ itemId: original.id, projectPath: '/repo/alpha' });

      expect(refreshPmData).toHaveBeenCalledWith('/repo/alpha');
    });

    it('does not refresh PM data when the assigned project is not the one currently open', async () => {
      const refreshPmData = vi.fn().mockResolvedValue(undefined);
      store.setState({ rootPath: '/repo/other', refreshPmData } as unknown as Partial<InboxSlice>);
      const original = makeItem();
      store.setState({ inboxItems: [original] });
      mockAssign.mockResolvedValue(makeItem({ id: original.id, projectPath: '/repo/alpha' }));

      await store.getState().assignInboxItem({ itemId: original.id, projectPath: '/repo/alpha' });

      expect(refreshPmData).not.toHaveBeenCalled();
    });

    it('does not throw when no PM refresh is wired in (e.g. an isolated store in tests)', async () => {
      store.setState({ rootPath: '/repo/alpha' } as unknown as Partial<InboxSlice>);
      const original = makeItem();
      store.setState({ inboxItems: [original] });
      mockAssign.mockResolvedValue(makeItem({ id: original.id, projectPath: '/repo/alpha' }));

      await expect(
        store.getState().assignInboxItem({ itemId: original.id, projectPath: '/repo/alpha' })
      ).resolves.toBeUndefined();
    });
  });

  describe('unassignInboxItem', () => {
    it('replaces the item with the unassigned version the backend returns', async () => {
      const assigned = makeItem({ projectPath: '/repo/alpha', ticketId: 'ticket-1' });
      const cleared = makeItem({ id: assigned.id });
      store.setState({ inboxItems: [assigned] });
      mockUnassign.mockResolvedValue(cleared);

      await store.getState().unassignInboxItem(assigned.id);

      expect(mockUnassign).toHaveBeenCalledWith(assigned.id);
      expect(store.getState().inboxItems).toEqual([cleared]);
    });

    it('sets inboxError without throwing on failure', async () => {
      const assigned = makeItem({ projectPath: '/repo/alpha' });
      store.setState({ inboxItems: [assigned] });
      mockUnassign.mockRejectedValue(new Error('boom'));

      await store.getState().unassignInboxItem(assigned.id);

      expect(store.getState().inboxItems).toEqual([assigned]);
      expect(store.getState().inboxError).toBe('boom');
    });

    it('refreshes the overview for the project the item is unassigned from, keeping other tracked projects fresh', async () => {
      const assigned = makeItem({ projectPath: '/repo/alpha', ticketId: 'ticket-1' });
      const otherOverview = makeOverview({ projectPath: '/repo/other' });
      store.setState({ inboxItems: [assigned], inboxOverview: { '/repo/other': otherOverview } });
      mockUnassign.mockResolvedValue(makeItem({ id: assigned.id }));
      const refreshedOther = makeOverview({ projectPath: '/repo/other', open: 2 });
      const alphaOverview = makeOverview({ projectPath: '/repo/alpha' });
      mockOverview.mockResolvedValue([refreshedOther, alphaOverview]);

      await store.getState().unassignInboxItem(assigned.id);

      const [requestedPaths] = mockOverview.mock.calls[0] as [string[]];
      expect(new Set(requestedPaths)).toEqual(new Set(['/repo/other', '/repo/alpha']));
      expect(store.getState().inboxOverview).toEqual({
        '/repo/other': refreshedOther,
        '/repo/alpha': alphaOverview,
      });
    });

    it('does not touch the overview when the item had no project to begin with', async () => {
      const unassigned = makeItem();
      store.setState({ inboxItems: [unassigned] });
      mockUnassign.mockResolvedValue(unassigned);

      await store.getState().unassignInboxItem(unassigned.id);

      expect(mockOverview).not.toHaveBeenCalled();
    });
  });

  describe('refreshInboxOverview', () => {
    it('indexes the returned overviews by project path', async () => {
      const alpha = makeOverview({ projectPath: '/repo/alpha' });
      const beta = makeOverview({ projectPath: '/repo/beta', projectName: 'beta' });
      mockOverview.mockResolvedValue([alpha, beta]);

      await store.getState().refreshInboxOverview(['/repo/alpha', '/repo/beta']);

      expect(mockOverview).toHaveBeenCalledWith(['/repo/alpha', '/repo/beta']);
      expect(store.getState().inboxOverview).toEqual({
        '/repo/alpha': alpha,
        '/repo/beta': beta,
      });
    });

    // The caller (useInboxData, or an action deriving its own path list) is
    // the one that decides which projects still matter; this replaces rather
    // than merges so a project dropped from that list — no longer starred,
    // recent, open or assigned to anything — actually leaves the map instead
    // of lingering with a snapshot that will never be refreshed again.
    it('replaces the whole map with exactly what was requested, dropping paths not requested this time', async () => {
      const alpha = makeOverview({ projectPath: '/repo/alpha' });
      const stale = makeOverview({ projectPath: '/repo/stale' });
      store.setState({ inboxOverview: { '/repo/alpha': alpha, '/repo/stale': stale } });
      const beta = makeOverview({ projectPath: '/repo/beta', projectName: 'beta' });
      mockOverview.mockResolvedValue([beta]);

      await store.getState().refreshInboxOverview(['/repo/beta']);

      expect(store.getState().inboxOverview).toEqual({ '/repo/beta': beta });
    });

    it('sets inboxError without throwing on failure, leaving the previous overview untouched', async () => {
      const alpha = makeOverview({ projectPath: '/repo/alpha' });
      store.setState({ inboxOverview: { '/repo/alpha': alpha } });
      mockOverview.mockRejectedValue(new Error('unreachable'));

      await expect(store.getState().refreshInboxOverview(['/repo/beta'])).resolves.toBeUndefined();

      expect(store.getState().inboxOverview).toEqual({ '/repo/alpha': alpha });
      expect(store.getState().inboxError).toBe('unreachable');
    });
  });
});
