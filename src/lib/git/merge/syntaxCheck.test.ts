import { describe, expect, it } from 'vitest';
import { parseMergedText } from './conflictModel';
import { checkProposalSyntax, checkSyntax, describeSyntaxCheck } from './syntaxCheck';

const lines = (...l: string[]) => l.join('\n') + '\n';

describe('checkSyntax: structured formats', () => {
  it('parses JSON and names the line of a break', () => {
    expect(checkSyntax('package.json', '{ "a": 1 }\n')).toMatchObject({
      kind: 'ok',
      checker: 'json',
    });
    const broken = checkSyntax('data.json', lines('{', '  "a": 1,', '  "b": 2', '  "c": 3', '}'));
    expect(broken).toMatchObject({ kind: 'problem', checker: 'json', line: 4 });
  });

  it('falls back to JSON-with-comments rules when the file has comments or trailing commas', () => {
    const text = lines('{', '  // the compiler', '  "strict": true, /* yes */', '}');
    expect(checkSyntax('tsconfig.json', text)).toMatchObject({ kind: 'ok', checker: 'jsonc' });
    expect(checkSyntax('settings.jsonc', lines('{ "a": [1, 2,], }'))).toMatchObject({
      kind: 'ok',
      checker: 'jsonc',
    });
    expect(
      checkSyntax('settings.jsonc', lines('{', '  // x', '  "a": 1', '  "b": 2', '}'))
    ).toMatchObject({
      kind: 'problem',
      checker: 'jsonc',
      line: 4,
    });
  });

  it('keeps a // inside a JSON string', () => {
    expect(checkSyntax('a.json', '{ "url": "https://example.invalid/x" }')).toMatchObject({
      kind: 'ok',
      checker: 'json',
    });
  });

  it('parses YAML, multi-document included, and reports the line of a break', () => {
    expect(checkSyntax('ci.yml', lines('a: 1', '---', 'b: [1, 2]'))).toMatchObject({
      kind: 'ok',
      checker: 'yaml',
    });
    const broken = checkSyntax('ci.yaml', lines('a: 1', 'b: [1, 2', 'c: 3'));
    expect(broken.kind).toBe('problem');
    expect(broken.checker).toBe('yaml');
    expect(broken.line).toBeGreaterThan(1);
  });

  it('leaves Markdown, TOML and unknown files unchecked', () => {
    expect(checkSyntax('README.md', '# x {').kind).toBe('unchecked');
    expect(checkSyntax('Cargo.toml', '[a').kind).toBe('unchecked');
    expect(checkSyntax('notes.txt', '((').kind).toBe('unchecked');
  });
});

