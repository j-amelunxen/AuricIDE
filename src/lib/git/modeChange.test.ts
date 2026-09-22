import { describe, expect, it } from 'vitest';
import { describeGitMode, isExecutableBitFlip, parseModeChange } from './modeChange';

const modeOnly = `diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
`;

describe('parseModeChange', () => {
  it('reads the mode pair of a mode-only patch', () => {
    expect(parseModeChange(modeOnly)).toEqual({ oldMode: '100644', newMode: '100755' });
  });

  it('reads the pair when content changed as well', () => {
    const raw = `${modeOnly}index abcdef0..1234567
--- a/run.sh
+++ b/run.sh
@@ -1 +1 @@
-a
+b`;
    expect(parseModeChange(raw)).toEqual({ oldMode: '100644', newMode: '100755' });
  });

  it('returns null for a plain content diff', () => {
    const raw = `diff --git a/file.txt b/file.txt
index abcdef0..1234567 100644
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-a
+b`;
    expect(parseModeChange(raw)).toBeNull();
  });

  it('ignores the new-file spelling, which is not a change of mode', () => {
    expect(parseModeChange('diff --git a/x b/x\nnew file mode 100755\n')).toBeNull();
  });

  it('returns null when only one side is present', () => {
    expect(parseModeChange('old mode 100644\n')).toBeNull();
  });

  it('returns null when both sides agree', () => {
    expect(parseModeChange('old mode 100644\nnew mode 100644\n')).toBeNull();
  });

  it('does not mistake a content line for a mode line', () => {
    expect(parseModeChange(' old mode 100644\n+new mode 100755\n')).toBeNull();
  });
});

describe('describeGitMode', () => {
  it.each([
    ['100644', 'regular file'],
    ['100755', 'executable'],
    ['120000', 'symlink'],
    ['160000', 'submodule'],
    ['040000', '040000'],
  ])('describes %s as %s', (mode, label) => {
    expect(describeGitMode(mode)).toBe(label);
  });
});

describe('isExecutableBitFlip', () => {
  it('is true in both directions between regular file and executable', () => {
    expect(isExecutableBitFlip({ oldMode: '100644', newMode: '100755' })).toBe(true);
    expect(isExecutableBitFlip({ oldMode: '100755', newMode: '100644' })).toBe(true);
  });

  it('is false for a file turning into a symlink', () => {
    expect(isExecutableBitFlip({ oldMode: '100644', newMode: '120000' })).toBe(false);
  });
});
