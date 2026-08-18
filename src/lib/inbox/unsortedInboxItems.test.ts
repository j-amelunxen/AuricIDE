import { describe, expect, it } from 'vitest';
import type { InboxItem } from '@/lib/tauri/inbox';
import { unsortedInboxItems } from './unsortedInboxItems';

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'item-1',
    title: 'Task',
    notes: '',
    createdAt: '2026-08-17T10:00:00Z',
    updatedAt: '2026-08-17T10:00:00Z',
    projectPath: null,
    projectName: null,
    ticketId: null,
    assignedAt: null,
    dismissedAt: null,
    priority: 'normal',
    dueDate: null,
    ...overrides,
  };
}

describe('unsortedInboxItems', () => {
  it('keeps only items with no project assignment', () => {
    const unassigned = makeItem({ id: 'a' });
    const assigned = makeItem({ id: 'b', projectPath: '/repo/alpha', projectName: 'alpha' });

    expect(unsortedInboxItems([unassigned, assigned])).toEqual([unassigned]);
  });

  it('preserves the order of the input list', () => {
    const first = makeItem({ id: 'first' });
    const second = makeItem({ id: 'second' });

    expect(unsortedInboxItems([second, first])).toEqual([second, first]);
  });

  it('returns an empty array when everything is assigned', () => {
    const assigned = makeItem({ id: 'a', projectPath: '/repo/alpha', projectName: 'alpha' });

    expect(unsortedInboxItems([assigned])).toEqual([]);
  });

  it('returns an empty array for an empty inbox', () => {
    expect(unsortedInboxItems([])).toEqual([]);
  });
});
