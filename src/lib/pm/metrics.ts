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

export interface TicketMetrics {
  ticketId: string;
  /** Last entry into a working state → completion. Null while unfinished. */
  cycleTime: number | null;
  /** Creation → completion. Null while unfinished. */
  leadTime: number | null;
  /** Timestamp of the completion both times above are measured to. */
  completedAt: string | null;
  /** Milliseconds spent in each status the ticket has already left. */
  timeInStatus: Record<string, number>;
  currentStatus: string;
  /** How long the ticket has been sitting where it is now. */
  timeInCurrentStatus: number | null;
  /** When the ticket entered its current status. */
  currentStatusSince: string | null;
}

export interface StatusDuration {
  status: string;
  /** Tickets that have left this status at least once. */
  ticketCount: number;
  totalMs: number;
  averageMs: number;
  medianMs: number;
  longestMs: number;
}

export interface VelocityBasis {
  /** Completed tickets the basis was measured over. */
  sampleSize: number;
  /** Observed throughput. Zero means "not enough to say". */
  ticketsPerDay: number;
  /** Wall-clock the sample spans — shown so a volatile rate explains itself. */
  spanMs: number;
  avgCycleTime: number | null;
  avgLeadTime: number | null;
  from: string | null;
  to: string | null;
}

export interface EpicProjection {
  epicId: string;
  epicName: string;
  totalTickets: number;
  completedTickets: number;
  remainingTickets: number;
  /** Tickets per week, restated from the basis for readability. */
  avgVelocity: number;
  estimatedDaysRemaining: number | null;
  /** Calendar day `YYYY-MM-DD`, only when a reference point was given. */
  estimatedCompletionDate: string | null;
}

export interface ProjectProjection {
  totalTickets: number;
  completedTickets: number;
  remainingTickets: number;
  estimatedDaysRemaining: number | null;
  estimatedCompletionDate: string | null;
}

export interface BurndownPoint {
  date: string;
  /** Tickets that existed on that day — scope grows as tickets are created. */
  scope: number;
  /** Null on forecast days: nothing is known about the future. */
  remaining: number | null;
  completed: number;
  /** The projected line. Null where no forecast is being made. */
  forecast: number | null;
}

export interface BurndownOptions {
  /** Keep only the last N calendar days of the real line. */
  trailingDays?: number;
  /** Days to project past today. Needs `throughputPerDay`. */
  forecastDays?: number;
  throughputPerDay?: number;
  /** Reference "now", so the line reaches today. Defaults to the clock. */
  now?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The two statuses that end a ticket's life as finished work. */
const COMPLETED_STATUSES = new Set(['done', 'archived']);

/** Cancelled work leaves remaining counts without counting as a completion. */
const DISCARDED_STATUS = 'discarded';

/** Statuses a ticket is actively worked in — where cycle time starts counting. */
const WORKING_STATUSES = new Set(['in_progress']);

/** Reading order for the time-in-state table. Unknown statuses sort after these. */
const STATUS_ORDER = [
  'open',
  'in_progress',
  'to_test',
  'in_review',
  'blocked',
  'done',
  'archived',
  'discarded',
];

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * SQLite's `datetime('now')` writes `YYYY-MM-DD HH:MM:SS` in UTC, but JS parses
 * that shape as local time. Differences between two such stamps still come out
 * right, so this only started mattering once durations were measured against
 * the clock — those were off by the machine's offset.
 */
export function parseHistoryTime(value: string): number {
  const sqlite = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(value);
  if (sqlite) return Date.parse(`${sqlite[1]}T${sqlite[2]}${sqlite[3] ?? ''}Z`);
  return Date.parse(value);
}

/**
 * The UTC calendar day a timestamp falls on. Walking days by `setDate` moves in
 * local time, which loses an hour at a DST switch and from then on labels every
 * day one short — so day arithmetic here stays in UTC milliseconds throughout.
 */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function startOfUtcDay(ms: number): number {
  return Date.parse(`${utcDay(ms)}T00:00:00Z`);
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
// Shared history shaping
// ---------------------------------------------------------------------------

interface TimedEntry extends HistoryEntry {
  at: number;
}

/** Ticket id → its entries, oldest first. Equal stamps keep their given order. */
function groupByTicket(history: HistoryEntry[]): Map<string, TimedEntry[]> {
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
function finalCompletions(
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

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ---------------------------------------------------------------------------
// computeTicketMetrics
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// computeStatusDurations
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// computeVelocityBasis
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// computeVelocity
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// computeBurndown
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// computeEpicProjections
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// computeProjectProjection
// ---------------------------------------------------------------------------

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
