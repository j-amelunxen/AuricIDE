import type { Priority, TicketStatus } from '@/lib/pm/enums';
import type {
  InboxItem,
  InboxItemPatch,
  ProjectPmOverview,
  ProjectTicketDigest,
} from '@/lib/tauri/inbox';
import type { PmTicket } from '@/lib/tauri/pm';

export interface LiveInboxTicket {
  id: string;
  status: TicketStatus;
  name: string;
  description: string;
  priority: Priority;
  dueDate?: string | null;
}

export interface LiveInboxTickets {
  projectPath: string | null;
  tickets: LiveInboxTicket[];
}

export interface InboxTicketMirror {
  title: string;
  notes: string;
  priority: Priority;
  dueDate: string | null;
}

function hasLiveFields(ticket: { name?: string }): ticket is LiveInboxTicket {
  return typeof ticket.name === 'string';
}

export function liveTicketFor(
  item: Pick<InboxItem, 'ticketId' | 'projectPath'>,
  live: LiveInboxTickets | undefined
): LiveInboxTicket | undefined {
  if (
    live === undefined ||
    live.projectPath === null ||
    item.projectPath === null ||
    item.ticketId === null ||
    live.projectPath !== item.projectPath
  ) {
    return undefined;
  }
  const ticket = live.tickets.find((candidate) => candidate.id === item.ticketId);
  if (ticket === undefined || !hasLiveFields(ticket)) return undefined;
  return ticket;
}

export function ticketMirrorFromLive(ticket: LiveInboxTicket): InboxTicketMirror {
  return {
    title: ticket.name,
    notes: ticket.description,
    priority: ticket.priority,
    dueDate: ticket.dueDate ?? null,
  };
}

export function ticketMirrorFromDigest(
  digest: ProjectTicketDigest,
  item: InboxItem
): InboxTicketMirror {
  return {
    title: digest.name,
    notes: digest.description ?? item.notes,
    priority: digest.priority,
    dueDate: digest.dueDate !== undefined ? digest.dueDate : item.dueDate,
  };
}

export function applyInboxMirror(item: InboxItem, mirror: InboxTicketMirror): InboxItem {
  return {
    ...item,
    title: mirror.title,
    notes: mirror.notes,
    priority: mirror.priority,
    dueDate: mirror.dueDate,
  };
}

function digestIsNewer(digestUpdatedAt: string, itemUpdatedAt: string): boolean {
  const digestMs = Date.parse(digestUpdatedAt);
  const itemMs = Date.parse(itemUpdatedAt);
  if (Number.isNaN(digestMs) || Number.isNaN(itemMs)) return false;
  return digestMs > itemMs;
}

/**
 * After assign, the ticket is the durable record. The inbox row is a pointer
 * plus a live mirror: the open project's draft wins (unsaved PM edits
 * included), then a *newer* overview digest, then whatever the inbox stored.
 */
export function mirroredInboxItem(
  item: InboxItem,
  overview: Record<string, ProjectPmOverview>,
  live?: LiveInboxTickets
): InboxItem {
  if (item.projectPath === null) return item;

  const liveTicket = liveTicketFor(item, live);
  if (liveTicket) return applyInboxMirror(item, ticketMirrorFromLive(liveTicket));

  const digest = overview[item.projectPath]?.tickets.find(
    (candidate) => candidate.id === item.ticketId
  );
  if (digest && digestIsNewer(digest.updatedAt, item.updatedAt)) {
    return applyInboxMirror(item, ticketMirrorFromDigest(digest, item));
  }
  return item;
}

export function inboxPatchFromMirror(
  item: InboxItem,
  mirror: InboxTicketMirror
): InboxItemPatch | null {
  const patch: InboxItemPatch = {};
  if (mirror.title !== item.title) patch.title = mirror.title;
  if (mirror.notes !== item.notes) patch.notes = mirror.notes;
  if (mirror.priority !== item.priority) patch.priority = mirror.priority;
  if (mirror.dueDate !== item.dueDate) patch.dueDate = mirror.dueDate;
  return Object.keys(patch).length === 0 ? null : patch;
}

/** Persist ticket → inbox only when the project db is ahead of the inbox row. */
export function inboxPatchFromNewerDigest(
  item: InboxItem,
  digest: ProjectTicketDigest
): InboxItemPatch | null {
  if (!digestIsNewer(digest.updatedAt, item.updatedAt)) return null;
  return inboxPatchFromMirror(item, ticketMirrorFromDigest(digest, item));
}

export function ticketUpdatesFromInboxPatch(patch: InboxItemPatch): Partial<PmTicket> {
  const updates: Partial<PmTicket> = {};
  if (patch.title !== undefined) updates.name = patch.title;
  if (patch.notes !== undefined) updates.description = patch.notes;
  if (patch.priority !== undefined) updates.priority = patch.priority;
  if (patch.dueDate !== undefined) updates.dueDate = patch.dueDate;
  return updates;
}
