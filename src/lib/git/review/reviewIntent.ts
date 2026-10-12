/**
 * The intent header of a review: what the agent behind a change set was asked
 * to do, so the reviewer checks "did it do what was asked" and not only "is
 * this code ok".
 *
 * In an agent worktree the first agent that ran there is the author; later
 * runs are follow-ups to it. A plain repository has seen many agents over
 * time, so there the header can only name the latest one and has to say so.
 * Reviewer agents never count: they read the change, they did not write it.
 */
import { isAuricWorktreePath } from '../agentWorktree';

export interface IntentAgent {
  id: string;
  name: string;
  repoPath?: string;
  startedAt: number;
  currentTask?: string;
  spawnedByTicketId?: string;
  reviewOfTicketId?: string;
}

export interface IntentTicket {
  id: string;
  name: string;
}

export interface ReviewIntent {
  /** `author` in an agent worktree; `latest` where other agents may have written too. */
  relation: 'author' | 'latest';
  agentName: string;
  ticketName: string | null;
  task: string | null;
}

export function reviewIntentFor(
  repoPath: string,
  agents: readonly IntentAgent[],
  tickets: readonly IntentTicket[]
): ReviewIntent | null {
  const writers = agents.filter((a) => a.repoPath === repoPath && !a.reviewOfTicketId);
  if (writers.length === 0) return null;
  const author = isAuricWorktreePath(repoPath);
  const agent = writers.reduce((best, a) =>
    author ? (a.startedAt < best.startedAt ? a : best) : a.startedAt > best.startedAt ? a : best
  );
  const ticket = agent.spawnedByTicketId
    ? tickets.find((t) => t.id === agent.spawnedByTicketId)
    : undefined;
  return {
    relation: author ? 'author' : 'latest',
    agentName: agent.name,
    ticketName: ticket?.name ?? null,
    task: agent.currentTask?.trim() || null,
  };
}
