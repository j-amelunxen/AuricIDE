import { useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { createStatusSignatureSelector } from '@/lib/git/statusSignature';

const NO_STATUSES: never[] = [];

/**
 * Keeps the active staged/unstaged/combined/ref diff tab in sync with git
 * status. Compare-ref tabs refetch against that ref, not HEAD. Revision
 * patches are snapshots and are never refetched. The repo the diff belongs
 * to travels with the tab (`DiffTabState.repoPath`) — two repos can hold a
 * file at the same relative path, so the tab, not the project root, is what
 * decides which repo to ask.
 */
export function useActiveDiffLoader() {
  const activeTabId = useStore((s) => s.activeTabId);
  const repoPath = useStore((s) => {
    if (!s.activeTabId) return undefined;
    return s.diffByTabId[s.activeTabId]?.repoPath;
  });
  const sourceKind = useStore((s) => {
    if (!s.activeTabId) return undefined;
    return s.diffByTabId[s.activeTabId]?.source.kind;
  });
  const filePath = useStore((s) => {
    if (!s.activeTabId) return undefined;
    return s.diffByTabId[s.activeTabId]?.filePath;
  });
  const signatureOf = useMemo(() => createStatusSignatureSelector(), []);
  const statusSignature = useStore((s) => {
    if (!filePath || !repoPath) return '';
    return signatureOf(s.repoStates[repoPath]?.fileStatuses ?? NO_STATUSES, filePath);
  });

  useEffect(() => {
    if (!repoPath || !activeTabId || !filePath || !sourceKind) return;
    if (sourceKind === 'revision') return;

    let cancelled = false;
    void (async () => {
      const latest = useStore.getState().diffByTabId[activeTabId];
      if (!latest) return;
      const { getGitDiff, getGitDiffFileRef } = await import('@/lib/tauri/git');
      const patch =
        latest.source.kind === 'ref'
          ? await getGitDiffFileRef(repoPath, latest.source.ref, filePath)
          : await getGitDiff(
              repoPath,
              filePath,
              latest.source.kind === 'staged' || latest.source.kind === 'unstaged'
                ? latest.source.kind
                : undefined
            );
      if (cancelled) return;
      const current = useStore.getState().diffByTabId[activeTabId];
      if (!current) return;
      useStore.getState().setDiffTab(activeTabId, { ...current, patch });
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTabId, repoPath, statusSignature, sourceKind, filePath]);
}
