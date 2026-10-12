import { nextReviewRound, openReviewCommentsSpawn } from '@/lib/git/reviewComments';
import { watchReviewSpawn } from '@/lib/git/review/reviewSpawnWatch';
import { useStore } from '@/lib/store';

const CHECKLIST_HEADING = 'Comments:';

/**
 * Opens the spawn dialog with one repo's open comments as a checklist. They
 * are marked sent, in the next round, only if the dialog closes with an agent
 * launched on that checklist (`watchReviewSpawn`); cancelling leaves them open.
 */
export function sendReviewComments(repoPath: string, onSent?: () => void): boolean {
  const store = useStore.getState();
  if (!openReviewCommentsSpawn(store, store.reviewComments, repoPath)) return false;
  const round = nextReviewRound(store.reviewComments, repoPath);
  // The checklist part of the prompt identifies the launch: the instructions around it may be edited.
  const prompt = useStore.getState().initialAgentTask;
  const at = prompt.indexOf(CHECKLIST_HEADING);
  const checklist = at === -1 ? prompt : prompt.slice(at);
  watchReviewSpawn(useStore, checklist, () => {
    useStore.getState().markReviewCommentsSent(repoPath, round);
    onSent?.();
  });
  return true;
}

/** Comments that would go out with the next "Request changes". */
export function isOpenComment(comment: { sentInRound?: number; body: string }): boolean {
  return comment.sentInRound === undefined && comment.body.trim() !== '';
}
