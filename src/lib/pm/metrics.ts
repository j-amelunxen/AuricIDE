// ---------------------------------------------------------------------------
// Types (local to avoid circular deps)
// ---------------------------------------------------------------------------

interface HistoryEntry {
  ticketId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
}

interface TicketInfo {
  id: string;
  epicId: string;
  status: string;
}

interface EpicInfo {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return '< 1m';
  if (hours < 1) return `${minutes}m`;
  if (days < 1) return `${hours}h ${minutes % 60}m`;
  return `${days}d ${hours % 24}h`;
}

// ---------------------------------------------------------------------------
// computeTicketMetrics
// ---------------------------------------------------------------------------

export function computeTicketMetrics(
  history: HistoryEntry[],
  tickets: TicketInfo[]
): { ticketId: string; cycleTime: number | null; leadTime: number | null }[] {
  const byTicket = new Map<string, HistoryEntry[]>();
  for (const entry of history) {
    const list = byTicket.get(entry.ticketId) ?? [];
    list.push(entry);
    byTicket.set(entry.ticketId, list);
  }

  return tickets.map((ticket) => {
    const entries = byTicket.get(ticket.id) ?? [];

    // Find first creation event (fromStatus is null)
    const creationEvent = entries.find((e) => e.fromStatus === null);
    // Find first in_progress event
    const inProgressEvent = entries.find((e) => e.toStatus === 'in_progress');
    // Find first done event
    const doneEvent = entries.find((e) => e.toStatus === 'done');

    if (!doneEvent) {
      return { ticketId: ticket.id, cycleTime: null, leadTime: null };
    }

    const doneTime = new Date(doneEvent.changedAt).getTime();

    const cycleTime = inProgressEvent
      ? doneTime - new Date(inProgressEvent.changedAt).getTime()
      : null;

    const leadTime = creationEvent ? doneTime - new Date(creationEvent.changedAt).getTime() : null;

    return { ticketId: ticket.id, cycleTime, leadTime };
  });
}

// ---------------------------------------------------------------------------
// computeVelocity
// ---------------------------------------------------------------------------

export function computeVelocity(
  history: HistoryEntry[],
  periodDays = 7
): { periodStart: string; periodEnd: string; completed: number }[] {
  const doneEvents = history.filter((e) => e.toStatus === 'done');
  if (doneEvents.length === 0) return [];

  const timestamps = doneEvents.map((e) => new Date(e.changedAt).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  const periodMs = periodDays * 24 * 60 * 60 * 1000;
  const results: { periodStart: string; periodEnd: string; completed: number }[] = [];

  let periodStart = minTime;
  while (periodStart <= maxTime) {
    const periodEnd = periodStart + periodMs;
    const completed = timestamps.filter((t) => t >= periodStart && t < periodEnd).length;
    results.push({
      periodStart: new Date(periodStart).toISOString(),
      periodEnd: new Date(periodEnd).toISOString(),
      completed,
    });
    periodStart = periodEnd;
  }

  return results;
}

// ---------------------------------------------------------------------------
// computeBurndown
// ---------------------------------------------------------------------------

export function computeBurndown(
  history: HistoryEntry[],
  tickets: TicketInfo[],
  lastN?: number
): { date: string; remaining: number; completed: number }[] {
  if (history.length === 0) return [];

  // Get the date range from history
  const dates = history.map((e) => e.changedAt.slice(0, 10));
  const uniqueDates = [...new Set(dates)].sort();

  if (uniqueDates.length === 0) return [];

  // Fill in all dates between first and last
  const startDate = new Date(uniqueDates[0]);
  const endDate = new Date(uniqueDates[uniqueDates.length - 1]);
  const allDates: string[] = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    allDates.push(d.toISOString().slice(0, 10));
  }

  const totalTickets = tickets.length;
  let completedSoFar = 0;

  // Build a map of date -> number of completions on that date
  const completionsPerDay = new Map<string, number>();
  for (const entry of history) {
    if (entry.toStatus === 'done') {
      const date = entry.changedAt.slice(0, 10);
      completionsPerDay.set(date, (completionsPerDay.get(date) ?? 0) + 1);
    }
  }

  const results: { date: string; remaining: number; completed: number }[] = [];
  for (const date of allDates) {
    completedSoFar += completionsPerDay.get(date) ?? 0;
    results.push({
      date,
      remaining: totalTickets - completedSoFar,
      completed: completedSoFar,
    });
  }

  if (lastN !== undefined) {
    return results.slice(-lastN);
  }

  return results;
}

// ---------------------------------------------------------------------------
// computeEpicProjections
// ---------------------------------------------------------------------------

export function computeEpicProjections(
  history: HistoryEntry[],
  tickets: TicketInfo[],
  epics: EpicInfo[]
): {
  epicId: string;
  epicName: string;
  totalTickets: number;
  completedTickets: number;
  avgVelocity: number;
  estimatedDaysRemaining: number | null;
}[] {
  // Compute overall velocity (tickets completed per week)
  const doneEvents = history.filter((e) => e.toStatus === 'done');
  let avgVelocityPerWeek = 0;

  if (doneEvents.length >= 1) {
    const timestamps = doneEvents.map((e) => new Date(e.changedAt).getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const elapsedWeeks = Math.max((maxTime - minTime) / (7 * 24 * 60 * 60 * 1000), 1);
    avgVelocityPerWeek = doneEvents.length / elapsedWeeks;
  }

  return epics.map((epic) => {
    const epicTickets = tickets.filter((t) => t.epicId === epic.id);
    const totalTickets = epicTickets.length;
    const completedTickets = epicTickets.filter((t) => t.status === 'done').length;
    const remaining = totalTickets - completedTickets;

    let estimatedDaysRemaining: number | null = null;
    if (remaining === 0) {
      estimatedDaysRemaining = 0;
    } else if (avgVelocityPerWeek > 0) {
      const weeksRemaining = remaining / avgVelocityPerWeek;
      estimatedDaysRemaining = Math.ceil(weeksRemaining * 7);
    }

    return {
      epicId: epic.id,
      epicName: epic.name,
      totalTickets,
      completedTickets,
      avgVelocity: avgVelocityPerWeek,
      estimatedDaysRemaining,
    };
  });
}
