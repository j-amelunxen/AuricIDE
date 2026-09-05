import { useState } from 'react';
import { ContextMenu } from '@/app/components/ide/ContextMenu';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { isUnstagedTracked } from '@/lib/git/statusSplit';
import type { GitFileStatus } from '@/lib/tauri/git';
import { FileRow } from './FileRow';
import type { DiffSide, RowAction } from './types';

export function FileList({
  files,
  side,
  actionKind,
  onAction,
  onFileClick,
  onDiscardFile,
}: {
  files: GitFileStatus[];
  side: DiffSide;
  actionKind: RowAction;
  onAction: (path: string) => void;
  onFileClick?: (path: string, side: DiffSide) => void;
  onDiscardFile?: (path: string) => void;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(
    null
  );

  // Asked in-app and awaited. The browser's confirm() does not suspend the
  // script inside the Tauri webview, so the file would already be gone by the
  // time the user reads the question.
  const { confirm, confirmDialog } = useConfirm();

  /**
   * Discard is the only action here git cannot take back, and its menu item
   * appears directly under the cursor after a right-click. What it costs
   * depends on whether git has a copy: for a file that was never committed
   * there is nothing behind it, so discarding is a plain deletion — say that
   * instead of the softer "changes are lost".
   */
  const confirmDiscard = async (file: GitFileStatus) => {
    const neverCommitted = file.status === 'untracked' || file.status === 'added';
    const go = await confirm(
      neverCommitted
        ? {
            title: 'Delete this file?',
            message: `${file.path} has never been committed, so git has no copy of it. Discarding deletes it from disk and it cannot be recovered.`,
            confirmLabel: 'Delete',
          }
        : {
            title: 'Discard changes?',
            message: `Discard your changes to ${file.path}? It is restored to the last commit and the uncommitted changes are gone for good.`,
            confirmLabel: 'Discard',
          }
    );
    if (!go) return;
    onDiscardFile?.(file.path);
  };

  const allowDiscard = (file: GitFileStatus) => {
    if (!onDiscardFile) return false;
    // Changes + Untracked always; Staged only when the file is not also in Changes.
    if (side === 'unstaged') return true;
    return !isUnstagedTracked(file);
  };

  return (
    <div>
      {files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          side={side}
          actionKind={actionKind}
          onAction={onAction}
          onFileClick={onFileClick}
          onContextMenu={
            allowDiscard(file)
              ? (e, target) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, path: target.path });
                }
              : undefined
          }
        />
      ))}
      {contextMenu && onDiscardFile && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={[
            {
              label: 'Discard Changes',
              icon: 'undo',
              danger: true,
              action: () => {
                const file = files.find((f) => f.path === contextMenu.path);
                if (file) void confirmDiscard(file);
              },
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
      {confirmDialog}
    </div>
  );
}
