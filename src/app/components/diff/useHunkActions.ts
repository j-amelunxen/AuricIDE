'use client';

import { useCallback, useMemo, useState } from 'react';
import { reloadDiffPatch } from '@/lib/git/applyLineEdit';
import type { DiffSource } from '@/lib/git/diffTab';
import { hunkActionsFor, type HunkAction } from '@/lib/git/hunkPatch';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useStore } from '@/lib/store';
import type { HunkToolbarAction } from './HunkToolbar';

const NO_ACTIONS: HunkAction[] = [];

const S_KEY = { label: 'S', aria: 'S' };
const STAGE = {
  id: 'stage',
  label: 'Stage hunk',
  name: 'Stage hunk',
  icon: 'add',
  shortcut: S_KEY,
};
const UNSTAGE = {
  id: 'unstage',
  label: 'Unstage hunk',
  name: 'Unstage hunk',
  icon: 'remove',
  shortcut: S_KEY,
};
const DISCARD = {
  id: 'discard',
  label: 'Discard hunk',
  name: 'Discard hunk',
  icon: 'undo',
  danger: true,
  shortcut: { label: '⌫', aria: 'Backspace Delete' },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Stage, unstage and discard one hunk of the diff a tab shows
 * (`docs/design-merge-panel.md`, hunk-action table). Discard asks first.
 * Success or refusal, the patch is read again afterwards: a refusal means the
 * file moved on, and the viewer should show where it is now.
 */
export function useHunkActions({
  diff,
  fileName,
  repoPath,
  source,
  afterAction,
}: {
  diff: string;
  fileName: string;
  repoPath?: string;
  source?: DiffSource;
  /** Runs once the action is settled or cancelled; the button that started it may be gone. */
  afterAction?: () => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const available = useMemo(
    () => (repoPath && source ? hunkActionsFor(source, diff) : NO_ACTIONS),
    [diff, repoPath, source]
  );

  const run = useCallback(
    async (hunkIndex: number, action: HunkAction) => {
      if (!repoPath || !source || busy || !available.includes(action)) return;
      if (action === 'discard') {
        const ok = await confirm({
          title: 'Discard hunk',
          message: `Throw away hunk ${hunkIndex + 1} of ${fileName}? Its lines go back to the staged version. This cannot be undone.`,
          confirmLabel: 'Discard hunk',
          variant: 'destroy',
        });
        if (!ok) {
          afterAction?.();
          return;
        }
      }
      // The tab is the one on screen when the action started, and only if it still shows this diff.
      const tabId = useStore.getState().activeTabId;
      setBusy(true);
      try {
        await useStore.getState().applyHunkAction(repoPath, fileName, diff, hunkIndex, action);
      } catch (error) {
        useStore.getState().showToast(errorMessage(error), 'error');
      }
      try {
        const patch = await reloadDiffPatch(repoPath, fileName, source);
        const store = useStore.getState();
        const current = tabId ? store.diffByTabId[tabId] : undefined;
        if (tabId && current && current.repoPath === repoPath && current.filePath === fileName) {
          store.setDiffTab(tabId, { ...current, patch });
        }
      } catch (error) {
        useStore.getState().showToast(`Could not reload the diff: ${errorMessage(error)}`, 'error');
      } finally {
        setBusy(false);
        afterAction?.();
      }
    },
    [afterAction, available, busy, confirm, diff, fileName, repoPath, source]
  );

  const toolbarActions = useCallback(
    (hunkIndex: number): HunkToolbarAction[] =>
      available.map((action) => {
        const onRun = () => void run(hunkIndex, action);
        if (action === 'stage') return { ...STAGE, onRun };
        if (action === 'unstage') return { ...UNSTAGE, onRun };
        return { ...DISCARD, onRun };
      }),
    [available, run]
  );

  return { available, busy, run, toolbarActions, confirmDialog };
}
