'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HunkAction } from '@/lib/git/hunkPatch';
import { isAuricWorktreePath } from '@/lib/git/agentWorktree';
import {
  mapWorktreeHunks,
  unreadableSideTargets,
  type WorktreeHunkTarget,
} from '@/lib/git/review/worktreeHunkMap';
import type { ReviewFile } from '@/lib/git/review/reviewSession';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useStore } from '@/lib/store';
import { discardChanges, getGitDiff } from '@/lib/tauri/git';
import type { HunkToolbarAction } from '@/app/components/editor/diff/HunkToolbar';

interface SidePatches {
  unstaged: string;
  staged: string;
  /** What the patches were read for: the file's hash and the action count. Stale once either moves. */
  key: string;
  /** The read failed; the empty patches above say nothing about the file. */
  failed?: boolean;
}

/** What a hunk or file action ended in, for focus and the live region. `kept`: nothing changed. */
export type ReviewActionOutcome = 'accepted' | 'unaccepted' | 'discarded' | 'kept';

/** The keyboard's way into one file's hunks: `S` and `⌫` on the focused hunk. */
export interface ReviewHunkKeys {
  /** `S`: accept the hunk, or undo the accept. Resolves to what happened. */
  toggleAccept: (hunkIndex: number) => Promise<ReviewActionOutcome>;
  /** `⌫`: discard the hunk after a confirm. */
  discard: (hunkIndex: number) => Promise<ReviewActionOutcome>;
}

const NO_TARGETS: WorktreeHunkTarget[] = [];

