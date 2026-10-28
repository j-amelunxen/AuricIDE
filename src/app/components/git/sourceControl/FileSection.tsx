import { useState } from 'react';
import { capList, GIT_LIST_PAGE_SIZE } from '@/lib/git/listCap';
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
  const [limit, setLimit] = useState(GIT_LIST_PAGE_SIZE);
  const { shown, hidden } = capList(files, limit);
  const fmt = (n: number) => n.toLocaleString('en-US');

  return (
    <div data-testid={testId} className={bordered ? 'border-t border-border-dark' : undefined}>
      <div className="flex items-center justify-between px-3 py-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
          {title} ({fmt(files.length)})
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
        files={shown}
        side={side}
        actionKind={actionKind}
        onAction={onAction}
        onFileClick={onFileClick}
        onDiscardFile={onDiscardFile}
      />
      {hidden > 0 && (
        <div
          data-testid={`${testId}-cap`}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[10px] text-foreground-muted"
        >
          <span>
            Showing the first {fmt(shown.length)} of {fmt(files.length)}
          </span>
          <button
            type="button"
            onClick={() => setLimit((l) => l + GIT_LIST_PAGE_SIZE)}
            className="font-medium hover:text-primary"
          >
            Show more
          </button>
          <button
            type="button"
            onClick={() => setLimit(files.length)}
            className="font-medium hover:text-primary"
          >
            Show all
          </button>
        </div>
      )}
    </div>
  );
}
