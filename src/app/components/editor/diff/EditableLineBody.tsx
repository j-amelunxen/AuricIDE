import type { KeyboardEvent } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { DiffLine } from '@/lib/git/parseDiff';
import type { WordSpan } from '@/lib/git/wordDiff';
import { useLineEdit } from './LineEditContext';
import { LineContent } from './LineContent';
import { TEXT_WRAP } from './types';

export function EditableLineBody({
  line,
  fallback,
  spans,
  changedClass,
}: {
  line: DiffLine | null;
  fallback: string;
  spans?: WordSpan[] | null;
  changedClass?: string;
}) {
  const { edit, saving, startEdit, setDraft, commitEdit, cancelEdit } = useLineEdit();
  const lineNo = line?.newLineNo ?? null;
  const editing = lineNo !== null && edit?.lineNo === lineNo;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      void commitEdit();
    }
  };

  if (editing && edit) {
    return (
      <textarea
        data-testid="diff-line-editor"
        aria-label={`Editing line ${edit.lineNo}`}
        value={edit.draft}
        disabled={saving}
        autoFocus
        rows={Math.max(1, edit.draft.split('\n').length)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!saving) cancelEdit();
        }}
        className={`${TEXT_WRAP} resize-none bg-transparent py-0 text-inherit outline-none ring-1 ring-primary/70`}
      />
    );
  }

  if (!line || lineNo === null) {
    return <LineContent content={fallback} spans={spans} changedClass={changedClass} />;
  }

  return (
    <span className="flex min-w-0 flex-1 items-start">
      <button
        type="button"
        aria-label={`Edit line ${lineNo}`}
        title={`Edit line ${lineNo}`}
        onClick={(event) => {
          event.stopPropagation();
          startEdit(lineNo, line.content);
        }}
        className="relative mt-px mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-muted opacity-0 transition-opacity duration-150 before:absolute before:-inset-2 hover:bg-hover-bg hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 active:scale-[0.96]"
      >
        <AuricIcon name="edit" className="text-[13px]" />
      </button>
      <span className="min-w-0 flex-1" title="Double-click to edit">
        <LineContent content={line.content} spans={spans} changedClass={changedClass} />
      </span>
    </span>
  );
}
