import type { GitFileStatus } from '@/lib/tauri/git';
import { FileList } from './FileList';
import type { DiffSide, RowAction } from './types';

export function FileSection({
  title,
  testId,
  files,
  side,
  actionKind,
  onAction,
  headerAction,
  bordered,
  onFileClick,
  onDiscardFile,
}: {
  title: string;
  testId: string;
  files: GitFileStatus[];
  side: DiffSide;
  actionKind: RowAction;
  onAction: (path: string) => void;
  headerAction?: { label: string; onClick: () => void };
  bordered?: boolean;
  onFileClick?: (path: string, side: DiffSide) => void;
  onDiscardFile?: (path: string) => void;
}) {
  return (
    <div data-testid={testId} className={bordered ? 'border-t border-border-dark' : undefined}>
      <div className="flex items-center justify-between px-3 py-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
          {title} ({files.length})
        </h3>
        {headerAction && (
          <button
            type="button"
            onClick={headerAction.onClick}
            className="text-[10px] font-medium text-foreground-muted hover:text-primary"
          >
            {headerAction.label}
          </button>
        )}
      </div>
      <FileList
        files={files}
        side={side}
        actionKind={actionKind}
        onAction={onAction}
        onFileClick={onFileClick}
        onDiscardFile={onDiscardFile}
      />
    </div>
  );
}
