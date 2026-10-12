import { describe, expect, it } from 'vitest';
import { parseDiff } from '../parseDiff';
import {
  fileRiskScore,
  isCiConfig,
  isGeneratedPath,
  isLockfile,
  isTestPath,
  riskFlagsForHunk,
  riskFlagsForPatch,
  riskFlagsForPath,
  type RiskFlag,
} from './riskFlags';

/** One hunk as parseDiff yields it, from body lines written with their +/-/space prefix. */
function hunk(body: string[], header = '@@ -1,40 +1,40 @@'): ReturnType<typeof parseDiff> {
  return parseDiff([header, ...body].join('\n'));
}

function kinds(flags: RiskFlag[]): string[] {
  return flags.map((f) => f.kind);
}

describe('path classification', () => {
  it.each([
    ['src/lib/a.test.ts', true],
    ['src/app/Thing.spec.tsx', true],
    ['src/__tests__/a.ts', true],
    ['e2e/flow.ts', true],
    ['src-tauri/src/git/tests/merge_tests.rs', true],
    ['src-tauri/src/tests.rs', true],
    ['pkg/handler_test.go', true],
    ['tests/test_parser.py', true],
    ['app/test_views.py', true],
    ['conftest.py', true],
    ['src/lib/attest.ts', false],
    ['src/lib/contest/entry.ts', false],
    ['src/latest.rs', false],
  ])('isTestPath(%s) = %s', (path, expected) => {
    expect(isTestPath(path)).toBe(expected);
  });

  it.each([
    ['pnpm-lock.yaml', true],
    ['sub/package-lock.json', true],
    ['yarn.lock', true],
    ['src-tauri/Cargo.lock', true],
    ['uv.lock', true],
    ['poetry.lock', true],
    ['go.sum', true],
    ['package.json', false],
    ['docs/lock.md', false],
  ])('isLockfile(%s) = %s', (path, expected) => {
    expect(isLockfile(path)).toBe(expected);
  });

  it.each([
    ['dist/index.js', true],
    ['packages/ui/build/out.js', true],
    ['src-tauri/target/debug/x.rs', true],
    ['public/vendor.min.js', true],
    ['src/api/__generated__/types.ts', true],
    ['proto/user_pb2.py', true],
    ['src/__snapshots__/a.test.ts.snap', true],
    ['src/lib/builder.ts', false],
    ['src/distance.ts', false],
  ])('isGeneratedPath(%s) = %s', (path, expected) => {
    expect(isGeneratedPath(path)).toBe(expected);
  });

  it.each([
    ['.github/workflows/ci.yml', true],
    ['.gitlab-ci.yml', true],
    ['.circleci/config.yml', true],
    ['Jenkinsfile', true],
    ['.husky/pre-commit', true],
    ['docs/github/workflows.md', false],
    ['src/ci.ts', false],
  ])('isCiConfig(%s) = %s', (path, expected) => {
    expect(isCiConfig(path)).toBe(expected);
  });
});

describe('riskFlagsForPath', () => {
  it('names lockfiles, generated files and CI config, and nothing for plain source', () => {
    expect(kinds(riskFlagsForPath('pnpm-lock.yaml'))).toEqual(['lockfile']);
    expect(kinds(riskFlagsForPath('dist/app.js'))).toEqual(['generated']);
    expect(kinds(riskFlagsForPath('.github/workflows/ci.yml'))).toEqual(['ci-config']);
    expect(riskFlagsForPath('src/lib/a.ts')).toEqual([]);
  });
});