describe('checkSyntax: brackets and strings in code', () => {
  it('passes balanced code and names the unclosed bracket and its line', () => {
    expect(checkSyntax('a.ts', lines('function f() {', '  return [1, (2)];', '}'))).toMatchObject({
      kind: 'ok',
      checker: 'brackets',
    });
    expect(checkSyntax('a.ts', lines('function f() {', '  return 1;'))).toMatchObject({
      kind: 'problem',
      line: 1,
      message: 'unbalanced `{` at line 1',
    });
  });

  it('names a closer that does not match', () => {
    const result = checkSyntax('a.go', lines('func f() {', '  g(1}', '}'));
    expect(result).toMatchObject({ kind: 'problem', line: 2 });
    expect(result.message).toContain('`}`');
  });

  it('reports an unclosed string', () => {
    expect(checkSyntax('a.py', lines('x = "abc', 'y = 1'))).toMatchObject({
      kind: 'problem',
      line: 1,
      message: 'unclosed string at line 1',
    });
  });

  it('ignores brackets in strings, comments, template literals and regex literals', () => {
    const ts = lines(
      "const a = '(';",
      'const b = "}";',
      'const c = `${a + `{`}]`; // ) ]',
      '/* { [ ( */',
      'const d = /[)\\]}"]+/g.test(a);',
      'const e = (x: number) => x / 2 / 3;',
      "const f = a.replace(/'/g, '');"
    );
    expect(checkSyntax('a.ts', ts)).toMatchObject({ kind: 'ok' });
  });

  it('reads JSX text with apostrophes and nested expressions', () => {
    const tsx = lines(
      'export function A({ n }: { n: number }) {',
      '  return (',
      '    <p',
      "      // a comment between attributes, isn't text",
      '      className="x" /* ( */ title={`n ${n}`}>',
      "      Don't {n > 1 ? <b>many (</b> : 'one'} <br />",
      '      <>{[1].map((i) => <i key={i}>{i}</i>)}</>',
      '    </p>',
      '  );',
      '}',
      'const g = <T,>(x: T) => x;',
      'const h = a < b && c > d;'
    );
    expect(checkSyntax('a.tsx', tsx)).toMatchObject({ kind: 'ok' });
  });

  it('knows Rust lifetimes, chars and raw strings', () => {
    const rs = lines(
      "fn f<'a>(x: &'a str) -> char {",
      '    let s = r#"he said "}" and left"#;',
      "    let c = '{';",
      "    let q = '\\'';",
      "    'outer: loop { break 'outer; }",
      "    let b = b'(';",
      '    /* nested /* } */ comment */',
      '    c',
      '}'
    );
    expect(checkSyntax('lib.rs', rs)).toMatchObject({ kind: 'ok' });
  });

  it('knows Python triple quotes, prefixes and comments', () => {
    const py = lines(
      'def f():',
      '    """Docs with ( and "quotes"."""',
      "    s = r'\\d+('",
      "    t = f'{x}]'  # ) comment",
      "    return [s, t, '''",
      '    }',
      "    ''']"
    );
    expect(checkSyntax('a.py', py)).toMatchObject({ kind: 'ok' });
  });

  it('knows Go raw strings and runes, Kotlin and Swift interpolation', () => {
    expect(checkSyntax('a.go', lines('var s = `{(`', "var r = '}'"))).toMatchObject({
      kind: 'ok',
    });
    expect(
      checkSyntax('a.kt', lines('val s = "a ${m["k"]} )"', 'val t = """ { "x" """'))
    ).toMatchObject({ kind: 'ok' });
    expect(
      checkSyntax('a.swift', lines('let s = "a \\(d["k"]) ("', 'let r = #"x"}"#'))
    ).toMatchObject({
      kind: 'ok',
    });
  });

  it('knows C++ digit separators and raw strings, and CSS urls', () => {
    expect(
      checkSyntax('a.cpp', lines("int n = 1'000;", 'auto s = R"x(a ")" {)x";', "char c = '(';"))
    ).toMatchObject({ kind: 'ok' });
    expect(
      checkSyntax('a.scss', lines('a { background: url(http://example.invalid/x.png); } // }'))
    ).toMatchObject({ kind: 'ok' });
  });

  it('reads Rust inner attributes, C++ hex floats and preprocessor lines', () => {
    expect(checkSyntax('lib.rs', lines('#![warn(', '    missing_docs', ')]'))).toMatchObject({
      kind: 'ok',
    });
    expect(
      checkSyntax(
        'm.cpp',
        lines("float f() { return -0x1.ffff'fep-1f; }", "#error don't", '#define BEGIN {')
      )
    ).toMatchObject({ kind: 'ok' });
  });

  it('does not judge C code whose preprocessor branches each hold half a brace', () => {
    const c = lines('#ifdef A', 'void f() {', '#else', 'void g() {', '#endif', '}');
    expect(checkSyntax('a.c', c).kind).toBe('unchecked');
  });

  it('says unchecked rather than guess when it cannot read a construct', () => {
    // A slash after a closing paren is read as division; a regex there would be a guess.
    const result = checkSyntax('a.js', lines('if (x) /"/.test(y);'));
    expect(result.kind).not.toBe('problem');
  });
});

describe('describeSyntaxCheck', () => {
  it('says what was checked, plainly', () => {
    expect(describeSyntaxCheck({ kind: 'ok', checker: 'json' })).toBe('Parses as JSON');
    expect(describeSyntaxCheck({ kind: 'ok', checker: 'brackets' })).toBe(
      'Brackets and strings balance'
    );
    expect(
      describeSyntaxCheck({
        kind: 'problem',
        checker: 'brackets',
        message: 'unbalanced `{` at line 42',
        line: 42,
      })
    ).toBe('Would break: unbalanced `{` at line 42');
    expect(describeSyntaxCheck({ kind: 'unchecked', checker: 'none' })).toBeNull();
  });
});

describe('checkProposalSyntax', () => {
  const merged = lines(
    '{',
    '<<<<<<< main',
    '  "a": 1,',
    '||||||| base',
    '  "a": 0,',
    '=======',
    '  "a": 2,',
    '>>>>>>> feature',
    '  "b": 3',
    '}'
  );
  const doc = parseMergedText(merged);

  it('checks the file as it would be with the proposal', () => {
    expect(checkProposalSyntax('x.json', doc, {}, 0, ['  "a": 3,'])).toMatchObject({
      kind: 'ok',
      checker: 'json',
    });
    expect(checkProposalSyntax('x.json', doc, {}, 0, ['  "a": 3'])).toMatchObject({
      kind: 'problem',
      line: 3,
    });
  });

  it('does not blame the proposal for a file that is broken either way', () => {
    const broken = parseMergedText(merged.replace('"b": 3', '"b": 3,,'));
    expect(checkProposalSyntax('x.json', broken, {}, 0, ['  "a": 3,']).kind).toBe('unchecked');
  });
});
