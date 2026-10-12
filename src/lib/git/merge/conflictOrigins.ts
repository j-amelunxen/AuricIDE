/**
 * Why each side of a conflict looks the way it does: the commits that last
 * changed its lines since the merge base. The backend blames each side's
 * stage text (`git_conflict_origins`); this module finds where every
 * conflict sits in those texts and picks the commits out.
 *
 * Pure. See "Comprehension" in `docs/design-merge-panel.md`.
 */
import type { MergeSegment } from './conflictModel';
import type { GitConflictOrigins, LineOrigin, OriginCommit } from '../../tauri/gitMerge';

/** 1-based start line and line count within one side's stage text. */
export interface LineRange {
  start: number;
  count: number;
}

export interface ConflictSideRanges {
  /** `null` when that stage is absent: the side deleted the file. */
  ours: LineRange | null;
  theirs: LineRange | null;
}

/** The commits behind one conflict, per side, newest first. Empty = unchanged since the base. */
export interface ConflictOrigin {
  ours: OriginCommit[];
  theirs: OriginCommit[];
}

type Side = 'ours' | 'theirs';
const SIDES: readonly Side[] = ['ours', 'theirs'];

function stageLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function matchesAt(haystack: readonly string[], needle: readonly string[], at: number): boolean {
  return needle.every((line, i) => haystack[at + i] === line);
}

/**
 * Where `needle` starts in `haystack` (0-based), searching outward from the
 * estimate so the nearest copy wins. The estimate when it is nowhere, or
 * when there is nothing to look for.
 */
function anchor(haystack: readonly string[], needle: readonly string[], estimate: number): number {
  if (needle.length === 0) return estimate;
  const last = haystack.length - needle.length;
  for (let d = 0; d <= Math.max(estimate, last - estimate); d += 1) {
    if (estimate - d >= 0 && estimate - d <= last && matchesAt(haystack, needle, estimate - d)) {
      return estimate - d;
    }
    if (d > 0 && estimate + d <= last && matchesAt(haystack, needle, estimate + d)) {
      return estimate + d;
    }
  }
  return estimate;
}

/**
 * Each conflict's line range within the ours and theirs stage texts, keyed by
 * `ConflictSegment.index`. git's diff3 text is not either stage: a change
 * only one side made is merged into a clean run, so the line count of clean
 * runs can differ per side. Walking gives the estimate (clean lines count on
 * both sides, a conflict's lines on its own side); the conflict's lines are
 * then looked up in the stage text near it, and the walk continues from
 * where they were found.
 */
export function conflictSideRanges(
  segments: readonly MergeSegment[],
  sides: { ours: string | null; theirs: string | null }
): Record<number, ConflictSideRanges> {
  const texts: Record<Side, string[] | null> = {
    ours: sides.ours === null ? null : stageLines(sides.ours),
    theirs: sides.theirs === null ? null : stageLines(sides.theirs),
  };
  const next = { ours: 0, theirs: 0 };
  const ranges: Record<number, ConflictSideRanges> = {};
  for (const seg of segments) {
    if (seg.kind === 'unparsed') return {};
    if (seg.kind === 'clean') {
      next.ours += seg.lines.length;
      next.theirs += seg.lines.length;
      continue;
    }
    const range: ConflictSideRanges = { ours: null, theirs: null };
    for (const side of SIDES) {
      const text = texts[side];
      const lines = seg[side];
      const start = text === null ? next[side] : anchor(text, lines, next[side]);
      if (text !== null) range[side] = { start: start + 1, count: lines.length };
      next[side] = start + lines.length;
    }
    ranges[seg.index] = range;
  }
  return ranges;
}

function commitsIn(
  origins: readonly LineOrigin[],
  range: LineRange | null,
  byOid: ReadonlyMap<string, OriginCommit>
): OriginCommit[] {
  if (range === null) return [];
  const end = range.start + range.count;
  const found = new Map<string, OriginCommit>();
  for (const origin of origins) {
    if (origin.line < range.start || origin.line >= end) continue;
    const commit = byOid.get(origin.oid);
    if (commit) found.set(commit.oid, commit);
  }
  return [...found.values()].sort((a, b) => b.time - a.time);
}

/** Per conflict, the commits that changed each side's lines since the merge base. */
export function conflictOrigins(
  segments: readonly MergeSegment[],
  sides: { ours: string | null; theirs: string | null },
  origins: GitConflictOrigins
): Record<number, ConflictOrigin> {
  const byOid = new Map(origins.commits.map((c) => [c.oid, c]));
  const result: Record<number, ConflictOrigin> = {};
  for (const [index, range] of Object.entries(conflictSideRanges(segments, sides))) {
    result[Number(index)] = {
      ours: commitsIn(origins.ours, range.ours, byOid),
      theirs: commitsIn(origins.theirs, range.theirs, byOid),
    };
  }
  return result;
}

/** Commit subjects per side for the proposal prompt; undefined when neither side has one. */
export function intentFor(
  origin: ConflictOrigin | undefined
): { ours: string[]; theirs: string[] } | undefined {
  if (!origin || (origin.ours.length === 0 && origin.theirs.length === 0)) return undefined;
  return { ours: origin.ours.map((c) => c.summary), theirs: origin.theirs.map((c) => c.summary) };
}

const UNITS: readonly [string, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['week', 7 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 days ago" for a commit time in unix seconds. A time in the future reads as "just now". */
export function commitAge(timeSeconds: number, nowMs: number): string {
  const seconds = Math.floor(nowMs / 1000 - timeSeconds);
  for (const [unit, size] of UNITS) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}
