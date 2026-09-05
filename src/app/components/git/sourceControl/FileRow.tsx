import type { MouseEvent } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { GitFileStatus } from '@/lib/tauri/git';
import { badgeFor, type DiffSide, type RowAction } from './types';

export function FileRow({
  file,
  side,
  actionKind,
  onAction,
  onFileClick,
  onContextMenu,
}: {
  file: GitFileStatus;
  side: DiffSide;
  actionKind: RowAction;
  onAction: (path: string) => void;
  onFileClick?: (path: string, side: DiffSide) => void;
  onContextMenu?: (e: MouseEvent, file: GitFileStatus) => void;
}) {
  const badge = badgeFor(file, side);
  return (
    <div
      className="flex items-center gap-1 pr-2 text-xs text-foreground-muted hover:bg-primary/5"
      onContextMenu={(e) => onContextMenu?.(e, file)}
    >
      <div
        role={onFileClick ? 'button' : undefined}
        tabIndex={onFileClick ? 0 : undefined}
        onClick={() => onFileClick?.(file.path, side)}
        onKeyDown={(e) => {
          if (onFileClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onFileClick(file.path, side);
          }
        }}
        className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-1 ${onFileClick ? 'cursor-pointer' : ''}`}
      >
        <AuricIcon name="description" className="text-sm" />
        <span className={`flex-1 truncate ${badge.className}`}>{file.path}</span>
        <span className={`text-[10px] font-bold ${badge.className}`}>{badge.label}</span>
      </div>
      <button
        type="button"
        data-testid={`${actionKind}-${file.path}`}
        aria-label={actionKind === 'stage' ? 'Stage' : 'Unstage'}
        onClick={(e) => {
          e.stopPropagation();
          onAction(file.path);
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-muted hover:bg-primary/10 hover:text-primary"
      >
        {actionKind === 'stage' ? '+' : '−'}
      </button>
    </div>
  );
}
