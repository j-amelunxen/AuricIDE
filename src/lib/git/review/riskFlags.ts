/**
 * Deterministic risk flags for a review session (`docs/design-merge-panel.md`,
 * "The diff viewer is a review panel now"). A flag is a chip on a hunk and
 * raises its file in the review order, so the reviewer sees deleted tests,
 * skipped tests, lint and type escapes and credential-shaped strings first.
 *
 * Conservative on purpose: a chip that cries wolf teaches the reviewer to stop
 * reading chips. Every rule is gated by language, looks only at the side of
 * the diff that matters (added lines for escapes, removed lines for deleted
 * tests), and code rules ignore string literals and comments.
 */
import { parseDiff, type DiffLine } from '../parseDiff';

export type RiskFlagKind =
  | 'test-removed'
  | 'test-skipped'
  | 'lint-disabled'
  | 'type-escape'
  | 'unwrap'
  | 'secret-like'
  | 'large-deletion'
  | 'ci-config'
  | 'lockfile'
  | 'generated';

export interface RiskFlag {
  kind: RiskFlagKind;
  /** Short, user-facing. Never repeats a credential. */
  label: string;
  /** Line in the file version the flag is about, see `side`. */
  line?: number;
  /** `new` for flags on added lines, `old` for flags on removed lines. */
  side?: 'old' | 'new';
  /** Index of the hunk within the file's patch. Set by `riskFlagsForPatch` only. */
  hunk?: number;
}

// ── Path classification ────────────────────────────────────────────

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

const TEST_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)(__tests__|tests?|spec|e2e)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /_tests?\.(rs|go|py)$/,
  /(^|\/)tests\.rs$/,
  /(^|\/)test_[^/]*\.py$/,
  /(^|\/)conftest\.py$/,
];

export function isTestPath(path: string): boolean {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'Gemfile.lock',
  'composer.lock',
  'go.sum',
  'flake.lock',
]);

export function isLockfile(path: string): boolean {
  return LOCKFILES.has(basename(path));
}

const GENERATED_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)(dist|build|out|target|coverage|node_modules|\.next|__generated__|generated)\//,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.generated\.[^/]+$/,
  /_pb2(_grpc)?\.py$/,
  /\.pb\.go$/,
];

