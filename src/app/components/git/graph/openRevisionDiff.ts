import { diffTabId } from '@/lib/git/diffTabId';
import { useStore } from '@/lib/store';
import { getGitDiffCommitAtParent } from '@/lib/tauri/gitGraph';
import { SHORT_OID_LENGTH } from './graphCopy';

/**
 * Opens one file of a commit in the revision diff tab, the same tab (same id,
 * same payload) that the per-file History opens. For a merge, `parentIndex`
 * picks which parent the change is shown against.
 */
export async function openRevisionDiff(
  repoPath: string,
  commit: { oid: string; summary: string },
  filePath: string,
  parentIndex: number
): Promise<void> {
  const store = useStore.getState();
  try {
    const patch = await getGitDiffCommitAtParent(repoPath, commit.oid, filePath, parentIndex);
    const source = { kind: 'revision' as const, oid: commit.oid, summary: commit.summary };
    const id = diffTabId(source, filePath, repoPath);
    store.setDiffTab(id, { patch, filePath, source, repoPath });
    store.openTab({
      id,
      path: filePath,
      name: `${filePath.split('/').pop()} @ ${commit.oid.slice(0, SHORT_OID_LENGTH)}`,
    });
  } catch {
    store.showToast(`Could not read the change to ${filePath}.`, 'error');
  }
}
