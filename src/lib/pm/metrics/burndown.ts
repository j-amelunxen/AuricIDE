import {
  type HistoryEntry,
  type TicketInfo,
  type BurndownPoint,
  type BurndownOptions,
  DAY_MS,
  DISCARDED_STATUS,
} from './types';
import { parseHistoryTime, startOfUtcDay, utcDay } from './time';
import { finalCompletions } from './ticketMetrics';

export function computeBurndown(
  history: HistoryEntry[],
  tickets: TicketInfo[],
  options: BurndownOptions = {}
): BurndownPoint[] {
  if (history.length === 0) return [];

  const { trailingDays, forecastDays = 0, throughputPerDay = 0, now = Date.now() } = options;

  const stamps = history.map((e) => parseHistoryTime(e.changedAt));
  const firstDay = startOfUtcDay(Math.min(...stamps));
  // The line runs to today even when nothing has moved since: a burndown that
  // stops at the last event reads as if the project stopped there too.
  const lastDay = Math.max(startOfUtcDay(Math.max(...stamps)), startOfUtcDay(now));

  const liveIds = new Set(tickets.filter((t) => t.status !== DISCARDED_STATUS).map((t) => t.id));

  // Scope per day: a ticket counts from the day it was created. Tickets whose
  // creation predates the history (or was never recorded) count from day one.
  const createdPerDay = new Map<string, number>();
  let scopeBeforeHistory = liveIds.size;
  for (const entry of history) {
    if (entry.fromStatus !== null || !liveIds.has(entry.ticketId)) continue;
    const day = utcDay(parseHistoryTime(entry.changedAt));
    createdPerDay.set(day, (createdPerDay.get(day) ?? 0) + 1);
    scopeBeforeHistory--;
  }

  const completionsPerDay = new Map<string, number>();
  for (const completion of finalCompletions(history, tickets).values()) {
    const day = utcDay(completion.at);
    completionsPerDay.set(day, (completionsPerDay.get(day) ?? 0) + 1);
  }

  const points: BurndownPoint[] = [];
  let scope = scopeBeforeHistory;
  let completed = 0;
  for (let ms = firstDay; ms <= lastDay; ms += DAY_MS) {
    const date = utcDay(ms);
    scope += createdPerDay.get(date) ?? 0;
    completed += completionsPerDay.get(date) ?? 0;
    points.push({ date, scope, remaining: scope - completed, forecast: null, completed });
  }

  const real = trailingDays !== undefined ? points.slice(-trailingDays) : points;

  if (forecastDays <= 0 || throughputPerDay <= 0 || real.length === 0) return real;

  // The forecast starts where the real line is, so the two meet rather than
  // running as two disconnected series.
  const last = real[real.length - 1];
  let remaining = last.remaining ?? 0;
  last.forecast = remaining;

  const forecast: BurndownPoint[] = [];
  let ms = Date.parse(`${last.date}T00:00:00Z`);
  for (let i = 0; i < forecastDays; i++) {
    ms += DAY_MS;
    remaining = Math.max(remaining - throughputPerDay, 0);
    forecast.push({
      date: utcDay(ms),
      scope: last.scope,
      remaining: null,
      completed: last.completed,
      forecast: Math.round(remaining * 100) / 100,
    });
    // The line has landed. Trailing zeroes would stretch the axis by weeks of
    // nothing and make the drop look far shallower than it is.
    if (remaining === 0) break;
  }

  return [...real, ...forecast];
}
