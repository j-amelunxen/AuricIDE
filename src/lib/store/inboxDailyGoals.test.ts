import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand';
import type { InboxItem } from '@/lib/tauri/inbox';

const mockList = vi.fn();
const mockAdd = vi.fn();
const mockUpdate = vi.fn();
const mockCaptureTicket = vi.fn();
const mockOverview = vi.fn();

vi.mock('@/lib/tauri/inbox', () => ({
  inboxList: (...args: unknown[]) => mockList(...args),
  inboxAdd: (...args: unknown[]) => mockAdd(...args),
  inboxUpdate: (...args: unknown[]) => mockUpdate(...args),
  inboxDismiss: vi.fn(),
  inboxAssign: vi.fn(),
  inboxUnassign: vi.fn(),
  inboxAttach: vi.fn(),
  inboxAttachText: vi.fn(),
  inboxDetach: vi.fn(),
  projectsPmOverview: (...args: unknown[]) => mockOverview(...args),
  inboxSetTicketStatus: vi.fn(),
  inboxCaptureTicket: (...args: unknown[]) => mockCaptureTicket(...args),
}));

import { createInboxSlice, type InboxSlice } from './inboxSlice';

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'item-1',
    title: 'Task 1',
    notes: '',
    createdAt: '2026-09-08T10:00:00Z',
    updatedAt: '2026-09-08T10:00:00Z',
    projectPath: null,
    projectName: null,
    ticketId: null,
    assignedAt: null,
    dismissedAt: null,
    priority: 'normal',
    dueDate: null,
    dailyGoal: false,
    ...overrides,
  };
}

describe('inboxSlice daily goals', () => {
  let store: StoreApi<InboxSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOverview.mockResolvedValue([]);
    store = createStore<InboxSlice>()((...a) => ({ ...createInboxSlice(...a) }));
  });

  describe('toggleDailyGoal', () => {
    it('toggles dailyGoal from false to true', async () => {
      const item = makeItem({ id: 'item-1', dailyGoal: false });
      store.setState({ inboxItems: [item] });

      mockUpdate.mockResolvedValue({ ...item, dailyGoal: true });

      await store.getState().toggleDailyGoal('item-1');

      expect(mockUpdate).toHaveBeenCalledWith('item-1', { dailyGoal: true });
      expect(store.getState().inboxItems[0].dailyGoal).toBe(true);
    });

    it('toggles dailyGoal from true to false', async () => {
      const item = makeItem({ id: 'item-1', dailyGoal: true });
      store.setState({ inboxItems: [item] });

      mockUpdate.mockResolvedValue({ ...item, dailyGoal: false });

      await store.getState().toggleDailyGoal('item-1');

      expect(mockUpdate).toHaveBeenCalledWith('item-1', { dailyGoal: false });
      expect(store.getState().inboxItems[0].dailyGoal).toBe(false);
    });

    it('unflags previous daily goal in the same project', async () => {
      const item1 = makeItem({ id: 'item-1', projectPath: '/repo/a', dailyGoal: true });
      const item2 = makeItem({ id: 'item-2', projectPath: '/repo/a', dailyGoal: false });
      store.setState({ inboxItems: [item1, item2] });

      mockUpdate.mockImplementation(async (id, patch) => {
        const target = [item1, item2].find((i) => i.id === id)!;
        return { ...target, ...patch };
      });

      await store.getState().toggleDailyGoal('item-2');

      // item-1 should be unflagged
      expect(mockUpdate).toHaveBeenCalledWith('item-1', { dailyGoal: false });
      // item-2 should be flagged
      expect(mockUpdate).toHaveBeenCalledWith('item-2', { dailyGoal: true });
    });
  });

  describe('captureTicketAsDailyGoal', () => {
    it('captures a ticket into inbox as daily goal and updates store', async () => {
      const existing = makeItem({ id: 'item-1', projectPath: '/repo/a', dailyGoal: true });
      store.setState({ inboxItems: [existing] });

      const captured = makeItem({
        id: 'item-2',
        projectPath: '/repo/a',
        ticketId: 't-200',
        dailyGoal: true,
      });
      mockCaptureTicket.mockResolvedValue(captured);
      mockUpdate.mockResolvedValue({ ...existing, dailyGoal: false });

      const result = await store.getState().captureTicketAsDailyGoal('/repo/a', 't-200');

      expect(result).toEqual(captured);
      expect(mockCaptureTicket).toHaveBeenCalledWith({
        projectPath: '/repo/a',
        ticketId: 't-200',
        dailyGoal: true,
      });
      // The previous daily goal in /repo/a should have been unflagged
      expect(mockUpdate).toHaveBeenCalledWith('item-1', { dailyGoal: false });
    });
  });

  describe('setDailyGoal', () => {
    it('flags item as daily goal and unflags previous daily goal in same project', async () => {
      const item1 = makeItem({ id: 'item-1', projectPath: '/repo/a', dailyGoal: true });
      const item2 = makeItem({ id: 'item-2', projectPath: '/repo/a', dailyGoal: false });
      store.setState({ inboxItems: [item1, item2] });

      mockUpdate.mockImplementation(async (id, patch) => {
        const target = [item1, item2].find((i) => i.id === id)!;
        return { ...target, ...patch };
      });

      await store.getState().setDailyGoal('item-2', true);

      expect(mockUpdate).toHaveBeenCalledWith('item-1', { dailyGoal: false });
      expect(mockUpdate).toHaveBeenCalledWith('item-2', { dailyGoal: true });
    });

    it('is a no-op if item is already in the requested state', async () => {
      const item = makeItem({ id: 'item-1', dailyGoal: true });
      store.setState({ inboxItems: [item] });

      await store.getState().setDailyGoal('item-1', true);

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('unflags item when requested with false', async () => {
      const item = makeItem({ id: 'item-1', dailyGoal: true });
      store.setState({ inboxItems: [item] });

      mockUpdate.mockResolvedValue({ ...item, dailyGoal: false });

      await store.getState().setDailyGoal('item-1', false);

      expect(mockUpdate).toHaveBeenCalledWith('item-1', { dailyGoal: false });
    });
  });
});
