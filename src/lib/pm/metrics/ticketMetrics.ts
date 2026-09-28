import {
  type HistoryEntry,
  type TicketInfo,
  type TicketMetrics,
  type StatusDuration,
  COMPLETED_STATUSES,
  WORKING_STATUSES,
  STATUS_ORDER,
} from './types';
import { parseHistoryTime, mean, median } from './time';
import { type LifecycleModel, type TimedChange, computeLifecycle, toTimed } from './lifecycle';

/** Ticket id → its entries, oldest first. Equal stamps keep their given order. */
export function groupByTicket(history: HistoryEntry[]): Map<string, TimedChange[]> {
  const byTicket = new Map<string, HistoryEntry[]>();
  history.forEach((entry) => {
    const list = byTicket.get(entry.ticketId) ?? [];
    list.push(entry);
    byTicket.set(entry.ticketId, list);
  });
  return new Map([...byTicket].map(([id, list]) => [id, toTimed(list)]));
}

/**
 * When each ticket reached its final completion — a ticket that was reopened and
 * finished again counts once, at the later time. Only tickets that are currently
 * completed are included: a completion that has since been undone did not happen.
 */
export function finalCompletions(
  history: HistoryEntry[],
  tickets: TicketInfo[]
): Map<string, { at: number; changedAt: string }> {
  const currentlyDone = new Set(
    tickets.filter((t) => COMPLETED_STATUSES.has(t.status)).map((t) => t.id)
  );
  const result = new Map<string, { at: number; changedAt: string }>();

  for (const entry of history) {
    if (!COMPLETED_STATUSES.has(entry.toStatus)) continue;
    if (!currentlyDone.has(entry.ticketId)) continue;
    const at = parseHistoryTime(entry.changedAt);
    const known = result.get(entry.ticketId);
    if (!known || at >= known.at) {
      result.set(entry.ticketId, { at, changedAt: entry.changedAt });
    }
  }
  return result;
}

/** Where a ticket's cycle starts: its last entry into a working status. */
const TICKET_LIFECYCLE: LifecycleModel = {
  completed: COMPLETED_STATUSES,
  cycleStart: (untilCompletion) =>
    untilCompletion.filter((e) => WORKING_STATUSES.has(e.toStatus)).at(-1),
};

/**
 * Per-ticket timing. `now` exists so the "still sitting here" figures can be
 * pinned in tests; it defaults to the clock.
 */
export function computeTicketMetrics(
  history: HistoryEntry[],
  tickets: TicketInfo[],
  now: number = Date.now()
): TicketMetrics[] {
  const byTicket = groupByTicket(history);
  return tickets.map((ticket) => ({
    ticketId: ticket.id,
    ...computeLifecycle(byTicket.get(ticket.id) ?? [], ticket.status, TICKET_LIFECYCLE, now),
  }));
}

/**
 * How long tickets sit in each status, across the whole project. Only closed
 * spells count — a status nobody has left yet has no duration to report.
 */
export function computeStatusDurations(
  history: HistoryEntry[],
  tickets: TicketInfo[]
): StatusDuration[] {
  const perStatus = new Map<string, number[]>();

  for (const metrics of computeTicketMetrics(history, tickets)) {
    for (const [status, ms] of Object.entries(metrics.timeInStatus)) {
      const list = perStatus.get(status) ?? [];
      list.push(ms);
      perStatus.set(status, list);
    }
  }

  return [...perStatus.entries()]
    .map(([status, durations]) => ({
      status,
      ticketCount: durations.length,
      totalMs: durations.reduce((sum, d) => sum + d, 0),
      averageMs: mean(durations) ?? 0,
      medianMs: median(durations),
      longestMs: Math.max(...durations),
    }))
    .sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a.status);
      const bi = STATUS_ORDER.indexOf(b.status);
      if (ai !== bi)
        return (ai < 0 ? STATUS_ORDER.length : ai) - (bi < 0 ? STATUS_ORDER.length : bi);
      return a.status.localeCompare(b.status);
    });
}
