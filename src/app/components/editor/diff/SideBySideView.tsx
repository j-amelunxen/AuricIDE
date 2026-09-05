import { buildSideBySideRows, type DiffLine } from '@/lib/git/parseDiff';
import { wordDiff } from '@/lib/git/wordDiff';
import { useLineEdit } from './LineEditContext';
import { CommentButton, CommentPane } from './CommentControls';
import { EditableLineBody } from './EditableLineBody';
import { LineContent } from './LineContent';
import {
  COLUMN,
  commentTargetFor,
  isHunkHeader,
  lineIsEditable,
  lineStyles,
  type CommentTarget,
} from './types';

export function SideBySideView({ lines }: { lines: DiffLine[] }) {
  const rows = buildSideBySideRows(lines);
  const { canEditFile, startEdit } = useLineEdit();
  let hunkIndex = 0;

  return (
    <div
      data-testid="diff-side-by-side"
      className="flex-1 overflow-auto font-mono text-xs leading-5"
    >
      {rows.map((row, i) => {
        if (row.isHeader) {
          const hunkAttr = isHunkHeader(row.left) ? hunkIndex++ : undefined;
          return (
            <div key={i} data-hunk-index={hunkAttr} className={`flex ${lineStyles.header}`}>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-4">
                {row.left!.content}
              </span>
            </div>
          );
        }

        const paired =
          row.left?.type === 'removed' && row.right?.type === 'added'
            ? wordDiff(row.left.content, row.right.content)
            : null;

        const leftTarget = commentTargetFor(row.left, 'old');
        const rightTarget = commentTargetFor(row.right, 'new');
        const targets = [leftTarget, rightTarget].filter((t): t is CommentTarget => t !== null);

        return (
          <div key={i}>
            <div className="flex">
              <div
                className={`group ${COLUMN} border-r border-border-dark ${
                  row.left ? lineStyles[row.left.type] : ''
                }`}
              >
                {leftTarget ? <CommentButton target={leftTarget} /> : null}
                <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/50">
                  {row.left?.oldLineNo ?? row.left?.newLineNo ?? ''}
                </span>
                <LineContent
                  content={row.left?.content ?? ''}
                  spans={paired?.left}
                  changedClass="rounded-sm bg-red-500/35"
                />
              </div>
              <div
                className={`group ${COLUMN} ${row.right ? lineStyles[row.right.type] : ''}`}
                onDoubleClick={() => {
                  const right = row.right;
                  if (lineIsEditable(right, canEditFile) && right && right.newLineNo !== null) {
                    startEdit(right.newLineNo, right.content);
                  }
                }}
              >
                {rightTarget ? <CommentButton target={rightTarget} /> : null}
                <span className="w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/50">
                  {row.right?.newLineNo ?? row.right?.oldLineNo ?? ''}
                </span>
                <EditableLineBody
                  line={lineIsEditable(row.right, canEditFile) ? row.right : null}
                  fallback={row.right?.content ?? ''}
                  spans={paired?.right}
                  changedClass="rounded-sm bg-green-500/35"
                />
              </div>
            </div>
            <CommentPane targets={targets} />
          </div>
        );
      })}
    </div>
  );
}
