import { describe, expect, it } from 'vitest';
import { hunkActionsFor, hunkPatchFor, patchForHunkAction, reversePatch } from './hunkPatch';

const HEADER = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
];

const HUNK_1 = ['@@ -1,3 +1,4 @@', ' import a;', '+import b;', ' ', ' const x = 1;'];
const HUNK_2 = [
  '@@ -20,4 +21,4 @@ function run() {',
  '   start();',
  '-  stop();',
  '+  halt();',
  '   done();',
];
const HUNK_3 = [
  '@@ -40,2 +41,2 @@',
  ' tail();',
  '-last',
  '\\ No newline at end of file',
  '+last;',
  '\\ No newline at end of file',
];

const MULTI = [...HEADER, ...HUNK_1, ...HUNK_2, ...HUNK_3].join('\n') + '\n';

function patch(...parts: string[][]): string {
  return parts.flat().join('\n') + '\n';
}

describe('hunkPatchFor', () => {
  it('cuts the file header plus exactly one hunk', () => {
    expect(hunkPatchFor(MULTI, 0)).toBe(patch(HEADER, HUNK_1));
    expect(hunkPatchFor(MULTI, 1)).toBe(patch(HEADER, HUNK_2));
  });

  it('keeps the no-newline markers with the last hunk', () => {
    expect(hunkPatchFor(MULTI, 2)).toBe(patch(HEADER, HUNK_3));
  });

  it('returns null for a hunk index that does not exist', () => {
    expect(hunkPatchFor(MULTI, 3)).toBeNull();
    expect(hunkPatchFor(MULTI, -1)).toBeNull();
  });

  it('refuses new and deleted files', () => {
    const added = ['--- /dev/null', '+++ b/n.ts', '@@ -0,0 +1,1 @@', '+x'].join('\n') + '\n';
    const deleted = ['--- a/n.ts', '+++ /dev/null', '@@ -1,1 +0,0 @@', '-x'].join('\n') + '\n';
    const gitAdded =
      [
        'diff --git a/n.ts b/n.ts',
        'new file mode 100644',
        'index 0000000..1111111',
        '--- /dev/null',
        '+++ b/n.ts',
        '@@ -0,0 +1 @@',
        '+x',
      ].join('\n') + '\n';
    expect(hunkPatchFor(added, 0)).toBeNull();
    expect(hunkPatchFor(deleted, 0)).toBeNull();
    expect(hunkPatchFor(gitAdded, 0)).toBeNull();
  });

  it('refuses binary patches, renames and mode-only changes', () => {
    const binary =
      [
        'diff --git a/i.png b/i.png',
        'index 1..2 100644',
        'Binary files a/i.png and b/i.png differ',
      ].join('\n') + '\n';
    const rename =
      [
        'diff --git a/a.ts b/b.ts',
        'similarity index 90%',
        'rename from a.ts',
        'rename to b.ts',
        '--- a/a.ts',
        '+++ b/b.ts',
        ...HUNK_1,
      ].join('\n') + '\n';
    const modeOnly = ['diff --git a/s.sh b/s.sh', 'old mode 100644', 'new mode 100755'].join('\n');
    expect(hunkPatchFor(binary, 0)).toBeNull();
    expect(hunkPatchFor(rename, 0)).toBeNull();
    expect(hunkPatchFor(modeOnly, 0)).toBeNull();
    expect(hunkPatchFor('', 0)).toBeNull();
  });

  it('keeps git quoting of non-ASCII paths when cutting', () => {
    const quoted =
      [
        'diff --git "a/\\303\\274 x.txt" "b/\\303\\274 x.txt"',
        'index 1111111..2222222 100644',
        '--- "a/\\303\\274 x.txt"',
        '+++ "b/\\303\\274 x.txt"',
        ...HUNK_1,
      ].join('\n') + '\n';
    expect(hunkPatchFor(quoted, 0)).toBe(quoted);
  });

  it('turns a mode change into the mode the target keeps', () => {
    const withMode =
      [
        'diff --git a/s.sh b/s.sh',
        'old mode 100644',
        'new mode 100755',
        'index 1111111..2222222',
        '--- a/s.sh',
        '+++ b/s.sh',
        ...HUNK_1,
      ].join('\n') + '\n';
    expect(hunkPatchFor(withMode, 0)).toBe(
      patch(
        ['diff --git a/s.sh b/s.sh', 'index 1111111..2222222 100644', '--- a/s.sh', '+++ b/s.sh'],
        HUNK_1
      )
    );
  });
});

