import type { DiffLine } from '@/lib/git/parseDiff';
import { useLineEdit } from './LineEditContext';
import { CommentButton, CommentPane } from './CommentControls';
import { EditableLineBody } from './EditableLineBody';
import { hunkHeaderAttrs, hunkHeaderClass, useHunkHeader } from './HunkHeaderContext';
import { commentTargetFor, isHunkHeader, lineIsEditable, lineStyles } from './types';

export function UnifiedView({ lines, scroll = true }: { lines: DiffLine[]; scroll?: boolean }) {
  let hunkIndex = 0;
  const { canEditFile, startEdit } = useLineEdit();
  const hunkHeader = useHunkHeader();

  return (
    <div className={`${scroll ? 'flex-1 overflow-auto' : ''} font-mono text-xs leading-5`}>
      {lines.map((line, i) => {
        const hunkAttr = isHunkHeader(line) ? hunkIndex++ : undefined;
        const editable = lineIsEditable(line, canEditFile);
        const commentTarget = commentTargetFor(line, 'auto');
        return (
          <div
            key={i}
            data-hunk-index={hunkAttr}
            {...hunkHeaderAttrs(hunkHeader, hunkAttr)}
            className="outline-none"
          >
            <div
              className={`group flex ${lineStyles[line.type]} ${hunkHeaderClass(hunkHeader, hunkAttr)}`}
              onDoubleClick={() => {
                if (editable && line.newLineNo !== null) startEdit(line.newLineNo, line.content);
              }}
            >
              {commentTarget ? <CommentButton target={commentTarget} /> : null}
              <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/80">
                {line.oldLineNo ?? ''}
              </span>
              <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/80">
                {line.newLineNo ?? ''}
              </span>
              <span className="w-6 shrink-0 select-none text-center">
                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ''}
              </span>
              <EditableLineBody line={editable ? line : null} fallback={line.content} />
              {hunkHeader && hunkAttr !== undefined ? hunkHeader.renderHunkHeader(hunkAttr) : null}
            </div>
            {commentTarget ? <CommentPane targets={[commentTarget]} /> : null}
          </div>
        );
      })}
    </div>
  );
}
