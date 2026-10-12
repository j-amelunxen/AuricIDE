import type { ConflictSegment, MergeSegment, Resolution } from '@/lib/git/merge/conflictModel';
import { wordDiff, type WordSpan } from '@/lib/git/wordDiff';
import type {
  GitConflictKind,
  GitMergePreview,
  GitOperation,
  GitOperationStep,
} from '@/lib/tauri/gitMerge';

/**
 * Copy and small derivations for the merge panel. Pure, so the words the
 * panel uses are tested once rather than asserted in every component test.
 * The UI never says "ours"/"theirs" alone: every side is named by its branch.
 */

export type Side = 'ours' | 'theirs';

export interface SideLabels {
  ours: string;
  theirs: string;
  /** What each side *is* in this operation. Default: a merge, "yours" and "incoming". */
  oursRole?: string;
  theirsRole?: string;
}

export function roleOf(labels: SideLabels, side: Side): string {
  return side === 'ours' ? (labels.oursRole ?? 'yours') : (labels.theirsRole ?? 'incoming');
}

export function sideName(labels: SideLabels, side: Side): string {
  return `${side === 'ours' ? labels.ours : labels.theirs} (${roleOf(labels, side)})`;
}

export interface OperationCopy {
  oursRole: string;
  theirsRole: string;
  /** The headline verb phrase around the two names: `${lead} THEIRS ${join} OURS`. */
  lead: string;
  join: string;
  /**
   * The Source Control banner button that finishes the operation once every
   * file is resolved; null for a merge, which finishes with Commit merge.
   */
  continueLabel: string | null;
}

/**
 * Git names the sides differently per operation, and a rebase inverts them:
 * HEAD is the upstream being rebased onto, the incoming side is your own
 * commit being replayed. Saying "yours" there would point at the wrong code.
 */
export function operationCopy(operation: GitOperation | undefined): OperationCopy {
  switch (operation) {
    case 'rebase':
      return {
        oursRole: 'upstream',
        theirsRole: 'your commit',
        lead: 'Rebasing: replaying',
        join: 'onto',
        continueLabel: 'Continue rebase',
      };
    case 'cherry-pick':
      return {
        oursRole: 'yours',
        theirsRole: 'picked',
        lead: 'Cherry-picking',
        join: 'onto',
        continueLabel: 'Continue cherry-pick',
      };
    case 'revert':
      return {
        oursRole: 'yours',
        theirsRole: 'reverted',
        lead: 'Reverting',
        join: 'on',
        continueLabel: 'Continue revert',
      };
    default:
      return {
        oursRole: 'yours',
        theirsRole: 'incoming',
        lead: 'Merging',
        join: 'into',
        continueLabel: null,
      };
  }
}

export function labelsFor(
  ours: string,
  theirs: string,
  operation: GitOperation | undefined
): SideLabels {
  const copy = operationCopy(operation);
  return { ours, theirs, oursRole: copy.oursRole, theirsRole: copy.theirsRole };
}

/** What a chosen resolution did, in one short phrase for the resolved card and the live region. */
export function resolutionSummary(resolution: Resolution, labels: SideLabels): string {
  switch (resolution.kind) {
    case 'ours':
      return `Took ${sideName(labels, 'ours')}`;
    case 'theirs':
      return `Took ${sideName(labels, 'theirs')}`;
    case 'base':
      return 'Kept the original';
    case 'both':
      return resolution.first === 'ours'
        ? `Kept both, ${labels.ours} first`
        : `Kept both, ${labels.theirs} first`;
    case 'custom':
      if (resolution.source === 'agent') return 'Accepted the agent proposal';
      if (resolution.source === 'auto') return 'Resolved automatically';
      return 'Edited by hand';
  }
}

/**
 * How a file's conflicts were settled, for the done state:
 * "5 resolved: 2 automatic, 1 yours, 1 incoming, 1 agent". A conflict the
 * wand settled counts as automatic, not as the side it happened to keep.
 */
