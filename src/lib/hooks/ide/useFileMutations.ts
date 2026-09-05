'use client';

import { useCallback } from 'react';
import { useStore } from '@/lib/store';
import { type FileTreeNode } from '@/app/components/explorer/FileExplorer';
import {
  createDirectory,
  deleteFile,
  copyFile,
  movePath,
  writeFile,
  readFile,
  exists,
} from '@/lib/tauri/fs';
import { appendGitignoreEntry, toGitignoreEntry } from '@/lib/git/gitignore';
import { addIgnoredRepo, relativePathForIgnore } from '@/lib/config/ignoredRepos';
import { loadIgnoredRepos, saveIgnoredRepos } from '@/lib/config/projectConfig';
import { newItemParentDir } from '@/lib/explorer/newItemTarget';
import { emptyExcalidrawSceneJson } from '@/lib/excalidraw/serialize';
import { copyToClipboard } from '@/lib/tauri/clipboard';
import { computeBacklinkWarning } from '@/lib/refactoring/backlinkWarning';
import { computeFileRenameChanges } from '@/lib/refactoring/renameFile';
import { applyChangesToContent } from '@/lib/refactoring/applyRenameChanges';
import type { useIDEState } from '../useIDEState';

export function useFileMutations(
  state: ReturnType<typeof useIDEState>,
  clipboard: { path: string; isDirectory: boolean } | null,
  handleRefresh: (dir?: string, isRoot?: boolean) => Promise<unknown>,
  handleFileSelect: (path: string) => Promise<void>,
  confirm: (options: { title: string; message: string; confirmLabel?: string }) => Promise<boolean>
) {
  const handleNewFile = useCallback(async () => {
    if (!state.rootPath) return;
    const parentDir = newItemParentDir(
      state.rootPath,
      state.selectedPath,
      useStore.getState().fileTree ?? []
    );
    state.setNewItemModal({ type: 'file', parentDir });
  }, [state]);

  const handleNewSpec = useCallback(async () => {
    if (!state.rootPath) return;
    const specsDir = `${state.rootPath}/specs`;
    await createDirectory(specsDir);
    const newPath = `${specsDir}/spec-${Date.now()}.md`;
    await writeFile(
      newPath,
      '# New Spec\n\n## Context\n\nWhat problem does this solve, and for whom?\n\n## Requirements\n\n-\n\n## Acceptance Criteria\n\n- [ ]\n'
    );
    await handleRefresh();
    handleFileSelect(newPath);
  }, [state, handleRefresh, handleFileSelect]);

  const handleNewDiagram = useCallback(
    async (parentDir?: string) => {
      if (!state.rootPath) return;
      const dir = parentDir ?? state.rootPath;
      const newPath = `${dir}/untitled-diagram-${Date.now()}.excalidraw`;
      await writeFile(newPath, emptyExcalidrawSceneJson());
      await handleRefresh(parentDir);
      handleFileSelect(newPath);
    },
    [state, handleRefresh, handleFileSelect]
  );

  const handleMoveNode = useCallback(
    async (sourcePath: string, destDir: string) => {
      const name = sourcePath.split('/').pop();
      if (!name) return;
      const destination = `${destDir}/${name}`;
      if (destination === sourcePath) return;
      try {
        await movePath(sourcePath, destination);
      } catch (err) {
        const message = typeof err === 'string' ? err : `Could not move "${name}"`;
        state.showToast(message, 'error');
        return;
      }
      state.renamePath(sourcePath, destination);
      if (state.selectedPath === sourcePath || state.selectedPath?.startsWith(sourcePath + '/')) {
        state.selectFile(state.selectedPath.replace(sourcePath, destination));
      }
      await handleRefresh();
    },
    [state, handleRefresh]
  );

  const handleCopyPath = useCallback(
    (path: string) => {
      void copyToClipboard(path).then((ok) => {
        if (ok) {
          state.showToast('Copied path', 'success');
        } else {
          state.showToast('Could not copy path', 'error');
        }
      });
    },
    [state]
  );

  const handleCopyPaths = useCallback(
    (paths: string[]) => {
      void copyToClipboard(paths.join('\n')).then((ok) => {
        if (ok) {
          state.showToast(
            paths.length === 1 ? 'Copied path' : `Copied ${paths.length} paths`,
            'success'
          );
        } else {
          state.showToast('Could not copy paths', 'error');
        }
      });
    },
    [state]
  );

  const handleRenameRequest = useCallback(
    (node: FileTreeNode) => {
      state.setRenameDialog({ path: node.path, oldName: node.name, isDirectory: node.isDirectory });
    },
    [state]
  );

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      const dialog = state.renameDialog;
      if (!dialog) return;
      const parentDir = dialog.path.split('/').slice(0, -1).join('/');
      const destination = `${parentDir}/${newName}`;
      if (destination === dialog.path) {
        state.setRenameDialog(null);
        return;
      }
      try {
        await movePath(dialog.path, destination);
      } catch (err) {
        const message = typeof err === 'string' ? err : `Could not rename "${dialog.oldName}"`;
        state.showToast(message, 'error');
        return;
      }

      if (
        !dialog.isDirectory &&
        (dialog.oldName.endsWith('.md') || dialog.oldName.endsWith('.markdown'))
      ) {
        const store = useStore.getState();
        const referencingPaths = store
          .getBacklinksFor(dialog.oldName)
          .filter((p) => p !== dialog.path);
        if (referencingPaths.length > 0) {
          try {
            const referencingFiles = new Map<string, string>();
            for (const p of referencingPaths) {
              try {
                referencingFiles.set(p, await readFile(p));
              } catch {
                // Best-effort
              }
            }
            const changes = computeFileRenameChanges(dialog.oldName, newName, referencingFiles);
            const byFile = new Map<string, typeof changes>();
            for (const change of changes) {
              const list = byFile.get(change.filePath) ?? [];
              list.push(change);
              byFile.set(change.filePath, list);
            }
            for (const [fp, fileChanges] of byFile) {
              const original = referencingFiles.get(fp) ?? '';
              const updated = applyChangesToContent(original, fileChanges);
              await writeFile(fp, updated);
              store.updateFileInIndex(fp, updated);
              if (state.activeTabId === fp) state.setEditorContent(updated);
            }
          } catch {
            // Best-effort
          }
        }
      }

      state.renamePath(dialog.path, destination);
      if (state.selectedPath === dialog.path || state.selectedPath?.startsWith(dialog.path + '/')) {
        state.selectFile(state.selectedPath.replace(dialog.path, destination));
      }
      state.setRenameDialog(null);
      await handleRefresh(parentDir);
    },
    [state, handleRefresh]
  );

  const handleAddToGitignore = useCallback(
    async (node: FileTreeNode) => {
      const entry = toGitignoreEntry(state.rootPath, node.path, node.isDirectory);
      if (!entry || !state.rootPath) return;
      const root = state.rootPath.endsWith('/') ? state.rootPath.slice(0, -1) : state.rootPath;
      const gitignorePath = `${root}/.gitignore`;
      try {
        const current = (await exists(gitignorePath)) ? await readFile(gitignorePath) : '';
        const next = appendGitignoreEntry(current, entry);
        if (next === null) {
          state.showToast(`"${entry}" is already in .gitignore`, 'info');
          return;
        }
        await writeFile(gitignorePath, next);
      } catch (err) {
        const message = typeof err === 'string' ? err : 'Could not update .gitignore';
        state.showToast(message, 'error');
        return;
      }
      state.showToast(`Added "${entry}" to .gitignore`, 'success');
      await handleRefresh();
    },
    [state, handleRefresh]
  );

  const handleIgnoreGitRepo = useCallback(
    async (absPath: string) => {
      const root = state.rootPath;
      if (!root) return;
      const relative = relativePathForIgnore(root, absPath);
      if (!relative) {
        state.showToast('The opened folder cannot be ignored', 'info');
        return;
      }
      try {
        const current = await loadIgnoredRepos(root);
        await saveIgnoredRepos(root, addIgnoredRepo(current, relative));
        const store = useStore.getState();
        await store.discoverAndRefreshGit(root);
        store.bumpProjectDirtyEpoch();
      } catch {
        state.showToast('Could not ignore this repository', 'error');
        return;
      }
      state.showToast(`Ignored "${relative}". Undo in Settings → Git.`, 'success');
    },
    [state]
  );

  const handleDeleteSelection = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const label =
        paths.length === 1 ? (paths[0].split('/').pop() ?? paths[0]) : `${paths.length} items`;
      const backlinkWarning = computeBacklinkWarning(paths, useStore.getState().getBacklinksFor);
      const message = backlinkWarning
        ? `This removes ${label} permanently. ${backlinkWarning}`
        : `This removes ${label} permanently.`;
      const go = await confirm({
        title: paths.length === 1 ? 'Delete this file?' : 'Delete these items?',
        message,
        confirmLabel: 'Delete',
      });
      if (!go) return;
      await Promise.all(paths.map((p) => deleteFile(p)));
      state.setSelectedPaths([]);
      await handleRefresh();
    },
    [state, handleRefresh, confirm]
  );

  const handlePaste = useCallback(
    async (targetDir: string) => {
      if (!clipboard) return;
      const fileName = clipboard.path.split('/').pop();
      const dest = `${targetDir}/${fileName}_copy`;
      await copyFile(clipboard.path, dest);
      handleRefresh();
    },
    [clipboard, handleRefresh]
  );

  const handleCreateNewItem = useCallback(
    async (name: string) => {
      if (!state.newItemModal) return;
      const fullPath = `${state.newItemModal.parentDir}/${name}`;
      const isFolder = state.newItemModal.type === 'folder';
      if (isFolder) {
        await createDirectory(fullPath);
      } else {
        const seed = name.endsWith('.excalidraw') ? emptyExcalidrawSceneJson() : '';
        await writeFile(fullPath, seed);
      }
      await handleRefresh(state.newItemModal.parentDir);
      state.setNewItemModal(null);
      if (!isFolder) handleFileSelect(fullPath);
    },
    [state, handleRefresh, handleFileSelect]
  );

  return {
    handleNewFile,
    handleNewSpec,
    handleNewDiagram,
    handleMoveNode,
    handleCopyPath,
    handleCopyPaths,
    handleRenameRequest,
    handleRenameConfirm,
    handleAddToGitignore,
    handleIgnoreGitRepo,
    handleDeleteSelection,
    handlePaste,
    handleCreateNewItem,
  };
}
