/**
 * The merge panel's model of one conflicted file: git's diff3 text, parsed
 * into clean runs and conflict regions, plus the human's choice per region.
 *
 * We never merge anything ourselves. The text comes from `git2::merge_file`;
 * this module only reads its markers and splices the chosen lines back in.
 * Anything it cannot read for certain becomes one `unparsed` segment that the
 * human edits by hand. See `docs/design-merge-panel.md`.
 */

export interface CleanSegment {
  kind: 'clean';
  lines: string[];
}

export interface ConflictSegment {
  kind: 'conflict';
  /** 0-based, in file order. The key for resolutions and proposals. */
  index: number;
  ours: string[];
  /** `null` when git wrote no base section (both added, or not diff3). */
  base: string[] | null;
  theirs: string[];
}

export interface UnparsedSegment {
  kind: 'unparsed';
  /** The whole file, untouched. */
  text: string;
}

export type MergeSegment = CleanSegment | ConflictSegment | UnparsedSegment;

export interface MergeDoc {
  segments: MergeSegment[];
  /** `\r\n` only when every line of the file ends that way. */
  eol: '\n' | '\r\n';
  endsWithNewline: boolean;
  conflictCount: number;
  /**
   * Whether each stage's own text ends with a newline, where known. git's
   * diff3 text always closes a marker block with one, so for a file that ends
   * in a conflict only the chosen stage can say how the file really ends.
   */
  sideEndsWithNewline: Partial<Record<StageSide, boolean>>;
}

export type StageSide = 'ours' | 'theirs' | 'base';

/** The ancestor label the backend passes to `git2::merge_file` (`BASE_LABEL` in merge.rs). */
export const MERGE_BASE_LABEL = 'base';

/** The labels git wrote after the markers. When known, only those lines are markers. */
export interface MergeLabels {
  ours: string;
  theirs: string;
  base: string;
}

export interface ParseOptions {
  labels?: MergeLabels;
  /** The stage texts as git stores them; `null` when the stage is absent or binary. */
  sides?: Partial<Record<StageSide, string | null>>;
}

export type Resolution =
  | { kind: 'ours' }
  | { kind: 'theirs' }
  | { kind: 'base' }
  | { kind: 'both'; first: 'ours' | 'theirs' }
  | { kind: 'custom'; lines: string[]; source: 'manual' | 'agent' | 'auto' };

type Marker = 'open' | 'base' | 'sep' | 'close';

function markerOf(raw: string, labels?: MergeLabels): Marker | null {
  const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  if (line === '=======') return 'sep';
  if (labels) {
    if (line === `<<<<<<< ${labels.ours}`) return 'open';
    if (line === `||||||| ${labels.base}`) return 'base';
    if (line === `>>>>>>> ${labels.theirs}`) return 'close';
    return null;
  }
  const head = line.slice(0, 7);
  if (line.length > 7 && line[7] !== ' ') return null;
  if (head === '<<<<<<<') return 'open';
  if (head === '|||||||') return 'base';
  if (head === '>>>>>>>') return 'close';
  return null;
}

/** Whether one line, on its own, has the shape of a conflict marker (any label). */
export function isMarkerLine(line: string): boolean {
  return markerOf(line) !== null;
}

/**
 * True when the text holds a conflict git would write. `<<<<<<<` and
 * `>>>>>>>` always count; `=======` and `|||||||` only next to one of them,
 * since alone they are a Markdown setext heading or ASCII art. With
 * `labels`, only marker lines carrying exactly those labels count, so a test
 * fixture that spells out a conflict is left alone.
 */
export function hasConflictMarkers(text: string, labels?: MergeLabels): boolean {
  return text.split('\n').some((line) => {
    const marker = markerOf(line, labels);
    return marker === 'open' || marker === 'close';
  });
}

function splitLines(text: string): {
  lines: string[];
  eol: MergeDoc['eol'];
  endsWithNewline: boolean;
} {
  if (text === '') return { lines: [], eol: '\n', endsWithNewline: false };
  const endsWithNewline = text.endsWith('\n');
  const raw = text.split('\n');
  if (endsWithNewline) raw.pop();
  const terminated = endsWithNewline ? raw : raw.slice(0, -1);
  const crlf = terminated.length > 0 && terminated.every((l) => l.endsWith('\r'));
  if (!crlf) return { lines: raw, eol: '\n', endsWithNewline };
  const lines = raw.map((l, i) => (i < terminated.length ? l.slice(0, -1) : l));
  return { lines, eol: '\r\n', endsWithNewline };
}

type Phase = 'clean' | 'ours' | 'base' | 'theirs';

/** Advances the marker state machine; `null` means the markers do not nest the way git writes them. */
function nextPhase(phase: Phase, marker: Marker): Phase | null {
  if (marker === 'open') return phase === 'clean' ? 'ours' : null;
  if (marker === 'base') return phase === 'ours' ? 'base' : null;
  if (marker === 'sep') return phase === 'ours' || phase === 'base' ? 'theirs' : null;
  return phase === 'theirs' ? 'clean' : null;
}

/**
 * Parses git's diff3 output. Unbalanced or nested markers inside a conflict
 * region, or a stray `>>>>>>>`, give one `unparsed` segment.
 */