export function resolutionBreakdown(
  resolutions: Readonly<Record<number, Resolution>>,
  autoReasons: Readonly<Record<number, string>>,
  labels: SideLabels
): string | null {
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  const entries = Object.entries(resolutions);
  for (const [index, resolution] of entries) {
    if (autoReasons[Number(index)] !== undefined) bump('automatic');
    else if (resolution.kind === 'ours') bump(roleOf(labels, 'ours'));
    else if (resolution.kind === 'theirs') bump(roleOf(labels, 'theirs'));
    else if (resolution.kind === 'both') bump('both');
    else if (resolution.kind === 'base') bump('original');
    else if (resolution.source === 'agent') bump('agent');
    else if (resolution.source === 'auto') bump('automatic');
    else bump('by hand');
  }
  if (entries.length === 0) return null;
  const order = [
    'automatic',
    roleOf(labels, 'ours'),
    roleOf(labels, 'theirs'),
    'both',
    'original',
    'by hand',
    'agent',
  ];
  const parts = order.filter((k) => counts.has(k)).map((k) => `${counts.get(k)} ${k}`);
  return `${entries.length} resolved: ${parts.join(', ')}`;
}

export function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Why a file cannot be merged line by line, for files git gave no markered text. */
export function pickExplanation(kind: GitConflictKind, labels: SideLabels): string {
  switch (kind) {
    case 'deleted-by-us':
      return `${sideName(labels, 'ours')} deleted this file. ${sideName(labels, 'theirs')} changed it.`;
    case 'deleted-by-them':
      return `${sideName(labels, 'theirs')} deleted this file. ${sideName(labels, 'ours')} changed it.`;
    case 'binary':
      return 'This is a binary file. Both sides changed it, so pick the version to keep.';
    case 'symlink':
      return 'Both sides changed where this link points. Pick the target to keep.';
    default:
      return 'Git could not write this conflict as text. Pick the version to keep.';
  }
}

export interface PickOption {
  pick: 'ours' | 'theirs' | 'delete';
  label: string;
  /** A pick that removes the file asks first. */
  deletes: boolean;
}

/** The honest choices per kind: on a delete/modify conflict one side *is* the deletion. */
export function pickOptions(kind: GitConflictKind, labels: SideLabels): PickOption[] {
  if (kind === 'deleted-by-us') {
    return [
      { pick: 'ours', label: `Delete it, like ${labels.ours}`, deletes: true },
      { pick: 'theirs', label: `Take ${labels.theirs}'s version`, deletes: false },
    ];
  }
  if (kind === 'deleted-by-them') {
    return [
      { pick: 'ours', label: `Take ${labels.ours}'s version`, deletes: false },
      { pick: 'theirs', label: `Delete it, like ${labels.theirs}`, deletes: true },
    ];
  }
  return [
    { pick: 'ours', label: `Take ${sideName(labels, 'ours')}`, deletes: false },
    { pick: 'theirs', label: `Take ${sideName(labels, 'theirs')}`, deletes: false },
    { pick: 'delete', label: 'Delete the file', deletes: true },
  ];
}

const WORD_DIFF_MAX_LINES = 60;

/**
 * Word-level highlights between the two sides, pairing line i with line i.
 * Only when both sides have the same number of lines: anything else would
 * need a line alignment, and a wrong alignment highlights noise.
 */
export function pairedWordSpans(
  ours: readonly string[],
  theirs: readonly string[]
): { ours: (WordSpan[] | null)[]; theirs: (WordSpan[] | null)[] } | null {
  if (ours.length !== theirs.length || ours.length > WORD_DIFF_MAX_LINES) return null;
  const left: (WordSpan[] | null)[] = [];
  const right: (WordSpan[] | null)[] = [];
  ours.forEach((line, i) => {
    if (line === theirs[i]) {
      left.push(null);
      right.push(null);
      return;
    }
    const spans = wordDiff(line, theirs[i]);
    left.push(spans.left);
    right.push(spans.right);
  });
  return { ours: left, theirs: right };
}

export const CONTEXT_LINES = 3;

export interface CleanView {
  /** Lines shown before the fold, with their 1-based line number in your file. */
  head: { text: string; lineNo: number }[];
  hidden: { text: string; lineNo: number }[];
  tail: { text: string; lineNo: number }[];
}

