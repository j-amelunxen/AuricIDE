import type { DiffLine } from '@/lib/git/parseDiff';
import { useLineEdit } from './LineEditContext';
import { CommentButton, CommentPane } from './CommentControls';
import { EditableLineBody } from './EditableLineBody';
import { commentTargetFor, isHunkHeader, lineIsEditable, lineStyles } from './types';

export function UnifiedView({ lines }: { lines: DiffLine[] }) {
  let hunkIndex = 0;
  const { canEditFile, startEdit } = useLineEdit();

  return (
    <div className="flex-1 overflow-auto font-mono text-xs leading-5">
      {lines.map((line, i) => {
        const hunkAttr = isHunkHeader(line) ? hunkIndex++ : undefined;
        const editable = lineIsEditable(line, canEditFile);
        const commentTarget = commentTargetFor(line, 'auto');
        return (
          <div key={i} data-hunk-index={hunkAttr}>
            <div
              className={`group flex ${lineStyles[line.type]}`}
              onDoubleClick={() => {
                if (editable && line.newLineNo !== null) startEdit(line.newLineNo, line.content);
              }}
            >
              {commentTarget ? <CommentButton target={commentTarget} /> : null}
              <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/50">
                {line.oldLineNo ?? ''}
              </span>
              <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/50">
                {line.newLineNo ?? ''}
              </span>
              <span className="w-6 shrink-0 select-none text-center">
                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ''}
              </span>
              <EditableLineBody line={editable ? line : null} fallback={line.content} />
            </div>
            {commentTarget ? <CommentPane targets={[commentTarget]} /> : null}
          </div>
        );
      })}
    </div>
  );
}
