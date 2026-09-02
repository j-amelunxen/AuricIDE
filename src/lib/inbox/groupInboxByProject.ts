import type { TicketStatus } from '@/lib/pm/enums';
import type { InboxItem, ProjectPmOverview, ProjectTicketDigest } from '@/lib/tauri/inbox';
import { resolveInboxTicketStatus } from './inboxTicketStatus';

export interface GroupedInboxItem {
  item: InboxItem;
  /**
   * The ticket's live status, resolved against the project overview.
   * See {@link resolveInboxTicketStatus} for the missing-ticket rule.
   */
  ticketStatus: TicketStatus | 'unknown';
}

export interface InboxProjectGroup {
  projectPath: string;
  projectName: string;
  overview: ProjectPmOverview | undefined;
  items: GroupedInboxItem[];
  /** Live tickets in this project that did not come from the inbox. */
  otherTickets: ProjectTicketDigest[];
}

/** Assigned inbox items, grouped by project and sorted by project name. */
export function groupInboxByProject(
  items: InboxItem[],
  overview: Record<string, ProjectPmOverview>
): InboxProjectGroup[] {
  const groups = new Map<string, InboxProjectGroup>();

  for (const item of items) {
    if (item.projectPath === null) continue;

    let group = groups.get(item.projectPath);
    if (!group) {
      group = {
        projectPath: item.projectPath,
        projectName: item.projectName ?? item.projectPath,
        overview: overview[item.projectPath],
        items: [],
        otherTickets: [],
      };
      groups.set(item.projectPath, group);
    }

    group.items.push({
      item,
      ticketStatus: resolveInboxTicketStatus(item, group.overview),
    });
  }

  for (const group of groups.values()) {
    const inboxTicketIds = new Set(
      group.items.map((entry) => entry.item.ticketId).filter((id): id is string => id !== null)
    );
    group.otherTickets = (group.overview?.tickets ?? []).filter(
      (ticket) => !inboxTicketIds.has(ticket.id)
    );
  }

  return [...groups.values()].sort((a, b) => a.projectName.localeCompare(b.projectName));
}
