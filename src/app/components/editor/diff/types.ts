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
  'relative mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-muted transition-opacity duration-150 before:absolute before:-inset-2 hover:bg-hover-bg hover:text-foreground focus-visible:opacity-100 active:scale-[0.96]';

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

export interface LineCommentApi {
  enabled: boolean;
  comments: ReviewComment[];
  draft: CommentTarget | null;
  startDraft: (target: CommentTarget) => void;
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

export function sameCommentTarget(a: CommentTarget, b: CommentTarget): boolean {
  return a.side === b.side && a.lineNo === b.lineNo;
}

export function isHunkHeader(line: DiffLine | null | undefined): boolean {
  return !!line && line.type === 'header' && line.content.startsWith('@@');
}

export function hunkCountOf(lines: DiffLine[]): number {
  return lines.filter(isHunkHeader).length;
}