describe('reversePatch', () => {
  it('swaps the ranges, the sides and the index ids', () => {
    expect(reversePatch(patch(HEADER, HUNK_2))).toBe(
      patch(
        [
          'diff --git a/src/app.ts b/src/app.ts',
          'index 2222222..1111111 100644',
          '--- a/src/app.ts',
          '+++ b/src/app.ts',
        ],
        [
          '@@ -21,4 +20,4 @@ function run() {',
          '   start();',
          '-  halt();',
          '+  stop();',
          '   done();',
        ]
      )
    );
  });

  it('keeps ranges written without a count', () => {
    const p = patch(HEADER, ['@@ -5 +5,2 @@', ' a', '+b']);
    expect(reversePatch(p)).toContain('@@ -5,2 +5 @@\n a\n-b\n');
  });

  it('keeps each no-newline marker attached to its line', () => {
    expect(reversePatch(patch(HEADER, HUNK_3))).toBe(
      patch(
        [
          'diff --git a/src/app.ts b/src/app.ts',
          'index 2222222..1111111 100644',
          '--- a/src/app.ts',
          '+++ b/src/app.ts',
        ],
        [
          '@@ -41,2 +40,2 @@',
          ' tail();',
          '-last;',
          '\\ No newline at end of file',
          '+last',
          '\\ No newline at end of file',
        ]
      )
    );
  });

  it('keeps the quoting of non-ASCII paths and swaps inside the quotes', () => {
    const p = patch(
      [
        'diff --git "a/\\303\\274.txt" "b/\\303\\274.txt"',
        'index 1111111..2222222 100644',
        '--- "a/\\303\\274.txt"',
        '+++ "b/\\303\\274.txt"',
      ],
      ['@@ -1 +1 @@', '-a', '+b']
    );
    expect(reversePatch(p)).toBe(
      patch(
        [
          'diff --git "a/\\303\\274.txt" "b/\\303\\274.txt"',
          'index 2222222..1111111 100644',
          '--- "a/\\303\\274.txt"',
          '+++ "b/\\303\\274.txt"',
        ],
        ['@@ -1 +1 @@', '-b', '+a']
      )
    );
  });

  it('keeps paths with spaces intact', () => {
    const p = patch(
      ['diff --git a/my file.txt b/my file.txt', '--- a/my file.txt', '+++ b/my file.txt'],
      ['@@ -1 +1 @@', '-a', '+b']
    );
    expect(reversePatch(p)).toContain(
      'diff --git a/my file.txt b/my file.txt\n--- a/my file.txt\n+++ b/my file.txt\n'
    );
  });

  it('swaps the paths of the two sides', () => {
    const p = patch(['diff --git a/x b/y', '--- a/x', '+++ b/y'], ['@@ -1 +1 @@', '-a', '+b']);
    expect(reversePatch(p)).toBe(
      patch(['diff --git a/y b/x', '--- a/y', '+++ b/x'], ['@@ -1 +1 @@', '-b', '+a'])
    );
  });

  it('is its own inverse', () => {
    for (const i of [0, 1, 2]) {
      const p = hunkPatchFor(MULTI, i)!;
      expect(reversePatch(reversePatch(p))).toBe(p);
    }
  });
});

describe('hunkActionsFor', () => {
  it('offers stage and discard on unstaged, unstage on staged', () => {
    expect(hunkActionsFor({ kind: 'unstaged' }, MULTI)).toEqual(['stage', 'discard']);
    expect(hunkActionsFor({ kind: 'staged' }, MULTI)).toEqual(['unstage']);
  });

  it('offers nothing on combined, revision and ref diffs', () => {
    expect(hunkActionsFor({ kind: 'combined' }, MULTI)).toEqual([]);
    expect(hunkActionsFor({ kind: 'revision' }, MULTI)).toEqual([]);
    expect(hunkActionsFor({ kind: 'ref' }, MULTI)).toEqual([]);
    expect(hunkActionsFor({ kind: 'files' }, MULTI)).toEqual([]);
  });

  it('offers nothing when no hunk can be cut', () => {
    const added = ['--- /dev/null', '+++ b/n.ts', '@@ -0,0 +1,1 @@', '+x'].join('\n');
    expect(hunkActionsFor({ kind: 'unstaged' }, added)).toEqual([]);
  });
});

describe('patchForHunkAction with a mode change', () => {
  // libgit2 writes 100644 when a patch names no mode, so the mode the target
  // already has must ride on the index line, or unstaging a hunk drops +x.
  const MODE =
    [
      'diff --git a/s.sh b/s.sh',
      'old mode 100644',
      'new mode 100755',
      'index 1111111..2222222',
      '--- a/s.sh',
      '+++ b/s.sh',
      ...HUNK_1,
    ].join('\n') + '\n';

  it('stage keeps the old mode the index has', () => {
    const r = patchForHunkAction(MODE, 0, 'stage')!;
    expect(r.patch).toContain('index 1111111..2222222 100644\n');
    expect(r.patch).not.toMatch(/^(old|new) mode/m);
  });

  it('unstage and discard keep the new mode the index or work tree has', () => {
    for (const action of ['unstage', 'discard'] as const) {
      const r = patchForHunkAction(MODE, 0, action)!;
      expect(r.patch).toContain('index 2222222..1111111 100755\n');
      expect(r.patch).not.toMatch(/^(old|new) mode/m);
    }
  });

  it('leaves an index line that already names a mode alone', () => {
    const r = patchForHunkAction(MULTI, 0, 'unstage')!;
    expect(r.patch).toContain('index 2222222..1111111 100644\n');
  });
});

describe('patchForHunkAction', () => {
  it('maps each action to its patch and target', () => {
    const cut = hunkPatchFor(MULTI, 1)!;
    expect(patchForHunkAction(MULTI, 1, 'stage')).toEqual({ patch: cut, target: 'index' });
    expect(patchForHunkAction(MULTI, 1, 'unstage')).toEqual({
      patch: reversePatch(cut),
      target: 'index',
    });
    expect(patchForHunkAction(MULTI, 1, 'discard')).toEqual({
      patch: reversePatch(cut),
      target: 'workdir',
    });
    expect(patchForHunkAction(MULTI, 9, 'stage')).toBeNull();
  });
});
