'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import {
  applyDiffLineEdit,
  canEditStagedAgainstWorktree,
  isEditableDiffSource,
  reloadDiffPatch,
} from '@/lib/git/applyLineEdit';
import type { DiffSource } from '@/lib/git/diffTab';
import {
  openReviewCommentsSpawn,
  type ReviewComment,
  type ReviewCommentSide,
} from '@/lib/git/reviewComments';
import { useStore } from '@/lib/store';
import {
  buildSideBySideRows,
  parseDiff,
  type DiffLine,
  type SideBySideRow,
} from '@/lib/git/parseDiff';
import { wordDiff, type WordSpan } from '@/lib/git/wordDiff';

export type { DiffLine, SideBySideRow };
export { parseDiff, buildSideBySideRows };

const lineStyles: Record<DiffLine['type'], string> = {
  added: 'bg-green-900/30 text-green-300',
  removed: 'bg-red-900/30 text-red-300',
  context: 'text-foreground-muted',
  header: 'bg-blue-900/20 text-blue-300 font-bold',
};

const TEXT_WRAP = 'min-w-0 flex-1 whitespace-pre-wrap break-all pr-4';
const COLUMN = 'flex w-1/2 min-w-0 overflow-hidden';

export interface DiffViewerProps {
  diff: string;
  fileName: string;
  /** Absolute work-tree path. Required to write inline edits. */
  repoPath?: string;
  source?: DiffSource;
}

interface EditSession {
  lineNo: number;
  draft: string;
  original: string;
}

interface LineEditApi {
  canEditFile: boolean;
  edit: EditSession | null;
  saving: boolean;
  startEdit: (lineNo: number, content: string) => void;
  setDraft: (draft: string) => void;
  commitEdit: () => void;
  cancelEdit: () => void;
}

const LineEditContext = createContext<LineEditApi | null>(null);

function useLineEdit(): LineEditApi {
  const ctx = useContext(LineEditContext);
  if (!ctx) {
    throw new Error('LineEditContext missing');
  }
  return ctx;
}

function lineIsEditable(line: DiffLine | null | undefined, canEditFile: boolean): boolean {
  return (
    canEditFile &&
    !!line &&
    line.newLineNo !== null &&
    (line.type === 'added' || line.type === 'context')
  );
}

interface CommentTarget {
  lineNo: number;
  side: ReviewCommentSide;
  lineContent: string;
}

function commentTargetFor(
  line: DiffLine | null | undefined,
  prefer: 'auto' | 'old' | 'new'
): CommentTarget | null {
  if (!line || line.type === 'header') return null;
  if (prefer === 'old') {
    if (line.type !== 'removed' || line.oldLineNo === null) return null;
    return { lineNo: line.oldLineNo, side: 'old', lineContent: line.content };
  }
  if (prefer === 'new') {
    if ((line.type !== 'added' && line.type !== 'context') || line.newLineNo === null) {
      return null;
    }
    return { lineNo: line.newLineNo, side: 'new', lineContent: line.content };
  }
  if (line.newLineNo !== null) {
    return { lineNo: line.newLineNo, side: 'new', lineContent: line.content };
  }
  if (line.oldLineNo !== null) {
    return { lineNo: line.oldLineNo, side: 'old', lineContent: line.content };
  }
  return null;
}

function commentButtonLabel(target: CommentTarget): string {
  return target.side === 'old'
    ? `Comment on old line ${target.lineNo}`
    : `Comment on line ${target.lineNo}`;
}

function sameCommentTarget(a: CommentTarget, b: CommentTarget): boolean {
  return a.side === b.side && a.lineNo === b.lineNo;
}

interface LineCommentApi {
  enabled: boolean;
  comments: ReviewComment[];
  draft: CommentTarget | null;
  startDraft: (target: CommentTarget) => void;
  cancelDraft: () => void;
  saveDraft: (body: string) => void;
  removeComment: (id: string) => void;
}

const LineCommentContext = createContext<LineCommentApi | null>(null);

function useLineComment(): LineCommentApi {
  const ctx = useContext(LineCommentContext);
  if (!ctx) {
    throw new Error('LineCommentContext missing');
  }
  return ctx;
}

function isHunkHeader(line: DiffLine | null | undefined): boolean {
  return !!line && line.type === 'header' && line.content.startsWith('@@');
}

function hunkCountOf(lines: DiffLine[]): number {
  return lines.filter(isHunkHeader).length;
}

