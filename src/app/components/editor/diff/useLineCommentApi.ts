'use client';

import { useCallback, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import type { ReviewComment } from '@/lib/git/reviewComments';
import type { CommentDraft, CommentTarget, LineCommentApi } from './types';

/**
 * The line-comment wiring for one file of one repo: the comments on it and
 * the draft being written. Shared by the diff viewer and every file of a
 * review, so a comment behaves the same wherever it is written.
 */
export function useLineCommentApi(
  repoPath: string | undefined,
  filePath: string,
  /**
   * Called after a draft is saved or cancelled. The composer that had focus is
   * gone by then, so the owner puts focus back on the next decision.
   */
  onDone?: (outcome: 'saved' | 'cancelled') => void
): LineCommentApi {
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const comments = useStore((s) => s.reviewComments);

  const fileComments = useMemo(
    () =>
      repoPath ? comments.filter((c) => c.repoPath === repoPath && c.filePath === filePath) : [],
    [comments, filePath, repoPath]
  );

  const cancelDraft = useCallback(() => {
    setDraft(null);
    onDone?.('cancelled');
  }, [onDone]);

  const saveDraft = useCallback(
    (body: string) => {
      if (!repoPath || !draft) return;
      const store = useStore.getState();
      if (draft.editingId) {
        store.editReviewComment(draft.editingId, body);
      } else {
        store.addReviewComment({
          repoPath,
          filePath,
          lineNo: draft.lineNo,
          side: draft.side,
          lineContent: draft.lineContent,
          body,
        });
      }
      setDraft(null);
      onDone?.('saved');
    },
    [draft, filePath, onDone, repoPath]
  );

  const startDraft = useCallback(
    (target: CommentTarget) =>
      setDraft({ lineNo: target.lineNo, side: target.side, lineContent: target.lineContent }),
    []
  );

  const editComment = useCallback((comment: ReviewComment) => {
    if (comment.sentInRound !== undefined) return;
    setDraft({
      lineNo: comment.lineNo,
      side: comment.side,
      lineContent: comment.lineContent,
      editingId: comment.id,
    });
  }, []);

  const removeComment = useCallback((id: string) => {
    useStore.getState().removeReviewComment(id);
  }, []);

  return useMemo<LineCommentApi>(
    () => ({
      enabled: !!repoPath,
      comments: fileComments,
      draft,
      startDraft,
      editComment,
      cancelDraft,
      saveDraft,
      removeComment,
    }),
    [cancelDraft, draft, editComment, fileComments, removeComment, repoPath, saveDraft, startDraft]
  );
}
