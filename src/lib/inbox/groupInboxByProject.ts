import type { TicketStatus } from '@/lib/pm/enums';
import type { InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';

export interface GroupedInboxItem {
  item: InboxItem;
  /**
   * The ticket's live status, resolved against the project overview:
   * - found in the overview's (non-done) ticket list → that status
   * - overview loaded, readable, ticket absent → 'done' (the overview only
   *   carries non-done tickets, so a missing one has to have finished)
   * - no overview loaded for the project, or the overview's read failed
   *   (`error !== null`) → 'unknown'. `hasDb` alone is not enough: a project
   *   db can exist and still fail to read (unreadable file, unknown schema),
   *   which leaves `tickets` empty the same way a truly finished ticket
   *   would — without the error check that read failure was reported as a
   *   confident 'done'.
   */
  ticketStatus: TicketStatus | 'unknown';
}

export interface InboxProjectGroup {
  projectPath: string;
  projectName: string;
  overview: ProjectPmOverview | undefined;
  items: GroupedInboxItem[];
}

function resolveTicketStatus(
  item: InboxItem,
  overview: ProjectPmOverview | undefined
): TicketStatus | 'unknown' {
  if (overview === undefined || overview.error !== null) return 'unknown';
  const ticket = overview.tickets.find((candidate) => candidate.id === item.ticketId);
  if (ticket) return ticket.status;
  return overview.hasDb ? 'done' : 'unknown';
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
      };
      groups.set(item.projectPath, group);
    }

    group.items.push({ item, ticketStatus: resolveTicketStatus(item, group.overview) });
  }

  return [...groups.values()].sort((a, b) => a.projectName.localeCompare(b.projectName));
}
