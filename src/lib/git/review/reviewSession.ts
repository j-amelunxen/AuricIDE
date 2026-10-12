/**
 * A review session is a tab over a change set, not over one file
 * (`docs/design-merge-panel.md`, "The diff viewer is a review panel now").
 * Pure helpers: tab ids, the review order, and viewed marks bookkept by the
 * content of the patch the reviewer saw.
 */
import { fileRiskScore, isGeneratedPath, isLockfile, type RiskFlag } from './riskFlags';

/**
 * What a ref session diffs against. `merge-base`: the commit where the branch
 * left `ref`, so commits that landed on `ref` since do not show up reversed.
 * `tip`: the merge base could not be found and the session compares with the
 * tip of `ref`, saying why. Absent: the tip, by choice.
 */
export type ReviewBase = { kind: 'merge-base'; oid: string } | { kind: 'tip'; reason: string };

export type ReviewSource =
  | { kind: 'worktree'; repoPath: string }
  | { kind: 'ref'; repoPath: string; ref: string; base?: ReviewBase };

export type ReviewFileStatus = 'added' | 'modified' | 'deleted' | 'untracked' | 'conflicted';

export interface ReviewFile {
  /** Repo-relative, '/'-separated. */
  path: string;
  status: ReviewFileStatus;
  /** git's patch text; empty for conflicted files (the merge panel owns those). */
  patch: string;
  flags: RiskFlag[];
  /** `patchHash(patch)`: what a viewed mark is compared against. */
  hash: string;
  /** Set when this one file's patch could not be read; the rest of the session still loads. */
  loadError?: string;
}

const MARKS_SEPARATOR = '\u0000';

/**
 * Viewed marks are kept per repo *and* source: the same file reviewed as a
 * working tree and against `main` shows two different patches, and a mark
 * for one must not count for the other.
 */
export function viewedMarksKey(source: ReviewSource): string {
  return `${source.repoPath}${MARKS_SEPARATOR}${reviewSourceKey(source)}`;
}

export function repoOfMarksKey(key: string): string {
  const split = key.indexOf(MARKS_SEPARATOR);
  return split === -1 ? key : key.slice(0, split);
}

/** Marks stored before they were per source were all made in working-tree sessions. */
export function migrateMarksKey(key: string): string {
  return key.includes(MARKS_SEPARATOR) ? key : viewedMarksKey({ kind: 'worktree', repoPath: key });
}

/** filePath → hash of the patch that was on screen when the file was marked viewed. */
export type ViewedMarks = Record<string, string>;

export type ViewedState = 'unviewed' | 'viewed' | 'changed-since-viewed';

// ── Tab ids ────────────────────────────────────────────────────────

const PREFIX = 'review:';
const WORKTREE_KEY = 'worktree';
const REF_KEY = 'ref=';

/** The part of the tab id after the repo path. Refs are URI-encoded, so it never holds ':'. */
export function reviewSourceKey(source: ReviewSource): string {
  return source.kind === 'worktree' ? WORKTREE_KEY : `${REF_KEY}${encodeURIComponent(source.ref)}`;
}

/** The revision a ref session's patches are read against. The tab id and the UI keep `ref`. */
export function diffTargetOf(source: Extract<ReviewSource, { kind: 'ref' }>): string {
  return source.base?.kind === 'merge-base' ? source.base.oid : source.ref;
}

export function reviewTabId(source: ReviewSource): string {
  return `${PREFIX}${source.repoPath}:${reviewSourceKey(source)}`;
}

export function isReviewTabId(id: string): boolean {
  return id.startsWith(PREFIX);
}

/** The source a tab id was built from, or `null` when it is not a review tab id. */
export function parseReviewTabId(id: string): ReviewSource | null {
  if (!isReviewTabId(id)) return null;
  const rest = id.slice(PREFIX.length);
  const split = rest.lastIndexOf(':');
  if (split <= 0) return null;
  const repoPath = rest.slice(0, split);
  const key = rest.slice(split + 1);
  if (key === WORKTREE_KEY) return { kind: 'worktree', repoPath };
  if (key.startsWith(REF_KEY)) {
    try {
      return { kind: 'ref', repoPath, ref: decodeURIComponent(key.slice(REF_KEY.length)) };
    } catch {
      return null;
    }
  }
  return null;
}

// ── Viewed marks ───────────────────────────────────────────────────

const FNV_PRIME = 0x01000193;

function fnv1a(text: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** What the hash reads: hunk bodies only, with a fixed marker where each hunk starts. */
function hashInput(patch: string): string {
  const lines = patch.split('\n');
  const body: string[] = [];
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      body.push('@@');
    } else if (inHunk && /^[ +\-\\]/.test(line)) {
      body.push(line);
    }
  }
  // A binary change has no hunk; its index line is the only thing that moves.
  return body.length > 0 ? body.join('\n') : patch;
}

/**
 * Stable, cheap hash of what a reviewer actually reads: the hunk bodies.
 * Index lines and `@@` line numbers are left out, so a shift elsewhere in the
 * file does not reset a mark on content that is unchanged. Two FNV-1a passes
 * with different seeds give 64 bits, as 16 hex characters.
 */
export function patchHash(patch: string): string {
  const input = hashInput(patch);
  const hi = fnv1a(input, 0x811c9dc5);
  const lo = fnv1a(input, 0x050c5d1f);
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

export function viewedState(
  file: Pick<ReviewFile, 'path' | 'hash'>,
  marks: ViewedMarks | undefined
): ViewedState {
  const mark = marks?.[file.path];
  if (mark === undefined) return 'unviewed';
  return mark === file.hash ? 'viewed' : 'changed-since-viewed';
}

export interface ReviewProgress {
  viewed: number;
  /** Marked once, then the file changed. Counted apart from `viewed`, never in it. */
  changed: number;
  total: number;
}

export function reviewProgress(
  files: readonly Pick<ReviewFile, 'path' | 'hash'>[],
  marks: ViewedMarks | undefined
): ReviewProgress {
  let viewed = 0;
  let changed = 0;
  for (const file of files) {
    const state = viewedState(file, marks);
    if (state === 'viewed') viewed++;
    else if (state === 'changed-since-viewed') changed++;
  }
  return { viewed, changed, total: files.length };
}

// ── Order ──────────────────────────────────────────────────────────

function isLowPriority(file: ReviewFile): boolean {
  return (
    isLockfile(file.path) ||
    isGeneratedPath(file.path) ||
    file.flags.some((flag) => flag.kind === 'lockfile' || flag.kind === 'generated')
  );
}

/** Risk first, then lockfiles and generated files last, then by path. Returns a new array. */
export function orderReviewFiles(files: readonly ReviewFile[]): ReviewFile[] {
  return files
    .map((file) => ({ file, low: isLowPriority(file), score: fileRiskScore(file.flags) }))
    .sort((a, b) => {
      if (a.low !== b.low) return a.low ? 1 : -1;
      if (a.score !== b.score) return b.score - a.score;
      return a.file.path.localeCompare(b.file.path);
    })
    .map((entry) => entry.file);
}
