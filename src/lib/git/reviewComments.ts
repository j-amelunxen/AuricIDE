import type { SpawnPreset } from '@/lib/agents/spawnDefaults';

export type ReviewCommentSide = 'new' | 'old';

/**
 * One comment of a line's thread. A line can carry several: a reviewer who
 * comes back to a line after its comment went out adds a new one rather than
 * rewriting what the agent was already told.
 */
export interface ReviewComment {
  /** This comment's own id. Records from before threads carry their line key here. */
  id: string;
  repoPath: string;
  filePath: string;
  lineNo: number;
  side: ReviewCommentSide;
  lineContent: string;
  body: string;
  createdAt: number;
  /**
   * The "Request changes" round this comment went out in. Absent while the
   * comment is still open. Sent comments are kept, not deleted, so the review
   * shows what the agent was already told.
   */
  sentInRound?: number;
}

export type ReviewCommentIdentity = Pick<
  ReviewComment,
  'repoPath' | 'filePath' | 'side' | 'lineNo'
>;

/** The thread a comment belongs to: one per repo, file, side and line. */
export function reviewLineKey(identity: ReviewCommentIdentity): string {
  return `${identity.repoPath}\0${identity.filePath}\0${identity.side}\0${identity.lineNo}`;
}

let idCounter = 0;

/** A fresh comment id. Never shaped like a line key, so it cannot clash with an older record. */
export function newReviewCommentId(): string {
  idCounter += 1;
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `rc-${random}-${idCounter.toString(36)}`;
}

export function sortReviewComments(comments: ReviewComment[]): ReviewComment[] {
  return [...comments].sort((a, b) => {
    const file = a.filePath.localeCompare(b.filePath);
    if (file !== 0) return file;
    if (a.lineNo !== b.lineNo) return a.lineNo - b.lineNo;
    if (a.side !== b.side) return a.side === 'old' ? -1 : 1;
    // One thread: in the order it was written.
    return a.createdAt - b.createdAt;
  });
}

function isOpen(comment: ReviewComment): boolean {
  return comment.sentInRound === undefined;
}

/** Marks one repo's open, non-blank comments as sent in `round`. Untouched comments keep their identity. */
export function markCommentsSent(
  comments: ReviewComment[],
  repoPath: string,
  round: number
): ReviewComment[] {
  let changed = false;
  const next = comments.map((comment) => {
    if (comment.repoPath !== repoPath || !isOpen(comment) || !comment.body.trim()) return comment;
    changed = true;
    return { ...comment, sentInRound: round };
  });
  return changed ? next : comments;
}

/** One past the highest round this repo has sent; 1 when nothing was sent yet. */
export function nextReviewRound(comments: ReviewComment[], repoPath: string): number {
  let last = 0;
  for (const comment of comments) {
    if (comment.repoPath === repoPath && comment.sentInRound !== undefined) {
      last = Math.max(last, comment.sentInRound);
    }
  }
  return last + 1;
}

/**
 * The checklist prompt. Comments sent in an earlier round are left out. Every
 * open comment of a thread is its own item, each quoting the line.
 */
export function buildReviewCommentsPrompt(comments: ReviewComment[]): string {
  const ordered = sortReviewComments(comments.filter(isOpen));
  const items = ordered
    .map((comment, index) => {
      const side = comment.side === 'new' ? 'new file' : 'old file';
      return [
        `${index + 1}. \`${comment.filePath}:${comment.lineNo}\` (${side})`,
        `   Code: \`${comment.lineContent}\``,
        `   Comment: ${comment.body}`,
      ].join('\n');
    })
    .join('\n\n');

  return [
    'Work through these git-review comments as a checklist, in this exact order.',
    '',
    'For each comment:',
    '- Apply the requested change in the named file.',
    '- Use the quoted line to find the spot if line numbers have drifted.',
    '- Say briefly what you changed, then move to the next comment.',
    '- Do not skip a comment. If you cannot apply one, say why and continue.',
    '',
    'When the list is done, summarize what you did and what you could not do.',
    '',
    'Comments:',
    '',
    items,
  ].join('\n');
}

export interface ReviewCommentSpawnStore {
  setSpawnAgentTicketId: (id: null) => void;
  setSpawnAgentGoalId: (id: null) => void;
  setSpawnAgentPreset: (preset: SpawnPreset | null) => void;
  setInitialAgentTask: (task: string) => void;
  setSpawnAgentRepoPath: (path: string) => void;
  setSpawnDialogOpen: (open: boolean) => void;
}

/**
 * Opens the spawn dialog with a checklist prompt for one repo's open comments.
 * It does not mark them sent: the dialog can still be cancelled. The caller
 * applies `markCommentsSent` once the agent is actually launched.
 */
export function openReviewCommentsSpawn(
  store: ReviewCommentSpawnStore,
  comments: ReviewComment[],
  repoPath: string
): boolean {
  const scoped = sortReviewComments(
    comments.filter(
      (comment) => comment.repoPath === repoPath && isOpen(comment) && comment.body.trim()
    )
  );
  if (scoped.length === 0) return false;
  store.setSpawnAgentTicketId(null);
  store.setSpawnAgentGoalId(null);
  store.setSpawnAgentPreset(null);
  store.setInitialAgentTask(buildReviewCommentsPrompt(scoped));
  store.setSpawnAgentRepoPath(repoPath);
  store.setSpawnDialogOpen(true);
  return true;
}
