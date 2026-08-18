import { describe, expect, it } from 'vitest';
import type { InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';
import type { TicketStatus } from '@/lib/pm/enums';
import {
  activeInboxItems,
  isActiveInboxItem,
  isSettledInboxTicketStatus,
  liveTicketStatusFor,
  resolveInboxTicketStatus,
  settledInboxItems,
} from './inboxTicketStatus';

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

function assigned(overrides: Partial<InboxItem> = {}): InboxItem {
  return makeItem({
    projectPath: '/repo/alpha',
    projectName: 'alpha',
    ticketId: 'ticket-1',
    assignedAt: '2026-08-17T10:00:00Z',
    ...overrides,
  });
}

function digest(status: TicketStatus, id = 'ticket-1') {
  return {
    id,
    name: 'Task',
    status,
    priority: 'normal' as const,
    epicId: 'epic-1',
    epicName: 'Inbox',
    updatedAt: '2026-08-17T10:00:00Z',
  };
}

describe('isSettledInboxTicketStatus', () => {
  it('treats done, archived and discarded as settled work that should leave the inbox', () => {
    expect(isSettledInboxTicketStatus('done')).toBe(true);
    expect(isSettledInboxTicketStatus('archived')).toBe(true);
    expect(isSettledInboxTicketStatus('discarded')).toBe(true);
  });

  it('keeps open work and unknown statuses in the inbox', () => {
    expect(isSettledInboxTicketStatus('open')).toBe(false);
    expect(isSettledInboxTicketStatus('in_progress')).toBe(false);
    expect(isSettledInboxTicketStatus('to_test')).toBe(false);
    expect(isSettledInboxTicketStatus('in_review')).toBe(false);
    expect(isSettledInboxTicketStatus('unknown')).toBe(false);
  });
});

describe('resolveInboxTicketStatus', () => {
  it('prefers a live ticket status from the open project over the overview', () => {
    const item = assigned();
    const overview = makeOverview({ tickets: [digest('open')] });

    expect(resolveInboxTicketStatus(item, overview, 'archived')).toBe('archived');
  });

  it('reads the live status from the overview when the ticket is still open work', () => {
    const item = assigned();
    const overview = makeOverview({ tickets: [digest('in_progress')] });

    expect(resolveInboxTicketStatus(item, overview)).toBe('in_progress');
  });

  it("resolves to 'done' when a readable project db no longer lists the ticket", () => {
    const item = assigned();
    const overview = makeOverview({ tickets: [] });

    expect(resolveInboxTicketStatus(item, overview)).toBe('done');
  });

  it("stays 'unknown' when no overview was loaded", () => {
    expect(resolveInboxTicketStatus(assigned(), undefined)).toBe('unknown');
  });

  it("stays 'unknown' when the overview could not read the project db", () => {
    const overview = makeOverview({ error: 'unreadable', tickets: [] });

    expect(resolveInboxTicketStatus(assigned(), overview)).toBe('unknown');
  });
});

describe('liveTicketStatusFor', () => {
  it('returns the draft status when the item belongs to the open project', () => {
    const item = assigned();

    expect(
      liveTicketStatusFor(item, {
        projectPath: '/repo/alpha',
        tickets: [{ id: 'ticket-1', status: 'archived' }],
      })
    ).toBe('archived');
  });

  it('returns undefined when the ticket is not in the open project drafts', () => {
    // An empty draft list is "PM not loaded / ticket not ours", never "settled".
    expect(
      liveTicketStatusFor(assigned(), { projectPath: '/repo/alpha', tickets: [] })
    ).toBeUndefined();
  });

  it('ignores drafts from a different project', () => {
    expect(
      liveTicketStatusFor(assigned(), {
        projectPath: '/repo/other',
        tickets: [{ id: 'ticket-1', status: 'done' }],
      })
    ).toBeUndefined();
  });
});

describe('isActiveInboxItem / activeInboxItems', () => {
  it('keeps unassigned captures regardless of any overview', () => {
    const item = makeItem();

    expect(isActiveInboxItem(item, makeOverview())).toBe(true);
  });

  it('hides an assigned item whose ticket is done in the overview', () => {
    const item = assigned();
    const overview = makeOverview({ tickets: [digest('open', 'other')] });

    expect(isActiveInboxItem(item, overview)).toBe(false);
  });

  it('hides an assigned item whose live ticket was just archived in PM', () => {
    const item = assigned();
    const overview = makeOverview({ tickets: [digest('in_progress')] });

    expect(isActiveInboxItem(item, overview, 'archived')).toBe(false);
  });

  it('hides an assigned item whose live ticket was discarded', () => {
    const item = assigned();
    const overview = makeOverview({ tickets: [digest('in_progress')] });

    expect(isActiveInboxItem(item, overview, 'discarded')).toBe(false);
  });

  it('keeps an assigned item whose ticket is waiting for test', () => {
    const item = assigned();
    const overview = makeOverview({ tickets: [digest('to_test')] });

    expect(isActiveInboxItem(item, overview)).toBe(true);
  });

  it('keeps an assigned item when the overview has not loaded yet', () => {
    expect(isActiveInboxItem(assigned(), undefined)).toBe(true);
  });

  it('filters the visible list down to still-open work', () => {
    const unsorted = makeItem({ id: 'bare' });
    const open = assigned({ id: 'open' });
    const finished = assigned({ id: 'done', ticketId: 'ticket-done' });
    const overview = {
      '/repo/alpha': makeOverview({
        tickets: [digest('open')],
      }),
    };

    expect(activeInboxItems([unsorted, open, finished], overview).map((item) => item.id)).toEqual([
      'bare',
      'open',
    ]);
  });
});

describe('settledInboxItems', () => {
  it('returns only assigned items the disk overview can confirm as finished', () => {
    const unsorted = makeItem({ id: 'bare' });
    const open = assigned({ id: 'open' });
    const finished = assigned({ id: 'done', ticketId: 'ticket-done' });
    const unknown = assigned({
      id: 'other-project',
      projectPath: '/repo/beta',
      ticketId: 'ticket-beta',
    });
    const overview = {
      '/repo/alpha': makeOverview({ tickets: [digest('open')] }),
    };

    expect(
      settledInboxItems([unsorted, open, finished, unknown], overview).map((i) => i.id)
    ).toEqual(['done']);
  });

  it('does not treat a read failure as finished work', () => {
    const item = assigned();
    const overview = {
      '/repo/alpha': makeOverview({ error: 'locked', tickets: [] }),
    };

    expect(settledInboxItems([item], overview)).toEqual([]);
  });
});
