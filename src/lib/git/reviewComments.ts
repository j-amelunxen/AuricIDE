import type { SpawnPreset } from '@/lib/agents/spawnDefaults';

export type ReviewCommentSide = 'new' | 'old';

export interface ReviewComment {
  id: string;
  repoPath: string;
  filePath: string;
  lineNo: number;
  side: ReviewCommentSide;
  lineContent: string;
  body: string;
  createdAt: number;
}

export type ReviewCommentIdentity = Pick<
  ReviewComment,
  'repoPath' | 'filePath' | 'side' | 'lineNo'
>;

export function reviewCommentId(identity: ReviewCommentIdentity): string {
  return `${identity.repoPath}\0${identity.filePath}\0${identity.side}\0${identity.lineNo}`;
}

export function sortReviewComments(comments: ReviewComment[]): ReviewComment[] {
  return [...comments].sort((a, b) => {
    const file = a.filePath.localeCompare(b.filePath);
    if (file !== 0) return file;
    if (a.lineNo !== b.lineNo) return a.lineNo - b.lineNo;
    if (a.side === b.side) return 0;
    return a.side === 'old' ? -1 : 1;
  });
}

export function buildReviewCommentsPrompt(comments: ReviewComment[]): string {
  const ordered = sortReviewComments(comments);
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

/** Opens the spawn dialog with a checklist prompt for one repo's comments. */
export function openReviewCommentsSpawn(
  store: ReviewCommentSpawnStore,
  comments: ReviewComment[],
  repoPath: string
): boolean {
  const scoped = sortReviewComments(
    comments.filter((comment) => comment.repoPath === repoPath && comment.body.trim())
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
