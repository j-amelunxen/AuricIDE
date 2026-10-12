/**
 * How risk flags are shown: which hunk a chip sits on, how repeated flags
 * collapse, which kinds earn the amber tone and the one sentence a chip's
 * tooltip uses to explain its rule. The flags themselves come from
 * `riskFlags.ts`; nothing here decides what is risky.
 */
import { LARGE_DELETION_LINES, type RiskFlag, type RiskFlagKind } from './riskFlags';

export type RiskTone = 'high' | 'neutral';

export const RISK_KIND_INFO: Record<RiskFlagKind, { tone: RiskTone; rule: string }> = {
  'test-removed': {
    tone: 'high',
    rule: 'This change deletes more tests than it adds.',
  },
  'test-skipped': {
    tone: 'high',
    rule: 'An added line skips or focuses a test, so other tests stop running.',
  },
  'secret-like': {
    tone: 'high',
    rule: 'An added line looks like a key, token or password and should not be committed.',
  },
  'type-escape': {
    tone: 'high',
    rule: 'An added line switches the type checker off or falls back to any.',
  },
  'lint-disabled': {
    tone: 'neutral',
    rule: 'An added line turns a linter rule off.',
  },
  unwrap: {
    tone: 'neutral',
    rule: 'Added Rust code calls unwrap(), which panics instead of returning the error.',
  },
  'large-deletion': {
    tone: 'neutral',
    rule: `A hunk removes at least ${LARGE_DELETION_LINES} lines more than it adds.`,
  },
  'ci-config': {
    tone: 'neutral',
    rule: 'CI and git hook files change what runs on every push.',
  },
  lockfile: {
    tone: 'neutral',
    rule: 'The package manager writes lockfiles, so review the manifest change instead.',
  },
  generated: {
    tone: 'neutral',
    rule: 'A tool writes generated files, so review the source that produced them.',
  },
};

/** Flags about the path itself (lockfile, generated, CI): shown once in the file header. */
export function fileLevelFlags(flags: readonly RiskFlag[]): RiskFlag[] {
  return flags.filter((flag) => flag.hunk === undefined);
}

export function flagsForHunk(flags: readonly RiskFlag[], hunk: number): RiskFlag[] {
  return flags.filter((flag) => flag.hunk === hunk);
}

export interface RiskChip {
  kind: RiskFlagKind;
  label: string;
  tone: RiskTone;
  rule: string;
  count: number;
}

/** One chip per kind and label, in the order they were first raised. */
export function chipsFor(flags: readonly RiskFlag[]): RiskChip[] {
  const chips = new Map<string, RiskChip>();
  for (const flag of flags) {
    const key = `${flag.kind}\0${flag.label}`;
    const chip = chips.get(key);
    if (chip) {
      chip.count++;
    } else {
      chips.set(key, {
        kind: flag.kind,
        label: flag.label,
        count: 1,
        ...RISK_KIND_INFO[flag.kind],
      });
    }
  }
  return [...chips.values()];
}
