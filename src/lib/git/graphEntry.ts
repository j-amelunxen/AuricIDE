import { repoForGlobalGitAction } from '@/lib/hooks/ide/useGitActionHandlers';
import { useStore } from '@/lib/store';
import type { GitRepoRef } from '@/lib/tauri/git';
import { graphTabId, repoPathFromGraphTabId } from './graphTabId';

const NO_REPOSITORY_MESSAGE = 'Open a folder with a git repository first.';

/** The repo the graph shows: the graph tab you are on, else the active repo, else the only one. */
export function repoForGraph(store: {
  activeTabId: string | null;
  repos: GitRepoRef[];
  activeRepoPath: string | null;
}): string | null {
  const fromTab = store.activeTabId ? repoPathFromGraphTabId(store.activeTabId) : null;
  return fromTab ?? repoForGlobalGitAction(store);
}

const folderName = (path: string) => path.split('/').filter(Boolean).pop() ?? path;

/** Opens (or focuses) the graph tab of one repo and starts loading it. */
export function openGraphTab(repoPath: string): void {
  const store = useStore.getState();
  const name = store.repos.find((r) => r.path === repoPath)?.name ?? folderName(repoPath);
  store.openTab({ id: graphTabId(repoPath), path: repoPath, name: `${name} Graph` });
  void store.openGraph(repoPath);
}

/** Every entry point (button, palette, shortcut) ends here. */
export function showGraph(): void {
  const store = useStore.getState();
  const repoPath = repoForGraph(store);
  if (!repoPath) {
    store.showToast(NO_REPOSITORY_MESSAGE, 'info');
    return;
  }
  openGraphTab(repoPath);
}
