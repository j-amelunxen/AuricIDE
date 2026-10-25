import { diffTabId } from '@/lib/git/diffTabId';
import type { DiffSource } from '@/lib/git/diffTab';
import { relativeToRepo } from '@/lib/git/repos';
import { useStore } from '@/lib/store';
import { diffFiles } from '@/lib/tauri/compare';

const SEPARATOR = ' ↔ ';

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Opens the read-only comparison of two files; left is the old side, right the new one. */
export async function openFileComparison(left: string, right: string): Promise<void> {
  const store = useStore.getState();
  let patch: string;
  try {
    patch = await diffFiles(left, right);
  } catch (error) {
    store.showToast(errorMessage(error), 'error');
    return;
  }
  const source: DiffSource = { kind: 'files', left, right };
  const label = [left, right]
    .map((path) => (store.rootPath ? relativeToRepo(path, store.rootPath) : path))
    .join(SEPARATOR);
  const id = diffTabId(source, label, '');
  store.setDiffTab(id, { patch, filePath: label, source, repoPath: '' });
  store.openTab({ id, path: label, name: [left, right].map(baseName).join(SEPARATOR) });
}
