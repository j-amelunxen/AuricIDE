import type { DiffLine } from '@/lib/git/parseDiff';
import type { DiffSource } from '@/lib/git/diffTab';
import type { ReviewComment, ReviewCommentSide } from '@/lib/git/reviewComments';

export const lineStyles: Record<DiffLine['type'], string> = {
  added: 'bg-green-900/30 text-green-300',
  removed: 'bg-red-900/30 text-red-300',
  context: 'text-foreground-muted',
  header: 'bg-blue-900/20 text-blue-300 font-bold',
};

export const TEXT_WRAP = 'min-w-0 flex-1 whitespace-pre-wrap break-all pr-4';
export const COLUMN = 'flex w-1/2 min-w-0 overflow-hidden';
export const GUTTER_BTN =
  'relative mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-muted transition-opacity duration-150 before:absolute before:-inset-2 hover:bg-hover-bg hover:text-foreground focus-visible:opacity-100 motion-safe:active:scale-[0.96]';

export interface DiffViewerProps {
  diff: string;
  fileName: string;
  /** Absolute work-tree path. Required to write inline edits. */
  repoPath?: string;
  source?: DiffSource;
}

export interface EditSession {
  lineNo: number;
  draft: string;
  original: string;
}

export interface LineEditApi {
  canEditFile: boolean;
  edit: EditSession | null;
  saving: boolean;
  startEdit: (lineNo: number, content: string) => void;
  setDraft: (draft: string) => void;
  commitEdit: () => void;
  cancelEdit: () => void;
}

export interface CommentTarget {
  lineNo: number;
  side: ReviewCommentSide;
  lineContent: string;
}

/** The composer that is open: a new comment on a line, or an open comment being rewritten. */
export interface CommentDraft extends CommentTarget {
  /** The open comment being rewritten; absent for a new comment. */
  editingId?: string;
}

export interface LineCommentApi {
  enabled: boolean;
  comments: ReviewComment[];
  draft: CommentDraft | null;
  /** Opens the composer for a new comment on the line, beside any it already has. */
  startDraft: (target: CommentTarget) => void;
  /** Opens the composer on an open comment. Sent comments are not edited. */
  editComment: (comment: ReviewComment) => void;
  cancelDraft: () => void;
  saveDraft: (body: string) => void;
  removeComment: (id: string) => void;
}

export function lineIsEditable(line: DiffLine | null | undefined, canEditFile: boolean): boolean {
  return (
    canEditFile &&
    !!line &&
    line.newLineNo !== null &&
    (line.type === 'added' || line.type === 'context')
  );
}

export function commentTargetFor(
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

export function commentButtonLabel(target: CommentTarget): string {
  return target.side === 'old'
    ? `Comment on old line ${target.lineNo}`
    : `Comment on line ${target.lineNo}`;
}

export function replyButtonLabel(target: CommentTarget): string {
  return target.side === 'old'
    ? `Reply on old line ${target.lineNo}`
    : `Reply on line ${target.lineNo}`;
}

/**
 * Where `C` opens a comment for a hunk: its first added line on the new side,
 * or, when the hunk only removes, its first removed line on the old side.
 */
export function hunkCommentTarget(lines: DiffLine[], hunkIndex: number): CommentTarget | null {
  let hunk = -1;
  let removed: CommentTarget | null = null;
  for (const line of lines) {
    if (isHunkHeader(line)) {
      if (hunk === hunkIndex) break;
      hunk++;
      continue;
    }
    if (hunk !== hunkIndex) continue;
    if (line.type === 'added') return commentTargetFor(line, 'new');
    if (line.type === 'removed' && !removed) removed = commentTargetFor(line, 'old');
  }
  return removed;
}

export function sameCommentTarget(a: CommentTarget, b: CommentTarget): boolean {
  return a.side === b.side && a.lineNo === b.lineNo;
}

export function isHunkHeader(line: DiffLine | null | undefined): boolean {
  return !!line && line.type === 'header' && line.content.startsWith('@@');
}

export function hunkCountOf(lines: DiffLine[]): number {
  return lines.filter(isHunkHeader).length;
}
