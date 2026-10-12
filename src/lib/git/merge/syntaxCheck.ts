/**
 * "Does this still parse?" for a merge result, before a person signs it.
 *
 * Not a compiler. Structured formats are run through a real parser (JSON,
 * YAML, XML where the platform has one); code is run through a tokenizer that
 * knows each language family's strings, comments and literals well enough to
 * say whether brackets and strings still balance. It never checks types,
 * names or meaning, and the UI says so.
 *
 * The rule that shapes everything here: a false "would break" on valid code is
 * worse than no answer, because it teaches people to press through the
 * warning. Whenever the tokenizer meets something it cannot read for certain
 * (a slash that could be a division or a pattern, JSX it cannot follow), the
 * answer is `unchecked`, not `problem`.
 */
import * as yaml from 'js-yaml';
import { composeResult, type MergeDoc, type Resolution } from './conflictModel';

export type SyntaxChecker = 'json' | 'jsonc' | 'yaml' | 'xml' | 'brackets' | 'none';

export interface SyntaxCheck {
  kind: 'ok' | 'problem' | 'unchecked';
  checker: SyntaxChecker;
  /** Plain words for a problem, or why nothing could be said. */
  message?: string;
  /** 1-based line of a problem, where known. */
  line?: number;
}

// ---------------------------------------------------------------- dispatch

