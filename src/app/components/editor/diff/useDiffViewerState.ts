'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  applyDiffLineEdit,
  canEditStagedAgainstWorktree,
  isEditableDiffSource,
  reloadDiffPatch,
} from '@/lib/git/applyLineEdit';
import { openReviewCommentsSpawn } from '@/lib/git/reviewComments';
import { useStore } from '@/lib/store';
import { parseDiff } from '@/lib/git/parseDiff';
import {
  hunkCountOf,
  type CommentTarget,
  type DiffViewerProps,
  type EditSession,
  type LineCommentApi,
  type LineEditApi,
} from './types';

export function useDiffViewerState({ diff, fileName, repoPath, source }: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<'unified' | 'side-by-side'>('side-by-side');
  const [activeHunk, setActiveHunk] = useState(0);
  const [edit, setEdit] = useState<EditSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [commentDraft, setCommentDraft] = useState<CommentTarget | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const lines = parseDiff(diff);
  const hunkCount = hunkCountOf(lines);

  const fileStatus = useStore((s) => {
    if (!repoPath) return undefined;
    return s.repoStates[repoPath]?.fileStatuses.find((f) => f.path === fileName);
  });
  const canEditFile =
    !!repoPath &&
    !!source &&
    isEditableDiffSource(source) &&
    (source.kind !== 'staged' || canEditStagedAgainstWorktree(fileStatus));

  const startEdit = useCallback(
    (lineNo: number, content: string) => {
      if (!canEditFile) return;
      setEdit({ lineNo, draft: content, original: content });
    },
    [canEditFile]
  );

  const setDraft = useCallback((draft: string) => {
    setEdit((current) => (current ? { ...current, draft } : current));
  }, []);

  const cancelEdit = useCallback(() => {
    if (saving) return;
    setEdit(null);
  }, [saving]);

  const commitEdit = useCallback(async () => {
    if (!edit || !repoPath || !source || saving) return;
    if (edit.draft === edit.original) {
      setEdit(null);
      return;
    }
    setSaving(true);
    try {
      await applyDiffLineEdit({
        repoPath,
        filePath: fileName,
        lineNo: edit.lineNo,
        expected: edit.original,
        nextText: edit.draft,
        restage: source.kind === 'staged',
      });
      const store = useStore.getState();
      const tabId = store.activeTabId;
      const current = tabId ? store.diffByTabId[tabId] : undefined;
      const patch = await reloadDiffPatch(repoPath, fileName, source);
      if (tabId && current) {
        store.setDiffTab(tabId, { ...current, patch });
      }
      await store.refreshRepoStatus(repoPath);
      setEdit(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useStore.getState().showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  }, [edit, fileName, repoPath, saving, source]);

  const comments = useStore((s) => s.reviewComments);
  const canComment = !!repoPath;

  const startCommentDraft = useCallback((target: CommentTarget) => {
    setCommentDraft(target);
  }, []);

  const cancelCommentDraft = useCallback(() => {
    setCommentDraft(null);
  }, []);

  const saveCommentDraft = useCallback(
    (body: string) => {
      if (!repoPath || !commentDraft) return;
      useStore.getState().upsertReviewComment({
        repoPath,
        filePath: fileName,
        lineNo: commentDraft.lineNo,
        side: commentDraft.side,
        lineContent: commentDraft.lineContent,
        body,
      });
      setCommentDraft(null);
    },
    [commentDraft, fileName, repoPath]
  );

  const removeComment = useCallback((id: string) => {
    useStore.getState().removeReviewComment(id);
  }, []);

  const sendComments = useCallback(() => {
    if (!repoPath) return;
    openReviewCommentsSpawn(useStore.getState(), useStore.getState().reviewComments, repoPath);
  }, [repoPath]);

  const fileComments = useMemo(
    () =>
      comments.filter((comment) => {
        if (!repoPath) return false;
        return comment.repoPath === repoPath && comment.filePath === fileName;
      }),
    [comments, fileName, repoPath]
  );
  const repoCommentCount = repoPath
    ? comments.filter((comment) => comment.repoPath === repoPath && comment.body.trim()).length
    : 0;

  const lineComment = useMemo<LineCommentApi>(
    () => ({
      enabled: canComment,
      comments: fileComments,
      draft: commentDraft,
      startDraft: startCommentDraft,
      cancelDraft: cancelCommentDraft,
      saveDraft: saveCommentDraft,
      removeComment,
    }),
    [
      canComment,
      cancelCommentDraft,
      commentDraft,
      fileComments,
      removeComment,
      saveCommentDraft,
      startCommentDraft,
    ]
  );

  const lineEdit = useMemo<LineEditApi>(
    () => ({
      canEditFile,
      edit,
      saving,
      startEdit,
      setDraft,
      commitEdit,
      cancelEdit,
    }),
    [canEditFile, cancelEdit, commitEdit, edit, saving, setDraft, startEdit]
  );

  const goToHunk = useCallback(
    (index: number) => {
      if (hunkCount === 0) return;
      const next = ((index % hunkCount) + hunkCount) % hunkCount;
      setActiveHunk(next);
      viewerRef.current
        ?.querySelector(`[data-hunk-index="${next}"]`)
        ?.scrollIntoView({ block: 'start' });
    },
    [hunkCount]
  );

  const goToHunkRef = useRef(goToHunk);
  const activeHunkRef = useRef(activeHunk);

  useEffect(() => {
    goToHunkRef.current = goToHunk;
    activeHunkRef.current = activeHunk;
  });

  useEffect(() => {
    let lastNonce = useStore.getState().hunkNavNonce;
    return useStore.subscribe((s) => {
      if (s.hunkNavNonce === lastNonce || !s.hunkNavDirection) return;
      lastNonce = s.hunkNavNonce;
      const current = activeHunkRef.current;
      goToHunkRef.current(s.hunkNavDirection === 'next' ? current + 1 : current - 1);
    });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLTextAreaElement) return;
    if (!event.altKey) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      goToHunk(activeHunk + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      goToHunk(activeHunk - 1);
    }
  };

  return {
    viewMode,
    setViewMode,
    activeHunk,
    lines,
    viewerRef,
    canEditFile,
    canComment,
    repoCommentCount,
    sendComments,
    goToHunk,
    onKeyDown,
    lineComment,
    lineEdit,
  };
}