describe('riskFlagsForHunk — TypeScript / JavaScript', () => {
  it.each([
    "+  it.skip('works', () => {",
    "+describe.skip('suite', () => {",
    "+  test.only('focused', () => {",
    "+  xit('later', () => {",
    "+  it.todo('someday');",
  ])('flags a skipped or focused test: %s', (line) => {
    const flags = riskFlagsForHunk('src/a.test.ts', hunk([line]));
    expect(kinds(flags)).toEqual(['test-skipped']);
  });

  it('reports the new line number of the flagged line', () => {
    const flags = riskFlagsForHunk(
      'src/a.test.ts',
      hunk([' context', "+  it.skip('x', () => {})"], '@@ -10,1 +10,2 @@')
    );
    expect(flags[0].line).toBe(11);
  });

  it.each([
    '+// eslint-disable-next-line no-console',
    '+/* eslint-disable */',
    '+  foo(); // eslint-disable-line',
  ])('flags a lint disable: %s', (line) => {
    expect(kinds(riskFlagsForHunk('src/a.ts', hunk([line])))).toEqual(['lint-disabled']);
  });

  it.each([
    '+  // @ts-ignore',
    '+  // @ts-expect-error broken upstream types',
    '+// @ts-nocheck',
    '+const x: any = load();',
    '+function f(a: any, b: string) {}',
    '+const y = value as any;',
    '+const list: Array<any> = [];',
  ])('flags a type escape: %s', (line) => {
    expect(kinds(riskFlagsForHunk('src/a.ts', hunk([line])))).toEqual(['type-escape']);
  });

  it.each([
    "+const label = 'pick: any of these';",
    '+const anyValue = 1;',
    '+const company = obj.anything;',
    '+// we do not accept: any input',
    '+if (items.some((x) => x)) return;',
  ])('does not flag look-alikes: %s', (line) => {
    expect(riskFlagsForHunk('src/a.ts', hunk([line]))).toEqual([]);
  });

  it('ignores escapes on removed and context lines — removing one is good news', () => {
    const flags = riskFlagsForHunk(
      'src/a.ts',
      hunk(['-const x: any = 1;', ' // @ts-ignore', '+const x: number = 1;'])
    );
    expect(flags).toEqual([]);
  });

  it('does not run code rules on a markdown file that talks about them', () => {
    expect(riskFlagsForHunk('docs/guide.md', hunk(['+Never write `x as any`.']))).toEqual([]);
  });
});

describe('riskFlagsForHunk — test removal', () => {
  it('flags removed test declarations in a test file', () => {
    const flags = riskFlagsForHunk(
      'src/a.test.ts',
      hunk(["-  it('keeps order', () => {", '-    expect(1).toBe(1);', '-  });'])
    );
    expect(kinds(flags)).toEqual(['test-removed']);
    expect(flags[0].label).toMatch(/1 test/);
  });

  it('counts net removals, so renaming a test is not a removal', () => {
    const flags = riskFlagsForHunk(
      'src/a.test.ts',
      hunk(["-  it('old name', () => {", "+  it('new name', () => {"])
    );
    expect(flags).toEqual([]);
  });

  it('flags removed Rust and Python tests', () => {
    expect(
      kinds(riskFlagsForHunk('src-tauri/src/x.rs', hunk(['-    #[test]', '-    fn works() {'])))
    ).toEqual(['test-removed']);
    expect(kinds(riskFlagsForHunk('tests/test_x.py', hunk(['-def test_parses():'])))).toEqual([
      'test-removed',
    ]);
  });

  it('does not flag removed test-shaped lines outside test files', () => {
    expect(riskFlagsForHunk('src/lib/runner.ts', hunk(["-  it('x', () => {"]))).toEqual([]);
  });
});

