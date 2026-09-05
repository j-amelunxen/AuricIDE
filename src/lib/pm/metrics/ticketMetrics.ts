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

interface TimedEntry extends HistoryEntry {
  at: number;
}

/** Ticket id → its entries, oldest first. Equal stamps keep their given order. */
export function groupByTicket(history: HistoryEntry[]): Map<string, TimedEntry[]> {
  const byTicket = new Map<string, TimedEntry[]>();
  history.forEach((entry) => {
    const list = byTicket.get(entry.ticketId) ?? [];
    list.push({ ...entry, at: parseHistoryTime(entry.changedAt) });
    byTicket.set(entry.ticketId, list);
  });
  for (const list of byTicket.values()) {
    list.sort((a, b) => a.at - b.at);
  }
  return byTicket;
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

  return tickets.map((ticket) => {
    const entries = byTicket.get(ticket.id) ?? [];

    // Time in each status the ticket has already left. The status it is in now
    // has no closing event, so it is reported on its own rather than guessed at.
    const timeInStatus: Record<string, number> = {};
    for (let i = 0; i < entries.length - 1; i++) {
      const span = entries[i + 1].at - entries[i].at;
      if (span <= 0) continue;
      const status = entries[i].toStatus;
      timeInStatus[status] = (timeInStatus[status] ?? 0) + span;
    }

    const last = entries.at(-1) ?? null;
    const currentStatusSince = last?.changedAt ?? null;
    const timeInCurrentStatus = last ? Math.max(now - last.at, 0) : null;

    // The ticket's last completion — a reopened ticket is measured to the run
    // that actually finished it, never to an earlier one it was pulled back from.
    const completion = COMPLETED_STATUSES.has(ticket.status)
      ? [...entries].reverse().find((e) => COMPLETED_STATUSES.has(e.toStatus))
      : undefined;

    if (!completion) {
      return {
        ticketId: ticket.id,
        cycleTime: null,
        leadTime: null,
        completedAt: null,
        timeInStatus,
        currentStatus: ticket.status,
        timeInCurrentStatus,
        currentStatusSince,
      };
    }

    const creation = entries.find((e) => e.fromStatus === null);
    // The working spell that led to THIS completion, not the first one ever.
    const startedWork = entries
      .filter((e) => WORKING_STATUSES.has(e.toStatus) && e.at <= completion.at)
      .at(-1);

    return {
      ticketId: ticket.id,
      cycleTime: startedWork ? completion.at - startedWork.at : null,
      leadTime: creation ? completion.at - creation.at : null,
      completedAt: completion.changedAt,
      timeInStatus,
      currentStatus: ticket.status,
      timeInCurrentStatus,
      currentStatusSince,
    };
  });
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
