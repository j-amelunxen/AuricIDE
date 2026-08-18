import { describe, expect, it } from 'vitest';
import type { InboxItem, ProjectPmOverview, ProjectTicketDigest } from '@/lib/tauri/inbox';
import type { Priority } from '@/lib/pm/enums';
import {
  inboxPatchFromNewerDigest,
  mirroredInboxItem,
  ticketUpdatesFromInboxPatch,
} from './inboxMirror';

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'item-1',
    title: 'Captured',
    notes: 'from inbox',
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

function assigned(overrides: Partial<InboxItem> = {}): InboxItem {
  return makeItem({
    projectPath: '/repo/alpha',
    projectName: 'alpha',
    ticketId: 'ticket-1',
    assignedAt: '2026-08-17T10:00:00Z',
    ...overrides,
  });
}

function digest(overrides: Partial<ProjectTicketDigest> = {}): ProjectTicketDigest {
  return {
    id: 'ticket-1',
    name: 'Ticket name',
    status: 'open',
    priority: 'high',
    epicId: 'epic-1',
    epicName: 'Inbox',
    updatedAt: '2026-08-18T10:00:00Z',
    dueDate: '2026-09-01',
    description: 'from ticket',
    ...overrides,
  };
}

function overviewWith(ticket: ProjectTicketDigest): Record<string, ProjectPmOverview> {
  return {
    '/repo/alpha': {
      projectPath: '/repo/alpha',
      projectName: 'alpha',
      hasDb: true,
      open: 1,
      inProgress: 0,
      inReview: 0,
      done: 0,
      epics: [],
      tickets: [ticket],
      error: null,
    },
  };
}

describe('mirroredInboxItem', () => {
  it('leaves an unassigned capture untouched', () => {
    const item = makeItem();
    expect(mirroredInboxItem(item, {}, undefined)).toBe(item);
  });

  it('prefers the open project draft over the stored inbox row and the overview', () => {
    const item = assigned({ title: 'Stale inbox', priority: 'low', dueDate: '2026-08-01' });
    const result = mirroredInboxItem(item, overviewWith(digest()), {
      projectPath: '/repo/alpha',
      tickets: [
        {
          id: 'ticket-1',
          status: 'in_progress',
          name: 'Live title',
          description: 'Live notes',
          priority: 'critical' as Priority,
          dueDate: '2026-10-10',
        },
      ],
    });

    expect(result).toMatchObject({
      title: 'Live title',
      notes: 'Live notes',
      priority: 'critical',
      dueDate: '2026-10-10',
    });
  });

  it('uses a newer overview digest when the open project is not this one', () => {
    const item = assigned({
      title: 'Stale inbox',
      notes: 'old notes',
      priority: 'low',
      dueDate: null,
      updatedAt: '2026-08-17T10:00:00Z',
    });

    const result = mirroredInboxItem(item, overviewWith(digest()), undefined);

    expect(result).toMatchObject({
      title: 'Ticket name',
      notes: 'from ticket',
      priority: 'high',
      dueDate: '2026-09-01',
    });
  });

  it('keeps the inbox row when it is newer than the overview digest', () => {
    const item = assigned({
      title: 'Just edited',
      priority: 'critical',
      dueDate: '2026-12-01',
      updatedAt: '2026-08-19T12:00:00Z',
    });

    const result = mirroredInboxItem(
      item,
      overviewWith(digest({ updatedAt: '2026-08-18T10:00:00Z' })),
      undefined
    );

    expect(result.title).toBe('Just edited');
    expect(result.priority).toBe('critical');
    expect(result.dueDate).toBe('2026-12-01');
  });

  it('does not overlay a digest from a different ticket', () => {
    const item = assigned({ title: 'Mine' });
    const result = mirroredInboxItem(item, overviewWith(digest({ id: 'other-ticket' })), undefined);
    expect(result.title).toBe('Mine');
  });
});

describe('inboxPatchFromNewerDigest', () => {
  it('returns a patch when the ticket on disk is ahead of the inbox row', () => {
    const item = assigned({
      title: 'Old',
      notes: 'old',
      priority: 'low',
      dueDate: null,
      updatedAt: '2026-08-17T10:00:00Z',
    });

    expect(inboxPatchFromNewerDigest(item, digest())).toEqual({
      title: 'Ticket name',
      notes: 'from ticket',
      priority: 'high',
      dueDate: '2026-09-01',
    });
  });

  it('returns null when the inbox row is already in step', () => {
    const item = assigned({
      title: 'Ticket name',
      notes: 'from ticket',
      priority: 'high',
      dueDate: '2026-09-01',
      updatedAt: '2026-08-17T10:00:00Z',
    });

    expect(inboxPatchFromNewerDigest(item, digest())).toBeNull();
  });

  it('returns null when the inbox row is newer', () => {
    const item = assigned({
      title: 'Just edited',
      updatedAt: '2026-08-19T12:00:00Z',
    });

    expect(
      inboxPatchFromNewerDigest(item, digest({ updatedAt: '2026-08-18T10:00:00Z' }))
    ).toBeNull();
  });
});

describe('ticketUpdatesFromInboxPatch', () => {
  it('maps inbox fields onto the ticket vocabulary', () => {
    expect(
      ticketUpdatesFromInboxPatch({
        title: 'New title',
        notes: 'New notes',
        priority: 'high',
        dueDate: '2026-09-01',
      })
    ).toEqual({
      name: 'New title',
      description: 'New notes',
      priority: 'high',
      dueDate: '2026-09-01',
    });
  });

  it('omits fields the patch did not touch', () => {
    expect(ticketUpdatesFromInboxPatch({ priority: 'critical' })).toEqual({
      priority: 'critical',
    });
  });

  it('forwards a cleared due date as null', () => {
    expect(ticketUpdatesFromInboxPatch({ dueDate: null })).toEqual({ dueDate: null });
  });
});
