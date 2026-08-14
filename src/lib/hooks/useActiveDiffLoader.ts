import { useEffect } from 'react';
import { useStore } from '@/lib/store';

/**
 * Keeps the active staged/unstaged/combined/ref diff tab in sync with git
 * status. Compare-ref tabs refetch against that ref, not HEAD. Revision
 * patches are snapshots and are never refetched.
 */
export function useActiveDiffLoader() {
  const activeTabId = useStore((s) => s.activeTabId);
  const rootPath = useStore((s) => s.rootPath);
  const sourceKind = useStore((s) => {
    if (!s.activeTabId) return undefined;
    return s.diffByTabId[s.activeTabId]?.source.kind;
  });
  const filePath = useStore((s) => {
    if (!s.activeTabId) return undefined;
    return s.diffByTabId[s.activeTabId]?.filePath;
  });
  const statusSignature = useStore((s) => {
    if (!filePath) return '';
    return s.fileStatuses
      .filter((f) => f.path === filePath)
      .map((f) => f.status)
      .join(',');
  });

  useEffect(() => {
    if (!rootPath || !activeTabId || !filePath || !sourceKind) return;
    if (sourceKind === 'revision') return;

    let cancelled = false;
    void (async () => {
      const latest = useStore.getState().diffByTabId[activeTabId];
      if (!latest) return;
      const { getGitDiff, getGitDiffFileRef } = await import('@/lib/tauri/git');
      const patch =
        latest.source.kind === 'ref'
          ? await getGitDiffFileRef(rootPath, latest.source.ref, filePath)
          : await getGitDiff(
              rootPath,
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
  }, [activeTabId, rootPath, statusSignature, sourceKind, filePath]);
}
