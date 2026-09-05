import { useCallback, useEffect } from 'react';
import type { EditorView } from '@codemirror/view';
import type { Compartment } from '@codemirror/state';
import { useStore } from '@/lib/store';
import { selectBlameHunks } from '@/lib/store/gitSlice';
import { repoForPath, relativeToRepo } from '@/lib/git/repos';
import { createGitGutter, diffToLineChanges } from '@/lib/editor/gitGutterExtension';
import { createBlameGutter } from '@/lib/editor/blameGutterExtension';
import { diffTabId, isDiffTabId } from '@/lib/git/diffTabId';

interface UseEditorGitExtensionsOptions {
  viewRef: React.RefObject<EditorView | null>;
  compartments: React.MutableRefObject<Record<string, Compartment>>;
  filePath?: string;
}

export function useEditorGitExtensions({
  viewRef,
  compartments,
  filePath,
}: UseEditorGitExtensionsOptions) {
  const isDirty = useStore((s) => s.openTabs.find((t) => t.id === filePath)?.isDirty ?? false);
  const statusSignature = useStore((s) => {
    if (!filePath) return '';
    const repo = repoForPath(filePath, s.repos);
    if (!repo) return '';
    const relativePath = relativeToRepo(filePath, repo.path);
    const fileStatuses = s.repoStates[repo.path]?.fileStatuses ?? [];
    return fileStatuses
      .filter((f) => f.path === relativePath)
      .map((f) => f.status)
      .join(',');
  });

  // Last-saved gutter, not live keystrokes: skip while the buffer is dirty,
  // refetch after save (isDirty → false) and when git status for this path
  // changes (commit / discard).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const repos = useStore.getState().repos;
    const repo = filePath ? repoForPath(filePath, repos) : null;
    if (!repo || !filePath) {
      view.dispatch({ effects: compartments.current.gitGutter.reconfigure(createGitGutter([])) });
      return;
    }
    if (isDirty) return;
    const relativePath = relativeToRepo(filePath, repo.path);
    let cancelled = false;

    (async () => {
      try {
        const [{ getGitDiff }, { parseDiff }] = await Promise.all([
          import('@/lib/tauri/git'),
          import('@/lib/git/parseDiff'),
        ]);
        const diff = await getGitDiff(repo.path, relativePath);
        const changes = diffToLineChanges(parseDiff(diff));
        if (!cancelled && viewRef.current) {
          viewRef.current.dispatch({
            effects: compartments.current.gitGutter.reconfigure(createGitGutter(changes)),
          });
        }
      } catch {
        if (!cancelled && viewRef.current) {
          viewRef.current.dispatch({
            effects: compartments.current.gitGutter.reconfigure(createGitGutter([])),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [compartments, filePath, isDirty, statusSignature, viewRef]);

  const blameVisible = useStore((s) => s.blameVisible);
  const blameHunks = useStore((s) => selectBlameHunks(s, filePath));
  const isFileTab = !!filePath && !isDiffTabId(filePath);
  const repoForFile = useStore((s) => (filePath ? repoForPath(filePath, s.repos) : null));
  const showBlameToggle = !!repoForFile && isFileTab;

  const openBlameHunk = useCallback(
    async (hunk: { oid: string; summary: string }) => {
      const store = useStore.getState();
      if (!filePath || isDiffTabId(filePath)) return;
      const repo = repoForPath(filePath, store.repos);
      if (!repo) return;
      const relativePath = relativeToRepo(filePath, repo.path);
      const { getGitDiffCommit } = await import('@/lib/tauri/git');
      const patch = await getGitDiffCommit(repo.path, hunk.oid, relativePath);
      const source = { kind: 'revision' as const, oid: hunk.oid, summary: hunk.summary };
      const id = diffTabId(source, relativePath, repo.path);
      store.setDiffTab(id, { patch, filePath: relativePath, source, repoPath: repo.path });
      store.openTab({
        id,
        path: relativePath,
        name: `${relativePath.split('/').pop()} @ ${hunk.oid.slice(0, 7)}`,
      });
      if (store.historyPath === relativePath) {
        store.setHistorySelectedOid(hunk.oid);
      }
    },
    [filePath]
  );

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const repos = useStore.getState().repos;
    const repo = filePath ? repoForPath(filePath, repos) : null;
    if (!blameVisible || !repo || !filePath || isDiffTabId(filePath)) {
      view.dispatch({ effects: compartments.current.blameGutter.reconfigure([]) });
      return;
    }
    if (isDirty) return;
    const relativePath = relativeToRepo(filePath, repo.path);
    void useStore.getState().loadBlame(repo.path, relativePath);
  }, [blameVisible, compartments, filePath, isDirty, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!blameVisible || !filePath || isDiffTabId(filePath)) {
      view.dispatch({ effects: compartments.current.blameGutter.reconfigure([]) });
      return;
    }
    view.dispatch({
      effects: compartments.current.blameGutter.reconfigure(
        createBlameGutter(blameHunks, (hunk) => {
          void openBlameHunk(hunk);
        })
      ),
    });
  }, [blameVisible, blameHunks, compartments, filePath, openBlameHunk, viewRef]);

  return { blameVisible, showBlameToggle };
}