export function parseMergedText(text: string, options: ParseOptions = {}): MergeDoc {
  const { lines, eol, endsWithNewline } = splitLines(text);
  const sideEndsWithNewline: MergeDoc['sideEndsWithNewline'] = {};
  for (const side of ['ours', 'theirs', 'base'] as const) {
    const stage = options.sides?.[side];
    if (typeof stage === 'string') sideEndsWithNewline[side] = stage.endsWith('\n');
  }
  const segments: MergeSegment[] = [];
  const unparsed = (): MergeDoc => ({
    segments: [{ kind: 'unparsed', text }],
    eol,
    endsWithNewline,
    conflictCount: 0,
    sideEndsWithNewline,
  });

  let phase: Phase = 'clean';
  let clean: string[] = [];
  let current: ConflictSegment | null = null;
  let count = 0;

  for (const line of lines) {
    const marker = markerOf(line, options.labels);
    // Outside a conflict a separator or base line is text: a setext heading, ASCII art.
    const isText = !marker || (phase === 'clean' && (marker === 'sep' || marker === 'base'));
    if (isText) {
      if (phase === 'clean') clean.push(line);
      else if (phase === 'ours') current!.ours.push(line);
      else if (phase === 'base') current!.base!.push(line);
      else current!.theirs.push(line);
      continue;
    }
    const next = nextPhase(phase, marker);
    if (!next) return unparsed();
    if (marker === 'open') {
      if (clean.length > 0) segments.push({ kind: 'clean', lines: clean });
      clean = [];
      current = { kind: 'conflict', index: count++, ours: [], base: null, theirs: [] };
    } else if (marker === 'base') {
      current!.base = [];
    } else if (marker === 'close') {
      segments.push(current!);
      current = null;
    }
    phase = next;
  }
  if (phase !== 'clean') return unparsed();
  if (clean.length > 0) segments.push({ kind: 'clean', lines: clean });
  return { segments, eol, endsWithNewline, conflictCount: count, sideEndsWithNewline };
}

/** The lines a resolution puts where the conflict was. */
export function resolutionLines(conflict: ConflictSegment, resolution: Resolution): string[] {
  switch (resolution.kind) {
    case 'ours':
      return conflict.ours;
    case 'theirs':
      return conflict.theirs;
    case 'base':
      return conflict.base ?? [];
    case 'both':
      return resolution.first === 'ours'
        ? [...conflict.ours, ...conflict.theirs]
        : [...conflict.theirs, ...conflict.ours];
    case 'custom':
      return resolution.lines;
  }
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

function squash(lines: readonly string[]): string {
  return lines.join('\n').replace(/\s+/g, ' ').trim();
}

/**
 * The safe cases only, each with the sentence that says why it was safe:
 * one side unchanged from the base, both sides identical, or the sides
 * differing in whitespace alone. Without a base only the identical case
 * holds, since "unchanged" cannot be judged.
 */
export function autoResolution(
  conflict: ConflictSegment
): { resolution: Resolution; reason: string } | null {
  const { ours, base, theirs } = conflict;
  if (same(ours, theirs)) {
    return { resolution: { kind: 'ours' }, reason: 'Both sides made the same change.' };
  }
  if (base === null) return null;
  if (same(ours, base)) {
    return {
      resolution: { kind: 'theirs' },
      reason: 'Only the incoming side changed this region.',
    };
  }
  if (same(theirs, base)) {
    return { resolution: { kind: 'ours' }, reason: 'Only your side changed this region.' };
  }
  if (squash(ours) === squash(theirs)) {
    return {
      resolution: { kind: 'ours' },
      reason: 'The sides differ only in whitespace. Your side was kept.',
    };
  }
  return null;
}

/** The final file text, or `null` while any conflict is unresolved or the file was not parsed. */
export function composeResult(
  doc: MergeDoc,
  resolutions: Readonly<Record<number, Resolution>>
): string | null {
  const out: string[] = [];
  for (const segment of doc.segments) {
    if (segment.kind === 'unparsed') return null;
    if (segment.kind === 'clean') {
      out.push(...segment.lines);
      continue;
    }
    const resolution = resolutions[segment.index];
    if (!resolution) return null;
    out.push(...resolutionLines(segment, resolution));
  }
  if (out.length === 0) return '';
  return out.join(doc.eol) + (endsWithNewline(doc, resolutions) ? doc.eol : '');
}

/** The stage whose text supplies the file's last line, for a file ending in a conflict. */
function lastStage(conflict: ConflictSegment, resolution: Resolution): StageSide | null {
  if (resolution.kind === 'custom') return null;
  if (resolution.kind !== 'both') return resolution.kind;
  const second = resolution.first === 'ours' ? 'theirs' : 'ours';
  return conflict[second].length > 0 ? second : resolution.first;
}

function endsWithNewline(
  doc: MergeDoc,
  resolutions: Readonly<Record<number, Resolution>>
): boolean {
  const last = doc.segments[doc.segments.length - 1];
  if (last?.kind !== 'conflict') return doc.endsWithNewline;
  const stage = lastStage(last, resolutions[last.index]);
  return (stage && doc.sideEndsWithNewline[stage]) ?? doc.endsWithNewline;
}
