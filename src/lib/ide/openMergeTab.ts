import { useStore } from '@/lib/store';

/**
 * Loads one conflicted file into the merge panel and opens (or focuses) its
 * tab. Every entry point uses this: the banner, the explorer of conflicts,
 * the branch merge picker and the worktree merge offer, so the tab looks the
 * same however you got there. Rethrows when the file is no longer conflicted.
 */
export async function openMergeTab(repoPath: string, filePath: string): Promise<string> {
  const store = useStore.getState();
  const id = await store.openConflict(repoPath, filePath);
  store.openTab({ id, path: filePath, name: `${filePath.split('/').pop()} (merge)` });
  return id;
}

/** `openMergeTab` with a toast instead of a rejection, for click handlers. */
export function openMergeTabOrToast(repoPath: string, filePath: string): void {
  openMergeTab(repoPath, filePath).catch((err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    useStore.getState().showToast(`Could not open ${filePath}: ${detail}`, 'error');
  });
}
