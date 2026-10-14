'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  applyDiffLineEdit,
  canEditStagedAgainstWorktree,
  isEditableDiffSource,
  reloadDiffPatch,
} from '@/lib/git/applyLineEdit';
import { riskFlagsForPatch } from '@/lib/git/review/riskFlags';
import { useStore } from '@/lib/store';
import { parseDiff } from '@/lib/git/parseDiff';
import { isOpenComment, sendReviewComments } from './sendReviewComments';
import {
  hunkCommentTarget,
  hunkCountOf,
  type DiffViewerProps,
  type EditSession,
  type LineEditApi,
} from './types';
import { useHunkActions } from './useHunkActions';
import { useLineCommentApi } from './useLineCommentApi';

function isTextEntry(target: EventTarget): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
}

export function useDiffViewerState({ diff, fileName, repoPath, source }: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<'unified' | 'side-by-side'>('side-by-side');
  const [activeHunk, setActiveHunk] = useState(0);
  const [edit, setEdit] = useState<EditSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);
  // A finished hunk action or comment can take the focused control with it; focus goes back to the diff.
  const refocusViewer = useCallback(() => viewerRef.current?.focus(), []);
  const lines = useMemo(() => parseDiff(diff), [diff]);
  const hunkCount = hunkCountOf(lines);
  // After a hunk is staged or discarded there may be fewer: keep the focus on a real one.
  const focusedHunk = Math.min(activeHunk, Math.max(0, hunkCount - 1));
  const riskFlags = useMemo(() => riskFlagsForPatch(fileName, diff), [diff, fileName]);
  const hunkActions = useHunkActions({
    diff,
    fileName,
    repoPath,
    source,
    afterAction: refocusViewer,
  });

  const fileStatus = useStore((s) => {
    if (!repoPath) return undefined;
    return s.repoStates[repoPath]?.fileStatuses.find((f) => f.path === fileName);
  });
  const canEditFile =
    !!repoPath &&
    !!source &&
    isEditableDiffSource(source) &&
    (source.kind !== 'staged' || canEditStagedAgainstWorktree(fileStatus));

  // The lock closes itself when the file can no longer be written (source or status moved on).
  const isUnlocked = unlocked && canEditFile;

  const toggleLock = useCallback(() => {
    if (!canEditFile) return;
    setEdit(null);
    setUnlocked((open) => !open);
  }, [canEditFile]);

  /** Called by the editor once its last write has landed: bring the diff and the repo up to it. */
  const onUnlockedClosed = useCallback(async () => {
    if (!repoPath || !source) return;
    try {
      const store = useStore.getState();
      const tabId = store.activeTabId;
      const current = tabId ? store.diffByTabId[tabId] : undefined;
      const patch = await reloadDiffPatch(repoPath, fileName, source);
      if (tabId && current) store.setDiffTab(tabId, { ...current, patch });
      await store.refreshRepoStatus(repoPath);
      if (source.kind === 'ref') await store.loadCompare(repoPath, source.ref);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useStore.getState().showToast(message, 'error');
    }
  }, [fileName, repoPath, source]);

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

  const lineComment = useLineCommentApi(repoPath, fileName, refocusViewer);
  const canComment = lineComment.enabled;
  const repoCommentCount = useStore((s) =>
    repoPath
      ? s.reviewComments.filter((c) => c.repoPath === repoPath && isOpenComment(c)).length
      : 0
  );

  const sendComments = useCallback(() => {
    if (repoPath) sendReviewComments(repoPath);
  }, [repoPath]);

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
  const activeHunkRef = useRef(focusedHunk);

  useEffect(() => {
    goToHunkRef.current = goToHunk;
    activeHunkRef.current = focusedHunk;
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

  const runHunkKey = (event: KeyboardEvent<HTMLDivElement>): boolean => {
    if (event.altKey || event.metaKey || event.ctrlKey || hunkCount === 0) return false;
    const { available, run } = hunkActions;
    if (event.key === 's' || event.key === 'S') {
      const action = available.find((a) => a !== 'discard');
      if (!action) return false;
      void run(focusedHunk, action);
      return true;
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && available.includes('discard')) {
      void run(focusedHunk, 'discard');
      return true;
    }
    if (event.key === 'c' || event.key === 'C') {
      // The composer focuses itself; Esc and ⌘↵ hand focus back to the diff.
      const target = lineComment.enabled ? hunkCommentTarget(lines, focusedHunk) : null;
      if (!target) return false;
      lineComment.startDraft(target);
      return true;
    }
    return false;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isTextEntry(event.target)) return;
    if (runHunkKey(event)) {
      event.preventDefault();
      return;
    }
    if (!event.altKey) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      goToHunk(focusedHunk + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      goToHunk(focusedHunk - 1);
    }
  };

  return {
    viewMode,
    setViewMode,
    activeHunk: focusedHunk,
    lines,
    riskFlags,
    hunkActions,
    viewerRef,
    canEditFile,
    unlocked: isUnlocked,
    toggleLock,
    onUnlockedClosed,
    canComment,
    repoCommentCount,
    sendComments,
    goToHunk,
    onKeyDown,
    lineComment,
    lineEdit,
  };
}