describe('riskFlagsForHunk — Rust', () => {
  it('flags #[ignore] and #[allow(...)]', () => {
    expect(kinds(riskFlagsForHunk('src/a.rs', hunk(['+    #[ignore]'])))).toEqual(['test-skipped']);
    expect(kinds(riskFlagsForHunk('src/a.rs', hunk(['+#[allow(dead_code)]'])))).toEqual([
      'lint-disabled',
    ]);
    expect(kinds(riskFlagsForHunk('src/lib.rs', hunk(['+#![allow(clippy::all)]'])))).toEqual([
      'lint-disabled',
    ]);
  });

  it('flags .unwrap() in production code', () => {
    expect(kinds(riskFlagsForHunk('src/a.rs', hunk(['+    let v = parse(x).unwrap();'])))).toEqual([
      'unwrap',
    ]);
  });

  it('does not flag .unwrap() in test files or inside a test module hunk', () => {
    expect(riskFlagsForHunk('src/tests/a_tests.rs', hunk(['+    x.unwrap();']))).toEqual([]);
    expect(
      riskFlagsForHunk('src/a.rs', hunk(['+        x.unwrap();'], '@@ -80,3 +80,4 @@ mod tests {'))
    ).toEqual([]);
  });

  it('does not flag unwrap in a comment or string', () => {
    expect(
      riskFlagsForHunk(
        'src/a.rs',
        hunk(['+    // never call .unwrap() here', '+    log("x.unwrap()");'])
      )
    ).toEqual([]);
  });

  it('does not flag unwrap_or and friends', () => {
    expect(riskFlagsForHunk('src/a.rs', hunk(['+    let v = x.unwrap_or(0);']))).toEqual([]);
  });
});

describe('riskFlagsForHunk — Python', () => {
  it.each([
    ['+@pytest.mark.skip(reason="flaky")', 'test-skipped'],
    ['+@pytest.mark.skipif(sys.platform == "win32", reason="x")', 'test-skipped'],
    ['+@unittest.skip("later")', 'test-skipped'],
    ['+x = cast(y)  # type: ignore', 'type-escape'],
    ['+import os  # noqa: F401', 'lint-disabled'],
    ['+# pylint: disable=invalid-name', 'lint-disabled'],
  ])('flags %s', (line, kind) => {
    expect(kinds(riskFlagsForHunk('pkg/mod.py', hunk([line])))).toEqual([kind]);
  });
});

describe('riskFlagsForHunk — secrets', () => {
  it.each([
    ['+const key = "' + 'sk-ant-' + 'api03-Zq8xR2mN5vB7kL1pW4tY9cH3jD6fG0sA' + '";', 'src/a.ts'],
    ['+token: ' + 'gh' + 'p_aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dF3hJ5' + '', 'config.yml'],
    ['+AWS_KEY=' + 'AK' + 'IAZ7Q4XJ2MNB5KL8PR' + '', '.env'],
    ['+SLACK=' + 'xo' + 'xb-2847561930-8273645109-Qm7XrT2pLw9NvB4k' + '', '.env'],
    ['+' + '-----BEGIN ' + 'RSA PRIVATE KEY-----' + '', 'deploy/id_rsa'],
    ['+' + '-----BEGIN ' + 'PRIVATE KEY-----' + '', 'certs/key.pem'],
    ['+pass' + 'word = "Tr0ub4dor&3x"', 'settings.py'],
    ['+  dbPass' + 'word: "n8#Lq2!vZr"', 'src/config.ts'],
  ])('flags %s', (line, path) => {
    const flags = riskFlagsForHunk(path, hunk([line]));
    expect(kinds(flags)).toContain('secret-like');
  });

  it('never repeats the secret in the label', () => {
    const flags = riskFlagsForHunk(
      'src/a.ts',
      hunk(['+const key = "' + 'sk-ant-' + 'api03-Zq8xR2mN5vB7kL1pW4tY9cH3jD6fG0sA' + '";'])
    );
    expect(flags[0].label).not.toContain('Zq8xR2');
  });

  it.each([
    ['+const key = "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx";', 'src/a.ts'],
    ['+AWS_KEY=AKIAIOSFODNN7EXAMPLE', 'docs/setup.md'],
    ['+password = os.environ["DB_PASSWORD"]', 'settings.py'],
    ['+password = ""', 'settings.py'],
    ['+password = "changeme"', 'settings.py'],
    ['+password = "${DB_PASSWORD}"', 'compose.yml'],
    ['+const passwordLabel = "Password";', 'src/a.ts'],
    ['+import { skeleton } from "./sk-components";', 'src/a.ts'],
  ])('does not flag placeholders and look-alikes: %s', (line, path) => {
    expect(kinds(riskFlagsForHunk(path, hunk([line])))).not.toContain('secret-like');
  });

  it('skips the literal-password rule in test files, but not the token rule', () => {
    expect(riskFlagsForHunk('src/auth.test.ts', hunk(['+  password = "hunter2pw"']))).toEqual([]);
    expect(
      kinds(
        riskFlagsForHunk(
          'src/auth.test.ts',
          hunk(['+  const t = "' + 'gh' + 'p_aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dF3hJ5' + '";'])
        )
      )
    ).toEqual(['secret-like']);
  });
});

