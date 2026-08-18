import { isClosedTicketStatus, type TicketStatus } from '@/lib/pm/enums';
import type { InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';

export interface LiveInboxTickets {
  projectPath: string | null;
  tickets: Array<{ id: string; status: TicketStatus }>;
}

/**
 * Done, archived and discarded tickets have left the inbox's job. Anything
 * else — including `unknown`, which means we could not read the project — stays.
 */
export function isSettledInboxTicketStatus(status: TicketStatus | 'unknown'): boolean {
  return status !== 'unknown' && isClosedTicketStatus(status);
}

/**
 * Live draft of the open project, when the item actually belongs there.
 * Missing from the draft list is "not ours / not loaded", never settled —
 * an empty `pmDraftTickets` before `loadPmData` must not empty the inbox.
 */
export function liveTicketStatusFor(
  item: Pick<InboxItem, 'ticketId' | 'projectPath'>,
  live: LiveInboxTickets | undefined
): TicketStatus | undefined {
  if (
    live === undefined ||
    live.projectPath === null ||
    item.projectPath === null ||
    item.ticketId === null ||
    live.projectPath !== item.projectPath
  ) {
    return undefined;
  }
  return live.tickets.find((ticket) => ticket.id === item.ticketId)?.status;
}

/**
 * The ticket's live status, resolved against the project overview:
 * - a live draft status from the open project wins (the Rückkanal)
 * - found in the overview's (non-done) ticket list → that status
 * - overview loaded, readable, ticket absent → 'done' (the overview only
 *   carries non-done tickets, so a missing one has to have finished)
 * - no overview loaded, or the overview's read failed → 'unknown'
 */
export function resolveInboxTicketStatus(
  item: Pick<InboxItem, 'ticketId' | 'projectPath'>,
  overview: ProjectPmOverview | undefined,
  liveStatus?: TicketStatus
): TicketStatus | 'unknown' {
  if (liveStatus !== undefined) return liveStatus;
  if (overview === undefined || overview.error !== null) return 'unknown';
  const ticket = overview.tickets.find((candidate) => candidate.id === item.ticketId);
  if (ticket) return ticket.status;
  return overview.hasDb ? 'done' : 'unknown';
}

export function isActiveInboxItem(
  item: InboxItem,
  overview: ProjectPmOverview | undefined,
  liveStatus?: TicketStatus
): boolean {
  if (item.projectPath === null) return true;
  return !isSettledInboxTicketStatus(resolveInboxTicketStatus(item, overview, liveStatus));
}

/** Items that should still be shown: unsorted captures plus unfinished tickets. */
export function activeInboxItems(
  items: InboxItem[],
  overview: Record<string, ProjectPmOverview>,
  live?: LiveInboxTickets
): InboxItem[] {
  return items.filter((item) =>
    isActiveInboxItem(
      item,
      item.projectPath === null ? undefined : overview[item.projectPath],
      liveTicketStatusFor(item, live)
    )
  );
}

/**
 * Assigned items the *persisted* overview can confirm as finished.
 * Used to auto-dismiss — live drafts are ignored so a discarded PM edit
 * cannot delete an inbox row that the project database never archived.
 */
export function settledInboxItems(
  items: InboxItem[],
  overview: Record<string, ProjectPmOverview>
): InboxItem[] {
  return items.filter((item) => {
    if (item.projectPath === null) return false;
    const status = resolveInboxTicketStatus(item, overview[item.projectPath]);
    return isSettledInboxTicketStatus(status);
  });
}