const S_KEY = { label: 'S', aria: 'S' };
const DISCARD_KEY = { label: '⌫', aria: 'Backspace Delete' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Accept (stage) and discard for a working-tree review. The session shows the
 * combined patch; the actions run on the unstaged or staged patch, so both
 * are read for an expanded file and each hunk is mapped exactly
 * (`worktreeHunkMap.ts`). After any action the session reloads, so the
 * patches and the mapping are read again.
 */
export interface WorktreeHunksOptions {
  tabId: string;
  repoPath: string;
  file: ReviewFile;
  enabled: boolean;
  onHunkActed?: (hunkIndex: number, outcome: ReviewActionOutcome) => void;
  onFileActed?: (outcome: ReviewActionOutcome) => void;
}

// code-gate: complexity-function-length - one hook per file section: side patches, mapping, hunk and file actions share state
export function useWorktreeHunks(options: WorktreeHunksOptions) {
  const { tabId, repoPath, file, enabled, onHunkActed, onFileActed } = options;
  const { confirm, confirmDialog } = useConfirm();
  const [sides, setSides] = useState<SidePatches | null>(null);
  const [busy, setBusy] = useState(false);
  // Accepting a hunk leaves the combined patch (and its hash) as it was, so actions count separately.
  const [version, setVersion] = useState(0);
  const key = `${file.hash}:${version}`;
  // In an agent worktree the merge commits everything left in it, staged or not, so staging
  // there would be an Accept that changes nothing. Only Discard is offered.
  const canAccept = !isAuricWorktreePath(repoPath);
  const readable = enabled && file.status !== 'conflicted' && !file.loadError;

  useEffect(() => {
    if (!readable) return;
    let cancelled = false;
    Promise.all([
      getGitDiff(repoPath, file.path, 'unstaged'),
      getGitDiff(repoPath, file.path, 'staged'),
    ]).then(
      ([unstaged, staged]) => {
        if (!cancelled) setSides({ unstaged, staged, key });
      },
      () => {
        // Without the side patches there is no exact mapping; whole-file actions remain.
        if (!cancelled) setSides({ unstaged: '', staged: '', key, failed: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [file.path, key, readable, repoPath]);

  const current = sides && sides.key === key ? sides : null;
  const targets = useMemo(() => {
    if (!current) return NO_TARGETS;
    if (current.failed) return unreadableSideTargets(file.patch);
    return mapWorktreeHunks(file.patch, current.unstaged, current.staged);
  }, [current, file.patch]);

  const afterAction = useCallback(async () => {
    setVersion((v) => v + 1);
    // Only this file changed; the rest of the change set is left as it is.
    await useStore.getState().refreshReviewFile(tabId, file.path);
  }, [file.path, tabId]);

  const runHunk = useCallback(
    async (hunkIndex: number, action: HunkAction): Promise<ReviewActionOutcome> => {
      const target = targets[hunkIndex];
      if (!current || !target || target.kind === 'none' || busy) return 'kept';
      if (action === 'discard') {
        const ok = await confirm({
          title: 'Discard hunk',
          message: `Throw away hunk ${hunkIndex + 1} of ${file.path}? Its lines are removed from the working tree. This cannot be undone.`,
          confirmLabel: 'Discard hunk',
          variant: 'destroy',
        });
        if (!ok) return 'kept';
      }
      const patch = target.kind === 'staged' ? current.staged : current.unstaged;
      setBusy(true);
      let outcome: ReviewActionOutcome = 'kept';
      try {
        await useStore.getState().applyHunkAction(repoPath, file.path, patch, target.index, action);
        outcome =
          action === 'stage' ? 'accepted' : action === 'unstage' ? 'unaccepted' : 'discarded';
      } catch (error) {
        useStore.getState().showToast(errorMessage(error), 'error');
      } finally {
        await afterAction();
        setBusy(false);
      }
      return outcome;
    },
    [afterAction, busy, confirm, current, file.path, repoPath, targets]
  );

  const actOnHunk = useCallback(
    async (hunkIndex: number, action: HunkAction) => {
      const outcome = await runHunk(hunkIndex, action);
      onHunkActed?.(hunkIndex, outcome);
      return outcome;
    },
    [onHunkActed, runHunk]
  );

  const keys = useMemo<ReviewHunkKeys>(
    () => ({
      toggleAccept: async (hunkIndex) => {
        const target = targets[hunkIndex];
        if (!canAccept || !target || target.kind === 'none') return 'kept';
        return actOnHunk(hunkIndex, target.kind === 'staged' ? 'unstage' : 'stage');
      },
      discard: async (hunkIndex) => {
        if (targets[hunkIndex]?.kind !== 'unstaged') return 'kept';
        return actOnHunk(hunkIndex, 'discard');
      },
    }),
    [actOnHunk, canAccept, targets]
  );

  const runFile = useCallback(
    async (action: 'accept' | 'discard') => {
      if (busy) return;
      if (action === 'discard') {
        const ok = await confirm({
          title: 'Discard file',
          message:
            file.status === 'untracked' || file.status === 'added'
              ? `Delete ${file.path}? It is a new file, so discarding it removes it from disk. This cannot be undone.`
              : `Throw away every change to ${file.path}, staged and unstaged? This cannot be undone.`,
          confirmLabel: 'Discard file',
          variant: 'destroy',
        });
        if (!ok) {
          onFileActed?.('kept');
          return;
        }
      }
      setBusy(true);
      const store = useStore.getState();
      let outcome: ReviewActionOutcome = 'kept';
      try {
        if (action === 'accept') await store.stageFile(repoPath, file.path);
        else await discardChanges(repoPath, file.path);
        await store.refreshRepoStatus(repoPath);
        outcome = action === 'accept' ? 'accepted' : 'discarded';
      } catch (error) {
        store.showToast(`Could not ${action} ${file.path}: ${errorMessage(error)}`, 'error');
      } finally {
        await afterAction();
        setBusy(false);
      }
      onFileActed?.(outcome);
    },
    [afterAction, busy, confirm, file.path, file.status, onFileActed, repoPath]
  );

  const hunkActions = useCallback(
    (hunkIndex: number): { actions: HunkToolbarAction[]; note?: string } => {
      const target = targets[hunkIndex];
      if (!target || target.kind === 'none') return { actions: [] };
      const discard: HunkToolbarAction = {
        id: 'discard',
        label: 'Discard',
        name: 'Discard hunk',
        icon: 'undo',
        danger: true,
        shortcut: DISCARD_KEY,
        tooltip: 'Removes these lines from the working tree. Asks first; cannot be undone. (⌫)',
        onRun: () => void actOnHunk(hunkIndex, 'discard'),
      };
      if (!canAccept) return { actions: target.kind === 'unstaged' ? [discard] : [] };
      if (target.kind === 'staged') {
        const undo: HunkToolbarAction = {
          id: 'unstage',
          label: 'Undo accept',
          name: 'Undo accept of hunk',
          icon: 'undo',
          shortcut: S_KEY,
          tooltip: 'Unstages this hunk again. (S)',
          onRun: () => void actOnHunk(hunkIndex, 'unstage'),
        };
        return { note: 'Accepted', actions: [undo] };
      }
      const accept: HunkToolbarAction = {
        id: 'accept',
        label: 'Accept',
        name: 'Accept hunk',
        icon: 'check',
        shortcut: S_KEY,
        tooltip: 'Stages this hunk. Undo accept reverts it. (S)',
        onRun: () => void actOnHunk(hunkIndex, 'stage'),
      };
      return { actions: [accept, discard] };
    },
    [actOnHunk, canAccept, targets]
  );

  /** Why some hunks have no per-hunk action, once per file. */
  const fallbackReason = useMemo(() => {
    const none = targets.find((t) => t.kind === 'none');
    if (!none || none.kind !== 'none') return null;
    return `${none.reason} ${canAccept ? 'Accept or discard' : 'Discard'} the whole file instead.`;
  }, [canAccept, targets]);

  return {
    busy,
    canAccept,
    hunkActions,
    keys,
    runFile,
    fallbackReason,
    ready: current !== null,
    confirmDialog,
  };
}