describe('riskFlagsForHunk — large deletion', () => {
  it('flags a hunk that removes far more than it adds', () => {
    const body = Array.from({ length: 45 }, (_, i) => `-line ${i}`);
    const flags = riskFlagsForHunk('src/a.ts', hunk(body));
    expect(kinds(flags)).toEqual(['large-deletion']);
    expect(flags[0].label).toMatch(/45 lines/);
  });

  it('does not flag a rewrite of similar size', () => {
    const body = [
      ...Array.from({ length: 45 }, (_, i) => `-old ${i}`),
      ...Array.from({ length: 40 }, (_, i) => `+new ${i}`),
    ];
    expect(riskFlagsForHunk('src/a.ts', hunk(body))).toEqual([]);
  });
});

describe('riskFlagsForHunk — lockfiles and generated files', () => {
  it('runs no content rules on them', () => {
    expect(
      riskFlagsForHunk(
        'pnpm-lock.yaml',
        hunk(['+  ' + 'sk-ant-' + 'api03-Zq8xR2mN5vB7kL1pW4tY9cH3jD6fG0sA' + ''])
      )
    ).toEqual([]);
    expect(riskFlagsForHunk('dist/app.js', hunk(['+const x = y as any;']))).toEqual([]);
  });
});

describe('riskFlagsForPatch', () => {
  const patch = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' a',
    '+const x = y as any;',
    ' b',
    '@@ -20,2 +21,3 @@',
    ' c',
    '+// eslint-disable-next-line',
    ' d',
    '',
  ].join('\n');

  it('flags each hunk and tags the flag with its hunk index', () => {
    const flags = riskFlagsForPatch('src/a.ts', patch);
    expect(flags.map((f) => [f.kind, f.hunk, f.line])).toEqual([
      ['type-escape', 0, 2],
      ['lint-disabled', 1, 22],
    ]);
  });

  it('adds path flags once, without a hunk', () => {
    const flags = riskFlagsForPatch('.github/workflows/ci.yml', patch);
    expect(flags[0]).toMatchObject({ kind: 'ci-config' });
    expect(flags[0].hunk).toBeUndefined();
  });

  it('returns no flags for an empty patch', () => {
    expect(riskFlagsForPatch('src/a.ts', '')).toEqual([]);
  });
});

describe('fileRiskScore', () => {
  const flag = (kind: RiskFlag['kind']): RiskFlag => ({ kind, label: kind });

  it('is zero without flags and for lockfile/generated', () => {
    expect(fileRiskScore([])).toBe(0);
    expect(fileRiskScore([flag('lockfile')])).toBe(0);
    expect(fileRiskScore([flag('generated')])).toBe(0);
  });

  it('ranks a secret above a skipped test above a type escape', () => {
    const secret = fileRiskScore([flag('secret-like')]);
    const skipped = fileRiskScore([flag('test-skipped')]);
    const escape = fileRiskScore([flag('type-escape')]);
    expect(secret).toBeGreaterThan(skipped);
    expect(skipped).toBeGreaterThan(escape);
  });

  it('lets many flags of a mild kind not outrank one severe kind', () => {
    const many = fileRiskScore(Array.from({ length: 30 }, () => flag('type-escape')));
    expect(many).toBeLessThan(fileRiskScore([flag('test-removed')]));
  });

  it('uses the count as a tiebreak inside the same kinds', () => {
    expect(fileRiskScore([flag('unwrap'), flag('unwrap')])).toBeGreaterThan(
      fileRiskScore([flag('unwrap')])
    );
  });
});
