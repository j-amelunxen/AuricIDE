import type { TicketStatus } from './enums';

/** Short label for a ticket status — the board's column head, the inbox's chip. */
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'IP',
  to_test: 'To Test',
  in_review: 'Review',
  done: 'Done',
  archived: 'Archived',
  discarded: 'Discarded',
};

/** Background + text classes for a status pill. */
export const TICKET_STATUS_BADGE_CLASS: Record<TicketStatus, string> = {
  open: 'bg-white/10 text-foreground-muted',
  in_progress: 'bg-yellow-500/10 text-git-modified',
  to_test: 'bg-cyan-500/10 text-cyan-300',
  in_review: 'bg-indigo-500/10 text-indigo-300',
  done: 'bg-green-500/10 text-git-added',
  archived: 'bg-purple-500/10 text-purple-400',
  discarded: 'bg-white/5 text-foreground-muted',
};

/** Fill class for a small status dot. */
export const TICKET_STATUS_DOT_CLASS: Record<TicketStatus, string> = {
  open: 'bg-white/25',
  in_progress: 'bg-yellow-400/60',
  to_test: 'bg-cyan-400/60',
  in_review: 'bg-indigo-400/60',
  done: 'bg-green-400/60',
  archived: 'bg-purple-400/60',
  discarded: 'bg-white/20',
};
