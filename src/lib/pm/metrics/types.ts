// ---------------------------------------------------------------------------
// Types and constants for project management metrics
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  ticketId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
}

export interface TicketInfo {
  id: string;
  epicId: string;
  status: string;
}

export interface EpicInfo {
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

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The two statuses that end a ticket's life as finished work. */
export const COMPLETED_STATUSES = new Set(['done', 'archived']);

/** Cancelled work leaves remaining counts without counting as a completion. */
export const DISCARDED_STATUS = 'discarded';

/** Statuses a ticket is actively worked in — where cycle time starts counting. */
export const WORKING_STATUSES = new Set(['in_progress']);

/** Reading order for the time-in-state table. Unknown statuses sort after these. */
export const STATUS_ORDER = [
  'open',
  'in_progress',
  'to_test',
  'in_review',
  'blocked',
  'done',
  'archived',
  'discarded',
];
