import {
  buildSideBySideRows,
  type DiffLine,
  type SideBySideRow as RowData,
} from '@/lib/git/parseDiff';
import { wordDiff } from '@/lib/git/wordDiff';
import { useLineEdit } from './LineEditContext';
import { CommentButton, CommentPane } from './CommentControls';
import { EditableLineBody } from './EditableLineBody';
import { LineContent } from './LineContent';
import { HunkHeaderRow } from './HunkHeaderRow';
import {
  COLUMN,
  commentTargetFor,
  isHunkHeader,
  lineIsEditable,
  lineStyles,
  type CommentTarget,
} from './types';

const LINE_NO = 'w-12 shrink-0 select-none text-right pr-2 text-foreground-muted/80';

/** A removed line paired with the added line that replaced it gets word-level highlights. */
function pairedWords(row: RowData): ReturnType<typeof wordDiff> | null {
  return row.left?.type === 'removed' && row.right?.type === 'added'
    ? wordDiff(row.left.content, row.right.content)
    : null;
}

function lineStyle(line: DiffLine | null): string {
  return line ? lineStyles[line.type] : '';
}

/** The old column shows the old number; a column with only a new number falls back to it. */
function lineNumber(line: DiffLine | null, prefer: 'old' | 'new'): number | string {
  if (!line) return '';
  const [first, second] =
    prefer === 'old' ? [line.oldLineNo, line.newLineNo] : [line.newLineNo, line.oldLineNo];
  return first ?? second ?? '';
}

function SideBySideRow({ row }: { row: RowData }) {
  const { canEditFile, startEdit } = useLineEdit();
  const paired = pairedWords(row);
  const leftTarget = commentTargetFor(row.left, 'old');
  const rightTarget = commentTargetFor(row.right, 'new');
  const targets = [leftTarget, rightTarget].filter((t): t is CommentTarget => t !== null);
  const editable = lineIsEditable(row.right, canEditFile) ? row.right : null;

  return (
    <div>
      <div className="flex">
        <div className={`group ${COLUMN} border-r border-border-dark ${lineStyle(row.left)}`}>
          {leftTarget ? <CommentButton target={leftTarget} /> : null}
          <span className={LINE_NO}>{lineNumber(row.left, 'old')}</span>
          <LineContent
            content={row.left?.content ?? ''}
            spans={paired?.left}
            changedClass="rounded-sm bg-red-500/35"
          />
        </div>
        <div
          className={`group ${COLUMN} ${lineStyle(row.right)}`}
          onDoubleClick={() => {
            if (editable && editable.newLineNo !== null) {
              startEdit(editable.newLineNo, editable.content);
            }
          }}
        >
          {rightTarget ? <CommentButton target={rightTarget} /> : null}
          <span className={LINE_NO}>{lineNumber(row.right, 'new')}</span>
          <EditableLineBody
            line={editable}
            fallback={row.right?.content ?? ''}
            spans={paired?.right}
            changedClass="rounded-sm bg-green-500/35"
          />
        </div>
      </div>
      <CommentPane targets={targets} />
    </div>
  );
}

export function SideBySideView({ lines, scroll = true }: { lines: DiffLine[]; scroll?: boolean }) {
  const rows = buildSideBySideRows(lines);
  let hunkIndex = 0;

  return (
    <div
      data-testid="diff-side-by-side"
      className={`${scroll ? 'flex-1 overflow-auto' : ''} font-mono text-xs leading-5`}
    >
      {rows.map((row, i) => {
        if (!row.isHeader) return <SideBySideRow key={i} row={row} />;
        const hunkAttr = isHunkHeader(row.left) ? hunkIndex++ : undefined;
        return <HunkHeaderRow key={i} content={row.left!.content} hunkIndex={hunkAttr} />;
      })}
    </div>
  );
}