/**
 * Folds one clean run to the context a reader needs around the conflicts:
 * the last lines before the first conflict, the first lines after the last,
 * and both ends of a run between two. A fold of one or two lines is not
 * worth a button, so short runs show whole.
 */
export function foldClean(
  lines: readonly string[],
  firstLineNo: number,
  position: { first: boolean; last: boolean }
): CleanView {
  const numbered = lines.map((text, i) => ({ text, lineNo: firstLineNo + i }));
  const keepHead = position.first ? 0 : CONTEXT_LINES;
  const keepTail = position.last ? 0 : CONTEXT_LINES;
  if (numbered.length <= keepHead + keepTail + 2) {
    return { head: numbered, hidden: [], tail: [] };
  }
  return {
    head: numbered.slice(0, keepHead),
    hidden: numbered.slice(keepHead, numbered.length - keepTail),
    tail: numbered.slice(numbered.length - keepTail),
  };
}

/** Line numbers each segment starts at, in your file and in the incoming one. */
export function segmentLineNumbers(
  segments: readonly MergeSegment[]
): { ours: number; theirs: number }[] {
  let ours = 1;
  let theirs = 1;
  return segments.map((seg) => {
    const start = { ours, theirs };
    if (seg.kind === 'clean') {
      ours += seg.lines.length;
      theirs += seg.lines.length;
    } else if (seg.kind === 'conflict') {
      ours += seg.ours.length;
      theirs += seg.theirs.length;
    }
    return start;
  });
}

export function conflictsOf(segments: readonly MergeSegment[]): ConflictSegment[] {
  return segments.filter((seg): seg is ConflictSegment => seg.kind === 'conflict');
}

const PREVIEW_FILES = 3;

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** What merging a branch would do, for the line under it in the Merge… menu. */
export function previewSummary(preview: GitMergePreview): string {
  const commits = pluralize(preview.commits, 'commit', 'commits');
  switch (preview.outcome) {
    case 'up-to-date':
      return 'Already merged';
    case 'fast-forward':
      return `${commits} · fast-forward`;
    case 'clean':
      return `${commits} · merges cleanly`;
    case 'conflicts': {
      const names = preview.conflicts.slice(0, PREVIEW_FILES).map(baseName).join(', ');
      const more = preview.conflicts.length - PREVIEW_FILES;
      const files = pluralize(preview.conflicts.length, 'file', 'files');
      return `Conflicts in ${files}: ${names}${more > 0 ? ` and ${more} more` : ''}`;
    }
  }
}

/** "Replaying commit 2 of 5: Add the parser", or null when git left no progress to read. */
export function stepLine(step: GitOperationStep | null | undefined): string | null {
  if (!step) return null;
  const head = `Replaying commit ${step.current} of ${step.total}`;
  return step.subject ? `${head}: ${step.subject}` : head;
}

export interface StepCopy {
  continueLabel: string;
  skipLabel: string;
  skipMessage: string;
  abortLabel: string;
  abortMessage: string;
}

/**
 * The banner's buttons for a rebase, cherry-pick or revert. Abort says what
 * comes back, because `rebase --abort` is a hard reset to where it started.
 */
export function stepCopy(operation: GitOperation, ours: string): StepCopy {
  const name = operation === 'rebase' || operation === 'revert' ? operation : 'cherry-pick';
  const abortMessage =
    operation === 'rebase'
      ? `${ours} goes back to the commit it was on before the rebase started. Every commit replayed so far and every conflict you resolved is dropped.`
      : `${ours} goes back to where it was before the ${name} started. Conflicts you resolved are dropped; other uncommitted edits stay.`;
  const skipMessage =
    operation === 'rebase'
      ? 'The commit being replayed is left out of the rebased branch, and what you resolved for it is dropped. The rebase moves on to the next commit.'
      : `This commit is left out, and what you resolved for it is dropped. The ${name} moves on to the next commit, if there is one.`;
  return {
    continueLabel: operationCopy(operation).continueLabel ?? `Continue ${name}`,
    skipLabel: 'Skip this commit',
    skipMessage,
    abortLabel: `Abort ${name}`,
    abortMessage,
  };
}
