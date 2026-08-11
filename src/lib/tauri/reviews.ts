import { invoke } from './invoke';

export interface TicketReview {
  ticketId: string;
  pass: boolean;
  reason: string;
  reviewer: string;
  createdAt: string;
}

export async function pmLatestTicketReview(
  projectPath: string,
  ticketId: string,
  sinceIso?: string
): Promise<TicketReview | null> {
  return await invoke<TicketReview | null>('pm_latest_ticket_review', {
    projectPath,
    ticketId,
    sinceIso,
  });
}
