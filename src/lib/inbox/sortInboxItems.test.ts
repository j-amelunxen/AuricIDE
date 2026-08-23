import { describe, expect, it } from 'vitest';
import type { InboxItem } from '@/lib/tauri/inbox';
import { INBOX_DEFAULT_SORT, INBOX_SORTS, parseInboxSort, sortInboxItems } from './sortInboxItems';

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

describe('sortInboxItems', () => {
  it('sorts by created date, newest first', () => {
    const older = makeItem({ id: 'old', createdAt: '2026-08-01T00:00:00Z' });
    const newer = makeItem({ id: 'new', createdAt: '2026-08-10T00:00:00Z' });

    expect(sortInboxItems([older, newer], 'created').map((item) => item.id)).toEqual([
      'new',
      'old',
    ]);
  });

  it('sorts by due date, earliest first, undated last', () => {
    const undated = makeItem({ id: 'none', dueDate: null });
    const later = makeItem({ id: 'later', dueDate: '2026-08-20' });
    const sooner = makeItem({ id: 'sooner', dueDate: '2026-08-10' });

    expect(sortInboxItems([undated, later, sooner], 'dueDate').map((item) => item.id)).toEqual([
      'sooner',
      'later',
      'none',
    ]);
  });

  it('sorts by priority, critical first, then high, normal, low', () => {
    const low = makeItem({ id: 'low', priority: 'low' });
    const critical = makeItem({ id: 'critical', priority: 'critical' });
    const normal = makeItem({ id: 'normal', priority: 'normal' });
    const high = makeItem({ id: 'high', priority: 'high' });

    expect(
      sortInboxItems([low, critical, normal, high], 'priority').map((item) => item.id)
    ).toEqual(['critical', 'high', 'normal', 'low']);
  });

  it('breaks priority ties by due date, then by newest created', () => {
    const late = makeItem({
      id: 'late',
      priority: 'high',
      dueDate: '2026-08-20',
      createdAt: '2026-08-02T00:00:00Z',
    });
    const early = makeItem({
      id: 'early',
      priority: 'high',
      dueDate: '2026-08-10',
      createdAt: '2026-08-01T00:00:00Z',
    });
    const undatedNewer = makeItem({
      id: 'undated-new',
      priority: 'high',
      dueDate: null,
      createdAt: '2026-08-04T00:00:00Z',
    });
    const undatedOlder = makeItem({
      id: 'undated-old',
      priority: 'high',
      dueDate: null,
      createdAt: '2026-08-03T00:00:00Z',
    });

    expect(
      sortInboxItems([undatedOlder, late, undatedNewer, early], 'priority').map((item) => item.id)
    ).toEqual(['early', 'late', 'undated-new', 'undated-old']);
  });

  it('does not mutate the input list', () => {
    const first = makeItem({ id: 'a', createdAt: '2026-08-01T00:00:00Z' });
    const second = makeItem({ id: 'b', createdAt: '2026-08-10T00:00:00Z' });
    const input = [first, second];

    sortInboxItems(input, 'created');

    expect(input.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('the sort the inbox opens with', () => {
  it('is priority — the whole point of a triage list', () => {
    expect(INBOX_DEFAULT_SORT).toBe('priority');
  });

  it('offers priority first in the picker', () => {
    expect(INBOX_SORTS[0]).toBe('priority');
    expect([...INBOX_SORTS].sort()).toEqual(['created', 'dueDate', 'priority']);
  });
});

describe('parseInboxSort', () => {
  it('accepts every offered sort verbatim', () => {
    for (const sort of INBOX_SORTS) expect(parseInboxSort(sort)).toBe(sort);
  });

  it('falls back to the default for anything else', () => {
    expect(parseInboxSort(null)).toBe(INBOX_DEFAULT_SORT);
    expect(parseInboxSort('')).toBe(INBOX_DEFAULT_SORT);
    expect(parseInboxSort('whatever-an-old-build-wrote')).toBe(INBOX_DEFAULT_SORT);
  });
});