function LineContent({
  content,
  spans,
  changedClass,
}: {
  content: string;
  spans?: WordSpan[] | null;
  changedClass?: string;
}) {
  return (
    <span className={TEXT_WRAP}>
      {spans
        ? spans.map((span, i) =>
            span.changed ? (
              <span key={i} className={changedClass}>
                {span.text}
              </span>
            ) : (
              <span key={i}>{span.text}</span>
            )
          )
        : content}
    </span>
  );
}

function EditableLineBody({
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

const GUTTER_BTN =
  'relative mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-muted transition-opacity duration-150 before:absolute before:-inset-2 hover:bg-hover-bg hover:text-foreground focus-visible:opacity-100 active:scale-[0.96]';

function CommentButton({ target }: { target: CommentTarget }) {
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

function CommentPane({ targets }: { targets: CommentTarget[] }) {
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

function CommentComposer({
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

export function DiffViewer({ diff, fileName, repoPath, source }: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<'unified' | 'side-by-side'>('side-by-side');
  const [activeHunk, setActiveHunk] = useState(0);
  const [edit, setEdit] = useState<EditSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [commentDraft, setCommentDraft] = useState<CommentTarget | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const lines = parseDiff(diff);
  const hunkCount = hunkCountOf(lines);

  const fileStatus = useStore((s) => {
    if (!repoPath) return undefined;
    return s.repoStates[repoPath]?.fileStatuses.find((f) => f.path === fileName);
  });
  const canEditFile =
    !!repoPath &&
    !!source &&
    isEditableDiffSource(source) &&
    (source.kind !== 'staged' || canEditStagedAgainstWorktree(fileStatus));

  const startEdit = useCallback(
    (lineNo: number, content: string) => {
      if (!canEditFile) return;
      setEdit({ lineNo, draft: content, original: content });
    },
    [canEditFile]
  );

  const setDraft = useCallback((draft: string) => {
    setEdit((current) => (current ? { ...current, draft } : current));
  }, []);

  const cancelEdit = useCallback(() => {
    if (saving) return;
    setEdit(null);
  }, [saving]);

  const commitEdit = useCallback(async () => {
    if (!edit || !repoPath || !source || saving) return;
    if (edit.draft === edit.original) {
      setEdit(null);
      return;
    }
    setSaving(true);
    try {
      await applyDiffLineEdit({
        repoPath,
        filePath: fileName,
        lineNo: edit.lineNo,
        expected: edit.original,
        nextText: edit.draft,
        restage: source.kind === 'staged',
      });
      const store = useStore.getState();
      const tabId = store.activeTabId;
      const current = tabId ? store.diffByTabId[tabId] : undefined;
      const patch = await reloadDiffPatch(repoPath, fileName, source);
      if (tabId && current) {
        store.setDiffTab(tabId, { ...current, patch });
      }
      await store.refreshRepoStatus(repoPath);
      setEdit(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useStore.getState().showToast(message, 'error');
    } finally {
      setSaving(false);
    }
  }, [edit, fileName, repoPath, saving, source]);

  const comments = useStore((s) => s.reviewComments);
  const canComment = !!repoPath;

  const startCommentDraft = useCallback((target: CommentTarget) => {
    setCommentDraft(target);
  }, []);

  const cancelCommentDraft = useCallback(() => {
    setCommentDraft(null);
  }, []);

  const saveCommentDraft = useCallback(
    (body: string) => {
      if (!repoPath || !commentDraft) return;
      useStore.getState().upsertReviewComment({
        repoPath,
        filePath: fileName,
        lineNo: commentDraft.lineNo,
        side: commentDraft.side,
        lineContent: commentDraft.lineContent,
        body,
      });
      setCommentDraft(null);
    },
    [commentDraft, fileName, repoPath]
  );

  const removeComment = useCallback((id: string) => {
    useStore.getState().removeReviewComment(id);
  }, []);

  const sendComments = useCallback(() => {
    if (!repoPath) return;
    openReviewCommentsSpawn(useStore.getState(), useStore.getState().reviewComments, repoPath);
  }, [repoPath]);

  const fileComments = useMemo(
    () =>
      comments.filter((comment) => {
        if (!repoPath) return false;
        return comment.repoPath === repoPath && comment.filePath === fileName;
      }),
    [comments, fileName, repoPath]
  );
  const repoCommentCount = repoPath
    ? comments.filter((comment) => comment.repoPath === repoPath && comment.body.trim()).length
    : 0;

  const lineComment = useMemo<LineCommentApi>(
    () => ({
      enabled: canComment,
      comments: fileComments,
      draft: commentDraft,
      startDraft: startCommentDraft,
      cancelDraft: cancelCommentDraft,
      saveDraft: saveCommentDraft,
      removeComment,
    }),
    [
      canComment,
      cancelCommentDraft,
      commentDraft,
      fileComments,
      removeComment,
      saveCommentDraft,
      startCommentDraft,
    ]
  );

  const lineEdit = useMemo<LineEditApi>(
    () => ({
      canEditFile,
      edit,
      saving,
      startEdit,
      setDraft,
      commitEdit,
      cancelEdit,
    }),
    [canEditFile, cancelEdit, commitEdit, edit, saving, setDraft, startEdit]
  );

  const goToHunk = useCallback(
    (index: number) => {
      if (hunkCount === 0) return;
      const next = ((index % hunkCount) + hunkCount) % hunkCount;
      setActiveHunk(next);
      viewerRef.current
        ?.querySelector(`[data-hunk-index="${next}"]`)
        ?.scrollIntoView({ block: 'start' });
    },
    [hunkCount]
  );

  const goToHunkRef = useRef(goToHunk);
  const activeHunkRef = useRef(activeHunk);

  useEffect(() => {
    goToHunkRef.current = goToHunk;
    activeHunkRef.current = activeHunk;
  });

  useEffect(() => {
    let lastNonce = useStore.getState().hunkNavNonce;
    return useStore.subscribe((s) => {
      if (s.hunkNavNonce === lastNonce || !s.hunkNavDirection) return;
      lastNonce = s.hunkNavNonce;
      const current = activeHunkRef.current;
      goToHunkRef.current(s.hunkNavDirection === 'next' ? current + 1 : current - 1);
    });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLTextAreaElement) return;
    if (!event.altKey) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      goToHunk(activeHunk + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      goToHunk(activeHunk - 1);
    }
  };

  if (!diff.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
        No changes
      </div>
    );
  }

  return (
    <div
      ref={viewerRef}
      data-testid="diff-viewer"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex h-full flex-col overflow-hidden bg-editor-bg"
    >
      <div className="flex items-center gap-2 border-b border-border-dark px-4 py-2">
        <AuricIcon name="difference" className="text-sm text-primary-light" />
        <span className="text-xs font-medium text-foreground">{fileName}</span>
        {canEditFile && (
          <span className="text-[10px] text-foreground-muted">Double-click a line to edit</span>
        )}
        {canComment && (
          <span className="text-[10px] text-foreground-muted">Comment a line for the agent</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {repoCommentCount > 0 && (
            <button
              type="button"
              data-testid="diff-send-comments"
              onClick={sendComments}
              className="mr-1 flex items-center gap-1 rounded px-2 py-0.5 text-xs text-primary hover:bg-primary/10 active:scale-[0.96]"
              title="Send review comments to an agent"
            >
              <AuricIcon name="bolt" className="text-sm" />
              Send {repoCommentCount} {repoCommentCount === 1 ? 'comment' : 'comments'}
            </button>
          )}
          <button
            data-testid="diff-prev-hunk"
            onClick={() => goToHunk(activeHunk - 1)}
            className="flex items-center rounded px-1.5 py-0.5 text-xs text-foreground-muted hover:bg-hover-bg hover:text-foreground"
            title="Previous hunk"
          >
            <AuricIcon name="arrow_upward" className="text-sm" />
          </button>
          <button
            data-testid="diff-next-hunk"
            onClick={() => goToHunk(activeHunk + 1)}
            className="flex items-center rounded px-1.5 py-0.5 text-xs text-foreground-muted hover:bg-hover-bg hover:text-foreground"
            title="Next hunk"
          >
            <AuricIcon name="arrow_downward" className="text-sm" />
          </button>
          <button
            data-testid="diff-view-toggle"
            onClick={() => setViewMode((m) => (m === 'unified' ? 'side-by-side' : 'unified'))}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-foreground-muted hover:bg-hover-bg hover:text-foreground"
            title={viewMode === 'unified' ? 'Switch to side-by-side' : 'Switch to unified'}
          >
            <AuricIcon
              name={viewMode === 'unified' ? 'view_column_2' : 'view_agenda'}
              className="text-sm"
            />
            {viewMode === 'unified' ? 'Side-by-side' : 'Unified'}
          </button>
        </div>
      </div>
      <LineCommentContext.Provider value={lineComment}>
        <LineEditContext.Provider value={lineEdit}>
          {viewMode === 'unified' ? (
            <UnifiedView lines={lines} />
          ) : (
            <SideBySideView lines={lines} />
          )}
        </LineEditContext.Provider>
      </LineCommentContext.Provider>
    </div>
  );
}

function UnifiedView({ lines }: { lines: DiffLine[] }) {
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

function SideBySideView({ lines }: { lines: DiffLine[] }) {
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
