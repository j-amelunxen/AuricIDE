import { describe, expect, it } from 'vitest';
import type { InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';
import { groupInboxByProject } from './groupInboxByProject';

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

describe('groupInboxByProject', () => {
  it('ignores unassigned items entirely', () => {
    const unassigned = makeItem({ id: 'a' });

    expect(groupInboxByProject([unassigned], {})).toEqual([]);
  });

  it('groups items by project path and sorts groups by project name', () => {
    const inZebra = makeItem({ id: 'z', projectPath: '/repo/zebra', projectName: 'zebra' });
    const inAlpha = makeItem({ id: 'a', projectPath: '/repo/alpha', projectName: 'alpha' });

    const groups = groupInboxByProject([inZebra, inAlpha], {});

    expect(groups.map((g) => g.projectPath)).toEqual(['/repo/alpha', '/repo/zebra']);
  });

  it('collects every item for a project into one group, in input order', () => {
    const first = makeItem({ id: 'first', projectPath: '/repo/alpha', projectName: 'alpha' });
    const second = makeItem({ id: 'second', projectPath: '/repo/alpha', projectName: 'alpha' });

    const [group] = groupInboxByProject([first, second], {});

    expect(group.items.map((g) => g.item.id)).toEqual(['first', 'second']);
  });

  it('attaches the matching overview when one was loaded', () => {
    const item = makeItem({ id: 'a', projectPath: '/repo/alpha', projectName: 'alpha' });
    const overview = makeOverview();

    const [group] = groupInboxByProject([item], { '/repo/alpha': overview });

    expect(group.overview).toBe(overview);
  });

  it('leaves overview undefined when none was loaded for that project', () => {
    const item = makeItem({ id: 'a', projectPath: '/repo/alpha', projectName: 'alpha' });

    const [group] = groupInboxByProject([item], {});

    expect(group.overview).toBeUndefined();
  });

  it("resolves ticketStatus from the overview's live ticket when the ticket is still open", () => {
    const item = makeItem({
      id: 'a',
      projectPath: '/repo/alpha',
      projectName: 'alpha',
      ticketId: 'ticket-1',
    });
    const overview = makeOverview({
      tickets: [
        {
          id: 'ticket-1',
          name: 'Task',
          status: 'in_progress',
          priority: 'normal',
          epicId: 'epic-1',
          epicName: 'Inbox',
          updatedAt: '2026-08-17T10:00:00Z',
        },
      ],
    });

    const [group] = groupInboxByProject([item], { '/repo/alpha': overview });

    expect(group.items[0].ticketStatus).toBe('in_progress');
  });

  it("resolves ticketStatus to 'done' when the overview has the project but not the ticket", () => {
    // The overview only carries non-done tickets, so a missing ticket in a
    // readable project db means it was finished.
    const item = makeItem({
      id: 'a',
      projectPath: '/repo/alpha',
      projectName: 'alpha',
      ticketId: 'ticket-1',
    });
    const overview = makeOverview({ tickets: [] });

    const [group] = groupInboxByProject([item], { '/repo/alpha': overview });

    expect(group.items[0].ticketStatus).toBe('done');
  });

  it("resolves ticketStatus to 'unknown' when no overview was loaded for the project", () => {
    const item = makeItem({
      id: 'a',
      projectPath: '/repo/alpha',
      projectName: 'alpha',
      ticketId: 'ticket-1',
    });

    const [group] = groupInboxByProject([item], {});

    expect(group.items[0].ticketStatus).toBe('unknown');
  });

  it("resolves ticketStatus to 'unknown' when the overview could not read the project db", () => {
    const item = makeItem({
      id: 'a',
      projectPath: '/repo/alpha',
      projectName: 'alpha',
      ticketId: 'ticket-1',
    });
    const overview = makeOverview({ hasDb: false, error: 'no such file' });

    const [group] = groupInboxByProject([item], { '/repo/alpha': overview });

    expect(group.items[0].ticketStatus).toBe('unknown');
  });

  // hasDb can be true while the file still failed to read (unreadable content,
  // unknown schema) — the ticket list is empty either way, so without this
  // check a read failure was indistinguishable from "really has no tickets
  // left" and got reported as a confident 'done'.
  it("resolves ticketStatus to 'unknown' when the project db exists but failed to read, even though hasDb is true", () => {
    const item = makeItem({
      id: 'a',
      projectPath: '/repo/alpha',
      projectName: 'alpha',
      ticketId: 'ticket-1',
    });
    const overview = makeOverview({ hasDb: true, error: 'unknown schema', tickets: [] });

    const [group] = groupInboxByProject([item], { '/repo/alpha': overview });

    expect(group.items[0].ticketStatus).toBe('unknown');
  });

  it('lists live overview tickets that are not already inbox items', () => {
    const item = makeItem({
      id: 'a',
      projectPath: '/repo/alpha',
      projectName: 'alpha',
      ticketId: 'ticket-1',
    });
    const fromInbox = {
      id: 'ticket-1',
      name: 'From inbox',
      status: 'open' as const,
      priority: 'normal' as const,
      epicId: 'epic-1',
      epicName: 'Inbox',
      updatedAt: '2026-08-17T10:00:00Z',
    };
    const alreadyInPm = {
      id: 'ticket-2',
      name: 'Already in PM',
      status: 'in_progress' as const,
      priority: 'high' as const,
      epicId: 'epic-2',
      epicName: 'Backend',
      updatedAt: '2026-08-17T11:00:00Z',
    };
    const overview = makeOverview({ tickets: [fromInbox, alreadyInPm] });

    const [group] = groupInboxByProject([item], { '/repo/alpha': overview });

    expect(group.otherTickets.map((ticket) => ticket.id)).toEqual(['ticket-2']);
  });

  it('has no other tickets when the overview is missing', () => {
    const item = makeItem({
      id: 'a',
      projectPath: '/repo/alpha',
      projectName: 'alpha',
      ticketId: 'ticket-1',
    });

    const [group] = groupInboxByProject([item], {});

    expect(group.otherTickets).toEqual([]);
  });
});