function extensionOf(filePath: string): string {
  const name = filePath.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function baseName(filePath: string): string {
  return (filePath.split('/').pop() ?? '').toLowerCase();
}

/** Files whose tools read JSON with comments and trailing commas. */
function isJsoncName(filePath: string): boolean {
  const name = baseName(filePath);
  return (
    extensionOf(filePath) === 'jsonc' ||
    /^[tj]sconfig(\..*)?\.json$/.test(name) ||
    filePath.includes('.vscode/')
  );
}

export function checkSyntax(filePath: string, text: string): SyntaxCheck {
  const ext = extensionOf(filePath);
  if (ext === 'json' || ext === 'jsonc') return checkJson(filePath, text);
  if (ext === 'yml' || ext === 'yaml') return checkYaml(text);
  if (XML_EXTENSIONS.has(ext)) return checkXml(text);
  const family = FAMILY_BY_EXT[ext];
  if (!family) return { kind: 'unchecked', checker: 'none' };
  return checkBrackets(text, family);
}

/** One line for the UI, or null when nothing was said. */
export function describeSyntaxCheck(result: SyntaxCheck): string | null {
  if (result.kind === 'problem') return `Would break: ${result.message ?? 'does not parse'}`;
  if (result.kind !== 'ok') return null;
  return OK_TEXT[result.checker];
}

/** What the check covered, so a green line is not read as more than it is. */
export function syntaxCheckScope(result: SyntaxCheck): string | null {
  if (result.kind === 'unchecked') return null;
  return result.checker === 'brackets'
    ? 'This checks brackets and strings, not types.'
    : 'This checks that the file parses, not what it means.';
}

const OK_TEXT: Record<SyntaxChecker, string> = {
  json: 'Parses as JSON',
  jsonc: 'Parses as JSON with comments',
  yaml: 'Parses as YAML',
  xml: 'Parses as XML',
  brackets: 'Brackets and strings balance',
  none: 'Not checked',
};

// ---------------------------------------------------------------- merge glue

/** Every open conflict but `index` filled with "yours", so the file composes. */
function composeWith(
  doc: MergeDoc,
  resolutions: Readonly<Record<number, Resolution>>,
  index: number,
  resolution: Resolution
): string | null {
  const filled: Record<number, Resolution> = {};
  for (const segment of doc.segments) {
    if (segment.kind === 'conflict') filled[segment.index] = { kind: 'ours' };
  }
  return composeResult(doc, { ...filled, ...resolutions, [index]: resolution });
}

/**
 * The file as it would be with this proposal used. A problem is only the
 * proposal's when taking either side there would have passed: a file that
 * fails either way is broken elsewhere, and the proposal is not judged.
 */
export function checkProposalSyntax(
  filePath: string,
  doc: MergeDoc,
  resolutions: Readonly<Record<number, Resolution>>,
  index: number,
  lines: string[]
): SyntaxCheck {
  const text = composeWith(doc, resolutions, index, { kind: 'custom', lines, source: 'agent' });
  if (text === null) return { kind: 'unchecked', checker: 'none' };
  const result = checkSyntax(filePath, text);
  if (result.kind !== 'problem') return result;
  const sideFails = (resolution: Resolution) => {
    const sideText = composeWith(doc, resolutions, index, resolution);
    return sideText === null || checkSyntax(filePath, sideText).kind === 'problem';
  };
  if (sideFails({ kind: 'ours' }) && sideFails({ kind: 'theirs' })) {
    return {
      kind: 'unchecked',
      checker: result.checker,
      message:
        'The rest of the file does not pass this check either, so the proposal was not judged.',
    };
  }
  return result;
}

/**
 * The final file. When the check rejects one of the file's own versions as
 * git stored them, it cannot read this file reliably, and says nothing.
 */
export function checkResolvedFile(
  filePath: string,
  text: string,
  sides: readonly (string | null | undefined)[]
): SyntaxCheck {
  const result = checkSyntax(filePath, text);
  if (result.kind !== 'problem') return result;
  const sideFails = sides.some(
    (side) => typeof side === 'string' && checkSyntax(filePath, side).kind === 'problem'
  );
  return sideFails
    ? {
        kind: 'unchecked',
        checker: result.checker,
        message: 'One of the versions being merged does not pass this check either.',
      }
    : result;
}

// ---------------------------------------------------------------- shared

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineOf(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// ---------------------------------------------------------------- JSON

/**
 * Comments become spaces (newlines kept, so lines still count right) and,
 * when asked, trailing commas go. Strings are copied untouched.
 */
function stripJsonc(text: string): { text: string; hadComments: boolean } {
  let out = '';
  let hadComments = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const end = jsonStringEnd(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      hadComments = true;
      const block = text[i + 1] === '*';
      const close = block ? text.indexOf('*/', i + 2) : text.indexOf('\n', i);
      const end = close === -1 ? text.length : block ? close + 2 : close;
      out += text.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return { text: out, hadComments };
}

function jsonStringEnd(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && text[i] !== '"' && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
  return Math.min(i + 1, text.length);
}

function dropTrailingCommas(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      const end = jsonStringEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (text[i] === ',' && /^\s*[}\]]/.test(text.slice(i + 1, i + 200))) {
      out += ' ';
      i++;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function checkJson(filePath: string, text: string): SyntaxCheck {
  if (parses(text)) return { kind: 'ok', checker: 'json' };
  const stripped = stripJsonc(text);
  const jsonc = stripped.hadComments || isJsoncName(filePath);
  if (!jsonc) return jsonProblem('json', text);
  const relaxed = dropTrailingCommas(stripped.text);
  if (parses(relaxed)) return { kind: 'ok', checker: 'jsonc' };
  return jsonProblem('jsonc', relaxed);
}

function jsonProblem(checker: 'json' | 'jsonc', text: string): SyntaxCheck {
  const found = locateJsonError(text);
  if (!found) return { kind: 'problem', checker, message: 'not valid JSON' };
  const line = lineOf(lineStarts(text), found.offset);
  return {
    kind: 'problem',
    checker,
    line,
    message: `not valid JSON at line ${line} (${found.reason})`,
  };
}

/**
 * Where JSON.parse gave up. Its own message carries no position in WebKit,
 * which is what the app runs in, so the spot is found by reading the text
 * again. Validity is still JSON.parse's verdict; this only locates.
 */
function locateJsonError(text: string): { offset: number; reason: string } | null {
  const reader = new JsonReader(text);
  try {
    reader.value();
    reader.ws();
    if (reader.pos < text.length) reader.fail('unexpected text after the end');
    return null;
  } catch (err) {
    return err instanceof JsonError ? { offset: err.offset, reason: err.reason } : null;
  }
}

class JsonError {
  constructor(
    readonly offset: number,
    readonly reason: string
  ) {}
}

class JsonReader {
  pos = 0;
  constructor(private readonly text: string) {}

  fail(reason: string): never {
    throw new JsonError(this.pos, reason);
  }

  ws() {
    while (/[ \t\r\n]/.test(this.text[this.pos] ?? '')) this.pos++;
  }

  value(): void {
    this.ws();
    const c = this.text[this.pos];
    if (c === '{') return this.container('}', true);
    if (c === '[') return this.container(']', false);
    if (c === '"') return this.string();
    const literal = /^(true|false|null|-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?)/.exec(
      this.text.slice(this.pos, this.pos + 400)
    );
    if (!literal) this.fail(c === undefined ? 'the file ends too early' : `unexpected \`${c}\``);
    this.pos += literal[0].length;
  }

  private container(close: '}' | ']', keyed: boolean) {
    this.pos++;
    this.ws();
    if (this.text[this.pos] === close) {
      this.pos++;
      return;
    }
    for (;;) {
      if (keyed) {
        this.ws();
        if (this.text[this.pos] !== '"') this.fail('expected a quoted key');
        this.string();
        this.ws();
        if (this.text[this.pos] !== ':') this.fail('expected `:` after a key');
        this.pos++;
      }
      this.value();
      this.ws();
      const c = this.text[this.pos];
      if (c === close) {
        this.pos++;
        return;
      }
      if (c !== ',') this.fail(`expected \`,\` or \`${close}\``);
      this.pos++;
    }
  }

  private string() {
    this.pos++;
    for (;;) {
      const c = this.text[this.pos];
      if (c === undefined || c === '\n') this.fail('a string is not closed');
      if (c === '"') {
        this.pos++;
        return;
      }
      this.pos += c === '\\' ? 2 : 1;
    }
  }
}

// ---------------------------------------------------------------- YAML, XML

function checkYaml(text: string): SyntaxCheck {
  try {
    yaml.loadAll(text, () => undefined);
    return { kind: 'ok', checker: 'yaml' };
  } catch (err) {
    if (!(err instanceof yaml.YAMLException)) return { kind: 'unchecked', checker: 'yaml' };
    const reason = err.reason ?? err.message;
    // Custom tags (`!Ref`, `!include`) are valid for the tool that reads them.
    if (/unknown tag/i.test(reason)) return { kind: 'unchecked', checker: 'yaml' };
    const line = (err.mark?.line ?? 0) + 1;
    return {
      kind: 'problem',
      checker: 'yaml',
      line,
      message: `not valid YAML at line ${line} (${reason})`,
    };
  }
}

const XML_EXTENSIONS = new Set(['xml', 'svg', 'plist', 'xsd', 'xsl', 'xslt']);

function checkXml(text: string): SyntaxCheck {
  if (typeof DOMParser === 'undefined') return { kind: 'unchecked', checker: 'xml' };
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const error = doc.querySelector('parsererror');
  if (!error) return { kind: 'ok', checker: 'xml' };
  const match = /line\s+(\d+)/i.exec(error.textContent ?? '');
  const line = match ? Number(match[1]) : undefined;
  return {
    kind: 'problem',
    checker: 'xml',
    line,
    message: line ? `not valid XML at line ${line}` : 'not valid XML',
  };
}

// ---------------------------------------------------------------- code

type Family =
  | 'ts'
  | 'js'
  | 'jsx'
  | 'cpp'
  | 'java'
  | 'go'
  | 'rust'
  | 'python'
  | 'kotlin'
  | 'swift'
  | 'css'
  | 'scss';

const FAMILY_BY_EXT: Record<string, Family> = {
  ts: 'ts',
  mts: 'ts',
  cts: 'ts',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  tsx: 'jsx',
  jsx: 'jsx',
  rs: 'rust',
  py: 'python',
  pyi: 'python',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'cpp',
  h: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  css: 'css',
  scss: 'scss',
};

interface ReadOptions {
  /** Whether `/` may open a pattern literal at all. */
  regex: boolean;
  /** `x) / y`: division by default, a pattern in the other reading. */
  slashAfterParen: 'division' | 'regex';
  /** `} /x/`: a pattern by default (a block ended), division in the other reading. */
  slashAfterBrace: 'regex' | 'division';
  jsx: boolean;
}

/** A reading the tokenizer cannot vouch for; never reported as a problem. */
class Unsure {}

class Problem {
  constructor(
    readonly message: string,
    readonly line: number
  ) {}
}

/**
 * The usual reading decides, unless another reading passes: then the text is
 * ambiguous to this tokenizer and nothing is claimed either way. An
 * alternative that cannot be read at all does not excuse the usual reading.
 */
function checkBrackets(text: string, family: Family): SyntaxCheck {
  const [usual, ...others] = readingsFor(family);
  const outcome = scan(text, family, usual);
  if (outcome === null) return { kind: 'ok', checker: 'brackets' };
  // `#if` / `#else` branches may each open a brace the other closes.
  if (family === 'cpp' && PREPROCESSOR_BRANCH.test(text)) {
    return { kind: 'unchecked', checker: 'brackets', message: AMBIGUOUS };
  }
  if (outcome instanceof Problem && !others.some((o) => scan(text, family, o) === null)) {
    return { kind: 'problem', checker: 'brackets', message: outcome.message, line: outcome.line };
  }
  return { kind: 'unchecked', checker: 'brackets', message: AMBIGUOUS };
}

const PREPROCESSOR_BRANCH = /^[ \t]*#[ \t]*(?:if|ifdef|ifndef|elif|else)\b/m;
const AMBIGUOUS = 'Part of this file can be read more than one way, so it was not judged.';

function readingsFor(family: Family): ReadOptions[] {
  const js = JS_FAMILIES.has(family);
  const usual: ReadOptions = {
    regex: js,
    slashAfterParen: 'division',
    slashAfterBrace: 'regex',
    jsx: family === 'jsx',
  };
  // Swift 5.7 has bare `/…/` patterns; rare enough to be the other reading only.
  if (family === 'swift') return [usual, { ...usual, regex: true }];
  if (!js) return [usual];
  const readings: ReadOptions[] = [
    usual,
    { ...usual, slashAfterParen: 'regex' },
    { ...usual, slashAfterBrace: 'division' },
  ];
  // Plain .js files carry JSX often enough that the reading is worth a try.
  if (family === 'js') readings.push({ ...usual, jsx: true });
  return readings;
}

function scan(text: string, family: Family, options: ReadOptions): Problem | Unsure | null {
  try {
    new Tokenizer(text, family, options).run();
    return null;
  } catch (err) {
    if (err instanceof Problem || err instanceof Unsure) return err;
    throw err;
  }
}

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);
const JSX_KEYWORDS = new Set(['return', 'yield', 'await', 'default', 'case']);
const JSX_AFTER_PUNCT = /(?:[([{,;=:?&|!]|=>)$/;

type Prev =
  | { kind: 'start' }
  | { kind: 'punct'; op: string }
  | { kind: 'word'; word: string }
  | { kind: 'value'; closer?: ')' | ']' | '}' };

interface StringRule {
  close: string;
  multiline: boolean;
  escapes: boolean;
  /** `${` (JS templates, Kotlin) or `\(` (Swift) opens code inside the string. */
  interpolation?: '${' | '\\(';
}

function isWordChar(c: string | undefined): boolean {
  if (c === undefined) return false;
  const code = c.charCodeAt(0);
  if (code < 128) return /[A-Za-z0-9_$]/.test(c);
  return /[\p{L}\p{N}]/u.test(c);
}

const CPP_NUMBER =
  /^(?:0[xX][0-9a-fA-F']*(?:\.[0-9a-fA-F']*)?(?:[pP][+-]?[0-9']+)?|[0-9][0-9']*(?:\.[0-9']*)?(?:[eE][+-]?[0-9']+)?)/;
const JS_FAMILIES: ReadonlySet<Family> = new Set(['ts', 'js', 'jsx']);
const NESTED_BLOCK_COMMENTS: ReadonlySet<Family> = new Set(['rust', 'kotlin', 'swift']);

class Tokenizer {
  private pos = 0;
  private prev: Prev = { kind: 'start' };
  private jsxDepth = 0;
  private readonly starts: number[];
  private readonly js: boolean;

  constructor(
    private readonly text: string,
    private readonly family: Family,
    private readonly options: ReadOptions
  ) {
    this.starts = lineStarts(text);
    this.js = JS_FAMILIES.has(family);
  }

  // code-gate: complexity-cyclomatic, complexity-function-length - the gate reads the rest of the Tokenizer class as this method; run itself is three lines and each method below is short
  run() {
    // A shebang, not Rust's `#![attr]`.
    if (/^#!\s*\//.test(this.text)) this.pos = this.lineEnd(0);
    this.code(null, 0);
  }

  private line(offset: number): number {
    return lineOf(this.starts, offset);
  }

  /** Inside JSX every problem is a reading we cannot vouch for. */
  private fail(message: string, offset: number): never {
    if (this.jsxDepth > 0) throw new Unsure();
    throw new Problem(message, this.line(offset));
  }

  private lineEnd(from: number): number {
    const end = this.text.indexOf('\n', from);
    return end === -1 ? this.text.length : end;
  }

  /** Code until `terminator` closes at depth zero (or the end of the text). */
  private code(terminator: ')' | '}' | null, openedAt: number) {
    const stack: { ch: string; at: number }[] = [];
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        this.pos++;
        continue;
      }
      if (this.comment() || this.literal()) continue;
      if (OPENERS[c]) {
        stack.push({ ch: c, at: this.pos });
        this.pos++;
        this.prev = { kind: 'punct', op: c };
        continue;
      }
      if (CLOSERS[c]) {
        if (stack.length === 0 && c === terminator) {
          this.pos++;
          return;
        }
        this.close(stack, c);
        continue;
      }
      this.other(c);
    }
    const open = stack.pop();
    if (open) this.fail(`unbalanced \`${open.ch}\` at line ${this.line(open.at)}`, open.at);
    if (terminator) this.fail(`unclosed string at line ${this.line(openedAt)}`, openedAt);
  }

  private close(stack: { ch: string; at: number }[], c: string) {
    const open = stack.pop();
    if (!open) this.fail(`unbalanced \`${c}\` at line ${this.line(this.pos)}`, this.pos);
    if (open.ch !== CLOSERS[c]) {
      this.fail(
        `\`${c}\` at line ${this.line(this.pos)} does not close \`${open.ch}\` from line ${this.line(open.at)}`,
        this.pos
      );
    }
    this.pos++;
    this.prev = { kind: 'value', closer: c as ')' | ']' | '}' };
  }

  private other(c: string) {
    if (this.options.regex && c === '/') return this.slash();
    if (this.options.jsx && c === '<' && this.jsxAllowed()) return this.jsxOrPunct();
    if (isWordChar(c)) return this.word();
    this.pos++;
    const op = this.prev.kind === 'punct' ? this.prev.op + c : c;
    this.prev = { kind: 'punct', op: op.slice(-3) };
  }

  // ------------------------------------------------------------ comments

  private comment(): boolean {
    const c = this.text[this.pos];
    const next = this.text[this.pos + 1];
    if (this.family === 'python') {
      if (c !== '#') return false;
      this.pos = this.lineEnd(this.pos);
      return true;
    }
    if (this.family === 'cpp' && c === '#' && this.atLineStart()) {
      this.directive();
      return true;
    }
    if (c !== '/') return false;
    if (next === '/' && this.lineCommentsAllowed()) {
      this.pos = this.lineEnd(this.pos);
      return true;
    }
    if (next === '*') {
      this.blockComment();
      return true;
    }
    return false;
  }

  private atLineStart(): boolean {
    const start = this.starts[this.line(this.pos) - 1];
    return /^[ \t]*$/.test(this.text.slice(start, this.pos));
  }

  /**
   * A preprocessor line, continuations included. Its text is not code:
   * `#error don't` holds no char literal, `#define BEGIN {` opens nothing.
   */
  private directive() {
    for (;;) {
      const end = this.lineEnd(this.pos);
      const continued = /\\\r?$/.test(this.text.slice(this.pos, end));
      this.pos = end;
      if (!continued || end >= this.text.length) return;
      this.pos = end + 1;
    }
  }

  private lineCommentsAllowed(): boolean {
    if (this.family === 'css') return false;
    // `url(http://…)` is not a comment in SCSS.
    return this.family !== 'scss' || this.text[this.pos - 1] !== ':';
  }

  private blockComment() {
    const start = this.pos;
    const nests = NESTED_BLOCK_COMMENTS.has(this.family);
    let depth = 0;
    while (this.pos < this.text.length) {
      if (this.text.startsWith('/*', this.pos) && (nests || depth === 0)) {
        depth++;
        this.pos += 2;
      } else if (this.text.startsWith('*/', this.pos)) {
        depth--;
        this.pos += 2;
        if (depth === 0) return;
      } else {
        this.pos++;
      }
    }
    this.fail(`unclosed comment at line ${this.line(start)}`, start);
  }

  // ------------------------------------------------------------ literals

  /** Strings, chars and raw strings that start at the cursor. */
  private literal(): boolean {
    const c = this.text[this.pos];
    if (this.family === 'rust' && c === "'") {
      this.rustQuote();
      return true;
    }
    if (this.family === 'swift' && c === '#') return this.swiftRaw();
    const rule = this.stringRule();
    if (!rule) return false;
    this.string(rule.open, rule.rule);
    return true;
  }

  // code-gate: complexity-cyclomatic - one table of every family's quote forms; a lookup map would hide the order the longer forms must win in
  private stringRule(): { open: string; rule: StringRule } | null {
    const at = (s: string) => this.text.startsWith(s, this.pos);
    const f = this.family;
    const tripleQuoted = f === 'python' || f === 'kotlin' || f === 'swift' || f === 'java';
    if (tripleQuoted && at('"""')) {
      const interpolation = f === 'kotlin' ? '${' : f === 'swift' ? '\\(' : undefined;
      return {
        open: '"""',
        rule: { close: '"""', multiline: true, escapes: f !== 'kotlin', interpolation },
      };
    }
    if (f === 'python' && at("'''")) {
      return { open: "'''", rule: { close: "'''", multiline: true, escapes: true } };
    }
    const c = this.text[this.pos];
    if (c === '"') {
      const multiline = f === 'rust';
      const interpolation = f === 'kotlin' ? '${' : f === 'swift' ? '\\(' : undefined;
      return { open: '"', rule: { close: '"', multiline, escapes: true, interpolation } };
    }
    if (c === "'" && f !== 'swift') {
      return { open: "'", rule: { close: "'", multiline: false, escapes: true } };
    }
    if (c === '`' && this.js) {
      return {
        open: '`',
        rule: { close: '`', multiline: true, escapes: true, interpolation: '${' },
      };
    }
    if (c === '`' && f === 'go') {
      return { open: '`', rule: { close: '`', multiline: true, escapes: false } };
    }
    return null;
  }

  private string(open: string, rule: StringRule) {
    const start = this.pos;
    this.pos += open.length;
    for (;;) {
      if (this.pos >= this.text.length) this.unclosedString(start);
      const c = this.text[this.pos];
      if (rule.escapes && c === '\\') {
        if (rule.interpolation === '\\(' && this.text[this.pos + 1] === '(') {
          this.pos += 2;
          this.interpolate(')');
          continue;
        }
        this.pos += 2;
        continue;
      }
      if (this.text.startsWith(rule.close, this.pos)) {
        this.pos += rule.close.length;
        this.prev = { kind: 'value' };
        return;
      }
      if (rule.interpolation === '${' && this.text.startsWith('${', this.pos)) {
        this.pos += 2;
        this.interpolate('}');
        continue;
      }
      if (c === '\n' && !rule.multiline) this.unclosedString(start);
      this.pos++;
    }
  }

  private unclosedString(start: number): never {
    this.fail(`unclosed string at line ${this.line(start)}`, start);
  }

  private interpolate(terminator: ')' | '}') {
    const openedAt = this.pos;
    this.prev = { kind: 'punct', op: terminator === '}' ? '{' : '(' };
    this.code(terminator, openedAt);
  }

  /** A string whose only way out is `close`; nothing inside is special. */
  private rawString(openLength: number, close: string) {
    const start = this.pos;
    const end = this.text.indexOf(close, this.pos + openLength);
    if (end === -1) this.unclosedString(start);
    this.pos = end + close.length;
    this.prev = { kind: 'value' };
  }

  /** `'a'` and `'\n'` are chars; `'a` and `'outer:` are lifetimes and labels. */
  private rustQuote() {
    const next = this.text[this.pos + 1];
    if (next === '\\') {
      const close = this.text.indexOf("'", this.pos + 3);
      if (close === -1 || close - this.pos > 12) throw new Unsure();
      this.pos = close + 1;
      this.prev = { kind: 'value' };
      return;
    }
    const point = this.text.codePointAt(this.pos + 1);
    const width = point !== undefined && point > 0xffff ? 2 : 1;
    if (next !== undefined && next !== '\n' && this.text[this.pos + 1 + width] === "'") {
      this.pos += 2 + width;
      this.prev = { kind: 'value' };
      return;
    }
    this.pos++;
    this.prev = { kind: 'punct', op: "'" };
  }

  /** `#"…"#`, `##"…"##`, `#"""…"""#`. */
  private swiftRaw(): boolean {
    const hashes = /^#+/.exec(this.text.slice(this.pos, this.pos + 8))?.[0] ?? '';
    const after = this.pos + hashes.length;
    if (this.text[after] !== '"') return false;
    const triple = this.text.startsWith('"""', after);
    const quote = triple ? '"""' : '"';
    this.rawString(hashes.length + quote.length, quote + hashes);
    return true;
  }

  // ------------------------------------------------------------ words

  private word() {
    const start = this.pos;
    const numeric = /[0-9]/.test(this.text[start]);
    // C++14 digit separators sit anywhere in a number: 1'000, 0x1.ffff'fep-1.
    const cppNumber =
      numeric && this.family === 'cpp'
        ? CPP_NUMBER.exec(this.text.slice(start, start + 200))
        : null;
    if (cppNumber) this.pos += cppNumber[0].length;
    while (isWordChar(this.text[this.pos])) this.pos++;
    const word = this.text.slice(start, this.pos);
    if (this.rawPrefix(word)) return;
    this.prev = numeric ? { kind: 'value' } : { kind: 'word', word };
  }

  /** Rust `r#"…"#` / `br"…"` and C++ `R"delim(…)delim"`, read whole. */
  private rawPrefix(word: string): boolean {
    const next = this.text[this.pos];
    if (this.family === 'rust' && /^(r|br|cr)$/.test(word) && (next === '"' || next === '#')) {
      const hashes = /^#*/.exec(this.text.slice(this.pos, this.pos + 64))?.[0] ?? '';
      if (this.text[this.pos + hashes.length] !== '"') return false;
      this.rawString(hashes.length + 1, '"' + hashes);
      return true;
    }
    if (this.family === 'cpp' && /^(u8|u|U|L)?R$/.test(word) && next === '"') {
      const paren = this.text.indexOf('(', this.pos);
      const delimiter = paren === -1 ? null : this.text.slice(this.pos + 1, paren);
      if (delimiter === null || delimiter.length > 16 || /[\s\\)]/.test(delimiter)) {
        throw new Unsure();
      }
      this.rawString(delimiter.length + 2, `)${delimiter}"`);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ JS: slash

  private regexAllowed(): boolean {
    const prev = this.prev;
    if (prev.kind === 'start' || prev.kind === 'punct') return true;
    if (prev.kind === 'word') return REGEX_KEYWORDS.has(prev.word);
    if (prev.closer === '}') return this.options.slashAfterBrace === 'regex';
    if (prev.closer === ')') return this.options.slashAfterParen === 'regex';
    return false;
  }

  private slash() {
    if (!this.regexAllowed()) {
      this.pos++;
      this.prev = { kind: 'punct', op: '/' };
      return;
    }
    let inClass = false;
    this.pos++;
    for (;;) {
      const c = this.text[this.pos];
      // A pattern never spans lines; one that seems to was not a pattern.
      if (c === undefined || c === '\n') throw new Unsure();
      if (c === '\\') this.pos += 2;
      else {
        this.pos++;
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
      }
    }
    while (isWordChar(this.text[this.pos])) this.pos++;
    this.prev = { kind: 'value' };
  }

  // ------------------------------------------------------------ JSX

  private jsxAllowed(): boolean {
    const next = this.text[this.pos + 1];
    if (next !== '>' && !/[A-Za-z]/.test(next ?? '')) return false;
    const prev = this.prev;
    if (prev.kind === 'start') return true;
    if (prev.kind === 'word') return JSX_KEYWORDS.has(prev.word);
    if (prev.kind === 'punct') return JSX_AFTER_PUNCT.test(prev.op);
    return false;
  }

  /** An element, or a generic arrow (`<T,>(x) =>`) left to the code reader. */
  private jsxOrPunct() {
    const start = this.pos;
    if (/^<[A-Za-z_$][\w$]*\s*(,|extends\b)/.test(this.text.slice(start, start + 200))) {
      this.pos++;
      this.prev = { kind: 'punct', op: '<' };
      return;
    }
    this.jsxDepth++;
    this.element();
    this.jsxDepth--;
    this.prev = { kind: 'value' };
  }

  private element() {
    this.pos++;
    const name = this.tagName();
    for (;;) {
      this.skipSpace();
      const c = this.text[this.pos];
      if (c === undefined) throw new Unsure();
      if (c === '/' && this.text[this.pos + 1] === '>') {
        this.pos += 2;
        return;
      }
      if (c === '>') {
        this.pos++;
        this.children(name);
        return;
      }
      this.attribute(c);
    }
  }

  private attribute(c: string) {
    // Between attributes, JS comments are allowed.
    if (c === '/' && (this.text[this.pos + 1] === '/' || this.text[this.pos + 1] === '*')) {
      this.comment();
    } else if (c === '{') {
      this.pos++;
      this.expression();
    } else if (c === '"' || c === "'") {
      const end = this.text.indexOf(c, this.pos + 1);
      if (end === -1) throw new Unsure();
      this.pos = end + 1;
    } else if (c === '=') {
      this.pos++;
    } else if (/[\w:.-]/.test(c)) {
      while (/[\w:.-]/.test(this.text[this.pos] ?? '')) this.pos++;
    } else {
      throw new Unsure();
    }
  }

  private tagName(): string {
    const start = this.pos;
    while (/[\w$:.-]/.test(this.text[this.pos] ?? '')) this.pos++;
    return this.text.slice(start, this.pos);
  }

  private skipSpace() {
    while (/\s/.test(this.text[this.pos] ?? '')) this.pos++;
  }

  /** A `{…}` inside JSX: code, which may hold JSX again. */
  private expression() {
    this.prev = { kind: 'punct', op: '{' };
    this.code('}', this.pos);
  }

  private children(name: string) {
    for (;;) {
      const c = this.text[this.pos];
      if (c === undefined) throw new Unsure();
      if (c === '{') {
        this.pos++;
        this.expression();
      } else if (c === '<' && this.text[this.pos + 1] === '/') {
        this.pos += 2;
        this.skipSpace();
        const closing = this.tagName();
        this.skipSpace();
        if (closing !== name || this.text[this.pos] !== '>') throw new Unsure();
        this.pos++;
        return;
      } else if (c === '<') {
        this.element();
      } else {
        this.pos++;
      }
    }
  }
}