export function isGeneratedPath(path: string): boolean {
  return GENERATED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

const CI_PATH_PATTERNS: readonly RegExp[] = [
  /^\.github\/(workflows|actions)\//,
  /^\.gitlab-ci\.ya?ml$/,
  /^\.circleci\//,
  /^\.buildkite\//,
  /^azure-pipelines\.ya?ml$/,
  /^bitbucket-pipelines\.ya?ml$/,
  /^\.travis\.ya?ml$/,
  /(^|\/)Jenkinsfile$/,
  /^\.husky\//,
  /^lefthook\.ya?ml$/,
];

export function isCiConfig(path: string): boolean {
  return CI_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/** File-level flags: they describe the path, so they belong once per file, not per hunk. */
export function riskFlagsForPath(filePath: string): RiskFlag[] {
  if (isLockfile(filePath)) return [{ kind: 'lockfile', label: 'Lockfile' }];
  if (isGeneratedPath(filePath)) return [{ kind: 'generated', label: 'Generated file' }];
  if (isCiConfig(filePath)) return [{ kind: 'ci-config', label: 'CI or hook config' }];
  return [];
}

// ── Languages and line splitting ───────────────────────────────────

type Language = 'js' | 'rust' | 'python' | 'other';

function languageOf(path: string): Language {
  if (/\.[cm]?[jt]sx?$/.test(path)) return 'js';
  if (path.endsWith('.rs')) return 'rust';
  if (/\.pyi?$/.test(path)) return 'python';
  return 'other';
}

/** Rust uses `'` for lifetimes, so only double quotes delimit strings there. */
const STRING_LITERAL: Record<Language, RegExp> = {
  js: /(["'`])(?:\\.|(?!\1).)*\1/g,
  rust: /"(?:\\.|[^"\\])*"/g,
  python: /(["'])(?:\\.|(?!\1).)*\1/g,
  other: /(["'`])(?:\\.|(?!\1).)*\1/g,
};

const COMMENT_START: Record<Language, RegExp> = {
  js: /\/\/|\/\*/,
  rust: /\/\/|\/\*/,
  python: /#/,
  other: /\/\/|#/,
};

/** Code with string contents blanked, and the comment part, so rules can pick their half. */
function splitLine(content: string, language: Language): { code: string; comment: string } {
  const blanked = content.replace(STRING_LITERAL[language], '""');
  const match = COMMENT_START[language].exec(blanked);
  if (!match) return { code: blanked, comment: '' };
  return { code: blanked.slice(0, match.index), comment: blanked.slice(match.index) };
}

// ── Line rules ─────────────────────────────────────────────────────

interface LineRule {
  kind: RiskFlagKind;
  languages: readonly Language[];
  /** Which half of the line the pattern reads. */
  part: 'code' | 'comment';
  pattern: RegExp;
  label: (match: RegExpExecArray) => string;
  /** Extra path gate on top of the language. */
  appliesTo?: (path: string) => boolean;
}

const notTest = (path: string) => !isTestPath(path);

/** Rules for added lines. Removing any of these is good news and never flagged. */
const ADDED_LINE_RULES: readonly LineRule[] = [
  // JS / TS
  {
    kind: 'test-skipped',
    languages: ['js'],
    part: 'code',
    pattern: /\b(?:it|describe|test|context|suite)\.(skip|only|todo)\s*\(/,
    label: (m) => (m[1] === 'only' ? 'Focused test skips the rest' : `Test skipped (.${m[1]})`),
  },
  {
    kind: 'test-skipped',
    languages: ['js'],
    part: 'code',
    pattern: /(?:^|[^.\w])(xit|xdescribe|xtest|fit|fdescribe)\s*\(/,
    label: (m) => (m[1].startsWith('f') ? 'Focused test skips the rest' : `Test skipped (${m[1]})`),
    appliesTo: isTestPath,
  },
  {
    kind: 'lint-disabled',
    languages: ['js'],
    part: 'comment',
    pattern: /eslint-disable/,
    label: () => 'ESLint disabled',
  },
  {
    kind: 'type-escape',
    languages: ['js'],
    part: 'comment',
    pattern: /@ts-(ignore|expect-error|nocheck)\b/,
    label: (m) => `Type check suppressed (@ts-${m[1]})`,
  },
  {
    kind: 'type-escape',
    languages: ['js'],
    part: 'code',
    pattern: /(?::|\bas|[<,])\s*any\b(?!\s*[(.])/,
    label: () => 'Type escape (any)',
  },
  // Rust
  {
    kind: 'test-skipped',
    languages: ['rust'],
    part: 'code',
    pattern: /#\[ignore\b/,
    label: () => 'Test ignored (#[ignore])',
  },
  {
    kind: 'lint-disabled',
    languages: ['rust'],
    part: 'code',
    pattern: /#!?\[allow\(/,
    label: () => 'Lint allowed (#[allow])',
  },
  {
    kind: 'unwrap',
    languages: ['rust'],
    part: 'code',
    pattern: /\.unwrap\(\)/,
    label: () => '.unwrap() can panic',
    appliesTo: notTest,
  },
  // Python
  {
    kind: 'test-skipped',
    languages: ['python'],
    part: 'code',
    pattern: /@pytest\.mark\.(skip|skipif|xfail)\b|@unittest\.skip\w*|\bpytest\.skip\(/,
    label: () => 'Test skipped',
  },
  {
    kind: 'type-escape',
    languages: ['python'],
    part: 'comment',
    pattern: /#\s*type:\s*ignore\b/,
    label: () => 'Type check suppressed (type: ignore)',
  },
  {
    kind: 'lint-disabled',
    languages: ['python'],
    part: 'comment',
    pattern: /#\s*(noqa\b|pylint:\s*disable)/,
    label: (m) => (m[1].startsWith('noqa') ? 'Lint suppressed (noqa)' : 'Pylint disabled'),
  },
];

/** Test declarations: counted on both sides so a rename is not a removal. */
interface TestDeclRule {
  languages: readonly Language[];
  pattern: RegExp;
  appliesTo?: (path: string) => boolean;
}

const TEST_DECL_RULES: readonly TestDeclRule[] = [
  {
    languages: ['js'],
    pattern: /^\s*(?:it|test|describe)(?:\.\w+)?\s*\(/,
    appliesTo: isTestPath,
  },
  // `#[test]` is unambiguous; Rust tests usually live in the file they test.
  { languages: ['rust'], pattern: /#\[(?:tokio::)?test\b/ },
  { languages: ['python'], pattern: /^\s*(?:async\s+)?def\s+test_\w*\s*\(/ },
];

/** A hunk inside a Rust test module: git names the enclosing item in the `@@` header. */
const RUST_TEST_CONTEXT = /#\[cfg\(test\)\]|\bmod tests\b|#\[(?:tokio::)?test\b/;

// ── Secrets ────────────────────────────────────────────────────────

interface SecretRule {
  label: string;
  pattern: RegExp;
  /** The part that has to look random; absent means the match itself is proof. */
  tokenGroup?: number;
  skipInTests?: boolean;
}

const SECRET_RULES: readonly SecretRule[] = [
  {
    label: 'Looks like a private key',
    pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
  },
  {
    label: 'Looks like an API key (sk-)',
    pattern: /(?:^|[^\w-])(sk-[A-Za-z0-9_-]{20,})/,
    tokenGroup: 1,
  },
  {
    label: 'Looks like a GitHub token',
    pattern: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/,
    tokenGroup: 1,
  },
  {
    label: 'Looks like an AWS access key',
    pattern: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/,
    tokenGroup: 1,
  },
  {
    label: 'Looks like a Slack token',
    pattern: /\b(xox[abprs]-[A-Za-z0-9-]{10,})/,
    tokenGroup: 1,
  },
  {
    label: 'Password written as a literal',
    pattern: /\b\w*(?:password|passwd|secret|api_?key)\w*["']?\s*[:=]\s*(["'])([^"'\s]{6,})\1/i,
    tokenGroup: 2,
    skipInTests: true,
  },
];

const PLACEHOLDER = /example|placeholder|changeme|dummy|your[-_]|xxxx|\*\*\*|<.*>|\$\{|%\(|\{\{/i;

function shannonEntropy(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** A real credential is random; a placeholder or a word is not. */
function looksRandom(token: string): boolean {
  if (PLACEHOLDER.test(token)) return false;
  if (/^[A-Za-z]+$/.test(token)) return false;
  return shannonEntropy(token) >= 3;
}

function secretLabel(content: string, inTestFile: boolean): string | null {
  for (const rule of SECRET_RULES) {
    if (rule.skipInTests && inTestFile) continue;
    const match = rule.pattern.exec(content);
    if (!match) continue;
    if (rule.tokenGroup === undefined || looksRandom(match[rule.tokenGroup])) return rule.label;
  }
  return null;
}

// ── Hunk and patch ─────────────────────────────────────────────────

/** Net removed lines in one hunk above which the hunk is a large deletion. */
export const LARGE_DELETION_LINES = 40;

function countTestDecls(lines: DiffLine[], rules: readonly TestDeclRule[], language: Language) {
  let count = 0;
  for (const line of lines) {
    const { code } = splitLine(line.content, language);
    if (rules.some((rule) => rule.pattern.test(code))) count++;
  }
  return count;
}

function testRemovedFlag(
  filePath: string,
  language: Language,
  removed: DiffLine[],
  added: DiffLine[]
): RiskFlag | null {
  const rules = TEST_DECL_RULES.filter(
    (rule) => rule.languages.includes(language) && (rule.appliesTo?.(filePath) ?? true)
  );
  if (rules.length === 0) return null;
  const net = countTestDecls(removed, rules, language) - countTestDecls(added, rules, language);
  if (net <= 0) return null;
  const first = removed.find((line) =>
    rules.some((rule) => rule.pattern.test(splitLine(line.content, language).code))
  );
  return {
    kind: 'test-removed',
    label: net === 1 ? 'Removes 1 test' : `Removes ${net} tests`,
    line: first?.oldLineNo ?? undefined,
    side: 'old',
  };
}

function addedLineFlags(
  filePath: string,
  language: Language,
  added: DiffLine[],
  inTestHunk: boolean
): RiskFlag[] {
  const rules = ADDED_LINE_RULES.filter(
    (rule) =>
      rule.languages.includes(language) &&
      (rule.appliesTo?.(filePath) ?? true) &&
      !(rule.kind === 'unwrap' && inTestHunk)
  );
  const inTestFile = isTestPath(filePath);
  const flags: RiskFlag[] = [];
  for (const line of added) {
    const at = { line: line.newLineNo ?? undefined, side: 'new' as const };
    const parts = splitLine(line.content, language);
    for (const rule of rules) {
      const match = rule.pattern.exec(parts[rule.part]);
      if (match) flags.push({ kind: rule.kind, label: rule.label(match), ...at });
    }
    const secret = secretLabel(line.content, inTestFile);
    if (secret) flags.push({ kind: 'secret-like', label: secret, ...at });
  }
  return flags;
}

/**
 * Content flags for one hunk. `hunkLines` is parseDiff output for that hunk,
 * its `@@` header included (git names the enclosing item there, which tells a
 * Rust test module apart). Path flags (`ci-config`, `lockfile`, `generated`)
 * are not repeated per hunk; see `riskFlagsForPath`. Lockfiles and generated
 * files get no content flags: what is in them was not written by hand.
 */
export function riskFlagsForHunk(filePath: string, hunkLines: DiffLine[]): RiskFlag[] {
  if (isLockfile(filePath) || isGeneratedPath(filePath)) return [];
  const language = languageOf(filePath);
  const added = hunkLines.filter((line) => line.type === 'added');
  const removed = hunkLines.filter((line) => line.type === 'removed');
  const inTestHunk =
    language === 'rust' && hunkLines.some((line) => RUST_TEST_CONTEXT.test(line.content));

  const flags: RiskFlag[] = [];
  const testRemoved = testRemovedFlag(filePath, language, removed, added);
  if (testRemoved) flags.push(testRemoved);
  flags.push(...addedLineFlags(filePath, language, added, inTestHunk));

  if (removed.length - added.length >= LARGE_DELETION_LINES) {
    flags.push({
      kind: 'large-deletion',
      label: `Removes ${removed.length} lines`,
      line: removed[0].oldLineNo ?? undefined,
      side: 'old',
    });
  }
  return flags;
}

/** parseDiff output cut at each `@@` header; lines before the first hunk are dropped. */
function hunksOf(lines: DiffLine[]): DiffLine[][] {
  const hunks: DiffLine[][] = [];
  for (const line of lines) {
    if (line.type === 'header' && line.content.startsWith('@@')) hunks.push([line]);
    else if (hunks.length > 0) hunks[hunks.length - 1].push(line);
  }
  return hunks;
}

/** Path flags once, then every hunk's flags tagged with the hunk's index. */
export function riskFlagsForPatch(filePath: string, rawPatch: string): RiskFlag[] {
  if (!rawPatch) return [];
  const flags = riskFlagsForPath(filePath);
  hunksOf(parseDiff(rawPatch)).forEach((lines, hunk) => {
    for (const flag of riskFlagsForHunk(filePath, lines)) flags.push({ ...flag, hunk });
  });
  return flags;
}

// ── Ordering ───────────────────────────────────────────────────────

/** Multiples of ten, so the flag count below stays a tiebreak and never changes the rank. */
const KIND_WEIGHT: Record<RiskFlagKind, number> = {
  'secret-like': 100,
  'test-removed': 70,
  'test-skipped': 60,
  'ci-config': 40,
  'type-escape': 30,
  'lint-disabled': 30,
  'large-deletion': 20,
  unwrap: 10,
  lockfile: 0,
  generated: 0,
};

const MAX_COUNT_BONUS = 9;

/**
 * Higher means review earlier. Each kind counts once, so thirty `any`s do not
 * outrank one deleted test; the number of flags only breaks ties.
 */
export function fileRiskScore(flags: readonly RiskFlag[]): number {
  const kinds = new Set(flags.map((flag) => flag.kind));
  let score = 0;
  for (const kind of kinds) score += KIND_WEIGHT[kind];
  if (score === 0) return 0;
  return score + Math.min(flags.length, MAX_COUNT_BONUS);
}
