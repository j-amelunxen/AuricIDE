import { isClosedTicketStatus } from './enums';
import type { PmDependency, PmTicket } from './types';

/**
 * The ticket that keeps `ticket` from starting: a dependency target ticket
 * still live (not done, archived or discarded). Null when nothing blocks it.
 * The same rule as MCP `fetch_next_unblocked_task`; the conductor and the
 * goal board both ask this.
 */
export function blockingTicket(
  ticket: Pick<PmTicket, 'id'>,
  dependencies: readonly PmDependency[],
  ticketsById: ReadonlyMap<string, PmTicket>
): PmTicket | null {
  for (const dependency of dependencies) {
    if (dependency.sourceId !== ticket.id || dependency.targetType !== 'ticket') continue;
    const target = ticketsById.get(dependency.targetId);
    if (target && !isClosedTicketStatus(target.status)) return target;
  }
  return null;
}
