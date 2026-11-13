import { useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { Kbd } from './Kbd';
import { useLineComment } from './LineCommentContext';
import { sortReviewComments, type ReviewComment } from '@/lib/git/reviewComments';
import {
  commentButtonLabel,
  replyButtonLabel,
  sameCommentTarget,
  type CommentDraft,
  type CommentTarget,
  GUTTER_BTN,
} from './types';

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
        aria-keyshortcuts="Meta+Enter Escape"
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
          aria-keyshortcuts="Meta+Enter"
          className="min-h-6 rounded bg-primary/15 px-2 text-[11px] font-medium text-primary hover:bg-primary/25 motion-safe:active:scale-[0.96]"
        >
          Save comment
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-keyshortcuts="Escape"
          className="min-h-6 rounded px-2 text-[11px] text-foreground-muted hover:bg-hover-bg hover:text-foreground"
        >
          Cancel
        </button>
        <span className="flex items-center gap-1 text-[11px] text-foreground-muted">
          <Kbd>⌘↵</Kbd>
          <span aria-hidden="true">to save</span>
        </span>
      </div>
    </div>
  );
}

const ROW_BUTTON =
  'flex h-6 w-6 shrink-0 items-center justify-center rounded text-foreground-muted hover:bg-hover-bg hover:text-foreground motion-safe:active:scale-[0.96]';

/** One comment of a thread. A sent one is the record of what the agent was told: muted, read only. */
function CommentEntry({ comment }: { comment: ReviewComment }) {
  const { editComment, removeComment } = useLineComment();
  const sent = comment.sentInRound !== undefined;
  return (
    <div
      data-testid="diff-line-comment"
      data-sent={sent || undefined}
      className="mb-2 flex items-start gap-2 last:mb-0"
    >
      <AuricIcon
        name={sent ? 'task_alt' : 'rate_review'}
        aria-hidden="true"
        className={`mt-0.5 shrink-0 text-sm ${sent ? 'text-foreground-muted' : 'text-primary'}`}
      />
      <p
        className={`min-w-0 flex-1 whitespace-pre-wrap ${
          sent ? 'text-foreground-muted' : 'text-foreground'
        }`}
      >
        {comment.body}
      </p>
      {sent ? (
        <span className="shrink-0 text-[11px] text-foreground-muted">
          Sent in round {comment.sentInRound}
        </span>
      ) : (
        <>
          <button
            type="button"
            aria-label="Edit comment"
            title="Edit comment"
            onClick={() => editComment(comment)}
            className={ROW_BUTTON}
          >
            <AuricIcon name="edit" className="text-sm" />
          </button>
          <button
            type="button"
            aria-label="Remove comment"
            title="Remove comment"
            onClick={() => removeComment(comment.id)}
            className={ROW_BUTTON}
          >
            <AuricIcon name="close" className="text-sm" />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The comments on one line, oldest first. The composer replaces the comment it
 * rewrites, or follows the thread for a new one; otherwise Reply offers one.
 */
function CommentThread({
  target,
  comments,
  draft,
}: {
  target: CommentTarget;
  comments: ReviewComment[];
  draft: CommentDraft | null;
}) {
  const { startDraft, cancelDraft, saveDraft } = useLineComment();
  const composer = (initial: string) => (
    <CommentComposer initial={initial} onSave={saveDraft} onCancel={cancelDraft} />
  );
  return (
    <div data-testid="diff-comment-thread" className="mb-2 last:mb-0">
      {comments.map((comment) =>
        draft?.editingId === comment.id ? (
          <div key={comment.id} className="mb-2">
            {composer(comment.body)}
          </div>
        ) : (
          <CommentEntry key={comment.id} comment={comment} />
        )
      )}
      {draft && !draft.editingId ? composer('') : null}
      {!draft && comments.length > 0 ? (
        <button
          type="button"
          aria-label={replyButtonLabel(target)}
          onClick={() => startDraft(target)}
          className="mt-1 flex min-h-6 items-center gap-1 rounded px-1.5 text-[11px] text-foreground-muted hover:bg-hover-bg hover:text-foreground motion-safe:active:scale-[0.96]"
        >
          <AuricIcon name="rate_review" className="text-[13px]" />
          Reply
        </button>
      ) : null}
    </div>
  );
}

export function CommentPane({ targets }: { targets: CommentTarget[] }) {
  const { enabled, comments, draft } = useLineComment();
  if (!enabled || targets.length === 0) return null;

  const threads = targets
    .map((target) => ({
      target,
      comments: sortReviewComments(comments.filter((c) => sameCommentTarget(c, target))),
      draft: draft && sameCommentTarget(target, draft) ? draft : null,
    }))
    .filter((thread) => thread.comments.length > 0 || thread.draft);
  if (threads.length === 0) return null;

  return (
    <div
      className="border-t border-border-dark bg-panel-bg/70 px-3 py-2 font-sans text-xs"
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {threads.map((thread) => (
        <CommentThread
          key={`${thread.target.side}:${thread.target.lineNo}`}
          target={thread.target}
          comments={thread.comments}
          draft={thread.draft}
        />
      ))}
    </div>
  );
}
