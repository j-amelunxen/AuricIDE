import {
  type HistoryEntry,
  type TicketInfo,
  type EpicInfo,
  type VelocityBasis,
  type EpicProjection,
  type ProjectProjection,
  DAY_MS,
  COMPLETED_STATUSES,
  DISCARDED_STATUS,
} from './types';
import { utcDay, startOfUtcDay, mean } from './time';
import { finalCompletions, computeTicketMetrics } from './ticketMetrics';

/**
 * The sample every estimate is built from: the last `lastNTickets` completed
 * tickets, or all of them.
 *
 * Throughput is the inter-arrival rate across the sample — N completions leave
 * N-1 intervals. Counting the completions themselves would overstate it, since
 * the window is bounded by a completion at each end.
 *
 * The window is floored at one day, and that floor is doing real work: clearing
 * a backlog by archiving five tickets in five minutes is a rate of 1400 a day
 * on paper, which would project any project to finish tomorrow. A day is the
 * finest period a daily rate can honestly claim, so a burst reports "five in a
 * day" instead. `spanMs` travels with the rate so a short window is visible
 * rather than merely survivable.
 */
export function computeVelocityBasis(
  history: HistoryEntry[],
  tickets: TicketInfo[],
  lastNTickets?: number
): VelocityBasis {
  const completions = [...finalCompletions(history, tickets).entries()]
    .map(([ticketId, c]) => ({ ticketId, ...c }))
    .sort((a, b) => a.at - b.at);

  const sample =
    lastNTickets !== undefined && lastNTickets > 0 ? completions.slice(-lastNTickets) : completions;

  if (sample.length === 0) {
    return {
      sampleSize: 0,
      ticketsPerDay: 0,
      spanMs: 0,
      avgCycleTime: null,
      avgLeadTime: null,
      from: null,
      to: null,
    };
  }

  const spanMs = sample[sample.length - 1].at - sample[0].at;
  const spanDays = Math.max(spanMs / DAY_MS, 1);
  const ticketsPerDay = sample.length >= 2 ? (sample.length - 1) / spanDays : 0;

  const sampledIds = new Set(sample.map((s) => s.ticketId));
  const sampledMetrics = computeTicketMetrics(
    history,
    tickets.filter((t) => sampledIds.has(t.id))
  );

  return {
    sampleSize: sample.length,
    ticketsPerDay,
    spanMs,
    avgCycleTime: mean(
      sampledMetrics.map((m) => m.cycleTime).filter((v): v is number => v !== null)
    ),
    avgLeadTime: mean(sampledMetrics.map((m) => m.leadTime).filter((v): v is number => v !== null)),
    from: sample[0].changedAt,
    to: sample[sample.length - 1].changedAt,
  };
}

/**
 * Completions bucketed into fixed periods, aligned to UTC day boundaries so the
 * bars line up with calendar days rather than with the first completion's
 * time of day.
 */
export function computeVelocity(
  history: HistoryEntry[],
  tickets: TicketInfo[],
  periodDays = 7,
  now: number = Date.now()
): { periodStart: string; periodEnd: string; completed: number }[] {
  const timestamps = [...finalCompletions(history, tickets).values()].map((c) => c.at);
  if (timestamps.length === 0) return [];

  const periodMs = periodDays * DAY_MS;
  const maxTime = Math.max(Math.max(...timestamps), now);
  const results: { periodStart: string; periodEnd: string; completed: number }[] = [];

  let periodStart = startOfUtcDay(Math.min(...timestamps));
  while (periodStart <= maxTime) {
    const periodEnd = periodStart + periodMs;
    results.push({
      periodStart: new Date(periodStart).toISOString(),
      periodEnd: new Date(periodEnd).toISOString(),
      completed: timestamps.filter((t) => t >= periodStart && t < periodEnd).length,
    });
    periodStart = periodEnd;
  }

  return results;
}

function estimateDays(remaining: number, ticketsPerDay: number): number | null {
  if (remaining === 0) return 0;
  if (ticketsPerDay <= 0) return null;
  return Math.ceil(remaining / ticketsPerDay);
}

export function computeEpicProjections(
  history: HistoryEntry[],
  tickets: TicketInfo[],
  epics: EpicInfo[],
  basis?: VelocityBasis,
  now?: number
): EpicProjection[] {
  const velocity = basis ?? computeVelocityBasis(history, tickets);

  return epics.map((epic) => {
    const epicTickets = tickets.filter((t) => t.epicId === epic.id);
    const completedTickets = epicTickets.filter((t) => COMPLETED_STATUSES.has(t.status)).length;
    const remainingTickets = epicTickets.filter(
      (t) => !COMPLETED_STATUSES.has(t.status) && t.status !== DISCARDED_STATUS
    ).length;
    const estimatedDaysRemaining = estimateDays(remainingTickets, velocity.ticketsPerDay);

    return {
      epicId: epic.id,
      epicName: epic.name,
      totalTickets: epicTickets.length,
      completedTickets,
      remainingTickets,
      avgVelocity: velocity.ticketsPerDay * 7,
      estimatedDaysRemaining,
      estimatedCompletionDate:
        now !== undefined && estimatedDaysRemaining !== null
          ? utcDay(now + estimatedDaysRemaining * DAY_MS)
          : null,
    };
  });
}

/**
 * The whole project on one basis. Deliberately not the sum of the epic
 * estimates: each of those assumes the full throughput is aimed at it, so
 * adding them up would describe working the epics strictly one after another.
 */
export function computeProjectProjection(
  tickets: TicketInfo[],
  basis: VelocityBasis,
  now?: number
): ProjectProjection {
  const completedTickets = tickets.filter((t) => COMPLETED_STATUSES.has(t.status)).length;
  const remainingTickets = tickets.filter(
    (t) => !COMPLETED_STATUSES.has(t.status) && t.status !== DISCARDED_STATUS
  ).length;
  const estimatedDaysRemaining = estimateDays(remainingTickets, basis.ticketsPerDay);

  return {
    totalTickets: tickets.length,
    completedTickets,
    remainingTickets,
    estimatedDaysRemaining,
    estimatedCompletionDate:
      now !== undefined && estimatedDaysRemaining !== null
        ? utcDay(now + estimatedDaysRemaining * DAY_MS)
        : null,
  };
}
