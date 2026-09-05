import { useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useLineComment } from './LineCommentContext';
import { commentButtonLabel, sameCommentTarget, type CommentTarget, GUTTER_BTN } from './types';

export function CommentButton({ target }: { target: CommentTarget }) {
  const { enabled, comments, startDraft } = useLineComment();
  if (!enabled) return null;
  const existing = comments.find(
    (comment) => comment.side === target.side && comment.lineNo === target.lineNo
  );
  return (
    <button
      type="button"
      aria-label={commentButtonLabel(target)}
      title={commentButtonLabel(target)}
      onClick={(event) => {
        event.stopPropagation();
        startDraft(target);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={`${GUTTER_BTN} ${
        existing ? 'text-primary opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}
    >
      <AuricIcon name="rate_review" className="text-[13px]" />
    </button>
  );
}

export function CommentComposer({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <div className="flex flex-col gap-2">
      <textarea
        data-testid="diff-comment-composer"
        aria-label="Review comment"
        autoFocus
        value={draft}
        rows={Math.max(2, draft.split('\n').length)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
            return;
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSave(draft);
          }
        }}
        className="min-h-[2.5rem] w-full resize-none rounded border border-border-dark bg-editor-bg px-2 py-1 text-xs text-foreground outline-none ring-1 ring-primary/50"
        placeholder="What should the agent do with this line?"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onSave(draft)}
          className="rounded bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/25 active:scale-[0.96]"
        >
          Save comment
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-0.5 text-[11px] text-foreground-muted hover:bg-hover-bg hover:text-foreground"
        >
          Cancel
        </button>
        <span className="text-[10px] text-foreground-muted">⌘↵ to save</span>
      </div>
    </div>
  );
}

export function CommentPane({ targets }: { targets: CommentTarget[] }) {
  const { enabled, comments, draft, cancelDraft, saveDraft, removeComment } = useLineComment();
  if (!enabled || targets.length === 0) return null;

  const shown = comments.filter((comment) =>
    targets.some((target) => target.side === comment.side && target.lineNo === comment.lineNo)
  );
  const activeDraft =
    draft && targets.some((target) => sameCommentTarget(target, draft)) ? draft : null;
  if (shown.length === 0 && !activeDraft) return null;

  return (
    <div
      className="border-t border-border-dark bg-panel-bg/70 px-3 py-2 font-sans text-xs"
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {shown.map((comment) =>
        activeDraft &&
        comment.side === activeDraft.side &&
        comment.lineNo === activeDraft.lineNo ? null : (
          <div
            key={comment.id}
            data-testid="diff-line-comment"
            className="mb-2 flex items-start gap-2 last:mb-0"
          >
            <AuricIcon name="rate_review" className="mt-0.5 shrink-0 text-sm text-primary" />
            <p className="min-w-0 flex-1 whitespace-pre-wrap text-foreground">{comment.body}</p>
            <button
              type="button"
              aria-label="Remove comment"
              onClick={() => removeComment(comment.id)}
              className="rounded px-1 text-foreground-muted hover:bg-hover-bg hover:text-foreground active:scale-[0.96]"
            >
              <AuricIcon name="close" className="text-sm" />
            </button>
          </div>
        )
      )}
      {activeDraft && (
        <CommentComposer
          initial={
            shown.find((c) => c.side === activeDraft.side && c.lineNo === activeDraft.lineNo)
              ?.body ?? ''
          }
          onSave={saveDraft}
          onCancel={cancelDraft}
        />
      )}
    </div>
  );
}
