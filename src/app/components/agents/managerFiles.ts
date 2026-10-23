import { useStore } from '@/lib/store';
import { openFileTab } from '@/lib/hooks/ide/openFileTab';
import { openPathInDefaultApp } from '@/lib/tauri/opener';

const KNOWLEDGE_DIR = 'knowledge';
export const MEMORY_INDEX_FILE = 'index.md';

const withoutTrailingSlash = (path: string) => path.replace(/\/+$/, '');

/** A file inside a manager's memory bundle, from its run folder and the path relative to `knowledge/`. */
export const knowledgeFilePath = (runPath: string, relative: string) =>
  `${withoutTrailingSlash(runPath)}/${KNOWLEDGE_DIR}/${relative}`;

/** What every surface says about a manager whose run folder is gone. */
export const FOLDER_MISSING_SENTENCE =
  'Its folder is gone. Archive it; an archived manager can then be removed.';

export const PLANNING_UNSAVED_SENTENCE = 'Save or discard your planning changes first.';

/**
 * Opens a file as an editor tab, the way the explorer does. Without a project
 * there is no editor to hold the tab, so the system's default app opens it.
 */
export async function openFileInEditor(path: string): Promise<void> {
  const store = useStore.getState();
  if (store.rootPath === null) {
    await openPathInDefaultApp(path);
    return;
  }
  if (store.pmDirty) {
    store.showToast(PLANNING_UNSAVED_SENTENCE, 'info');
    return;
  }
  openFileTab(path);
}
