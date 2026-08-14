import { describe, expect, it } from 'vitest';
import { buildSideBySideRows, isGitMetadataLine, parseDiff } from './parseDiff';

const sampleDiff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3`;

describe('parseDiff', () => {
  it('parses headers', () => {
    const lines = parseDiff(sampleDiff);
    expect(lines[0]).toEqual({
      type: 'header',
      content: '--- a/file.txt',
      oldLineNo: null,
      newLineNo: null,
    });
    expect(lines[1]).toEqual({
      type: 'header',
      content: '+++ b/file.txt',
      oldLineNo: null,
      newLineNo: null,
    });
  });

  it('parses hunk header and sets line numbers', () => {
    const lines = parseDiff(sampleDiff);
    const hunk = lines.find((l) => l.content.startsWith('@@'));
    expect(hunk).toBeDefined();
    expect(hunk!.type).toBe('header');
  });

  it('parses added lines with correct line numbers', () => {
    const lines = parseDiff(sampleDiff);
    const added = lines.filter((l) => l.type === 'added');
    expect(added).toHaveLength(1);
    expect(added[0].content).toBe('new line');
    expect(added[0].newLineNo).toBe(2);
    expect(added[0].oldLineNo).toBeNull();
  });

  it('parses removed lines with correct line numbers', () => {
    const lines = parseDiff(sampleDiff);
    const removed = lines.filter((l) => l.type === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].content).toBe('old line');
    expect(removed[0].oldLineNo).toBe(2);
    expect(removed[0].newLineNo).toBeNull();
  });

  it('parses context lines with both line numbers', () => {
    const lines = parseDiff(sampleDiff);
    const context = lines.filter((l) => l.type === 'context');
    expect(context).toHaveLength(2);
    expect(context[0].content).toBe('line1');
    expect(context[0].oldLineNo).toBe(1);
    expect(context[0].newLineNo).toBe(1);
  });

  it('handles empty input', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('handles untracked file diff (all added)', () => {
    const untrackedDiff = `--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world`;
    const lines = parseDiff(untrackedDiff);
    const added = lines.filter((l) => l.type === 'added');
    expect(added).toHaveLength(2);
    expect(added[0].content).toBe('hello');
    expect(added[1].content).toBe('world');
  });
});

describe('isGitMetadataLine', () => {
  it.each([
    'diff --git a/file.txt b/file.txt',
    'index abcdef0..1234567 100644',
    'old file mode 100644',
    'new file mode 100755',
    'deleted file mode 100644',
    'similarity index 90%',
    'dissimilarity index 40%',
    'rename from old.txt',
    'rename to new.txt',
    'copy from src.txt',
    'copy to dest.txt',
    'Binary files a/x.bin and b/x.bin differ',
    'GIT binary patch',
    '\\ No newline at end of file',
  ])('treats %s as metadata', (line) => {
    expect(isGitMetadataLine(line)).toBe(true);
  });

  it('does not treat --- / +++ / @@ as metadata', () => {
    expect(isGitMetadataLine('--- a/file.txt')).toBe(false);
    expect(isGitMetadataLine('+++ b/file.txt')).toBe(false);
    expect(isGitMetadataLine('@@ -1,3 +1,3 @@')).toBe(false);
  });

  it('does not treat hunk body lines as metadata', () => {
    expect(isGitMetadataLine(' line1')).toBe(false);
    expect(isGitMetadataLine('-old line')).toBe(false);
    expect(isGitMetadataLine('+new line')).toBe(false);
  });
});

describe('parseDiff git metadata', () => {
  it('drops diff --git, index, and no-newline markers', () => {
    const raw = `diff --git a/file.txt b/file.txt
index abcdef0..1234567 100644
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
 line1
-old
+new
\\ No newline at end of file`;
    const lines = parseDiff(raw);
    expect(lines.some((l) => l.content.includes('diff --git'))).toBe(false);
    expect(lines.some((l) => l.content.startsWith('index '))).toBe(false);
    expect(lines.some((l) => l.content.includes('No newline'))).toBe(false);
  });

  it('keeps following context on the hunk start line numbers', () => {
    const raw = `diff --git a/file.txt b/file.txt
index abcdef0..1234567 100644
--- a/file.txt
+++ b/file.txt
@@ -10,4 +10,4 @@
 context before
-old
+new
\\ No newline at end of file
 context after`;
    const lines = parseDiff(raw);
    const context = lines.filter((l) => l.type === 'context');
    expect(context).toHaveLength(2);
    expect(context[0].content).toBe('context before');
    expect(context[0].oldLineNo).toBe(10);
    expect(context[0].newLineNo).toBe(10);
    expect(context[1].content).toBe('context after');
    expect(context[1].oldLineNo).toBe(12);
    expect(context[1].newLineNo).toBe(12);
  });

  it('still treats --- and +++ as headers', () => {
    const raw = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-old
+new`;
    const lines = parseDiff(raw);
    expect(lines.filter((l) => l.type === 'header').map((h) => h.content)).toEqual([
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1 +1 @@',
    ]);
  });

  it('returns zero added/removed/context rows for a header-only patch', () => {
    const raw = `diff --git a/file.txt b/file.txt
index abcdef0..1234567 100644
--- a/file.txt
+++ b/file.txt`;
    const lines = parseDiff(raw);
    expect(lines.filter((l) => l.type !== 'header')).toEqual([]);
    expect(lines.map((l) => l.content)).toEqual(['--- a/file.txt', '+++ b/file.txt']);
  });
});

describe('buildSideBySideRows', () => {
  it('pairs removed/added blocks correctly', () => {
    const lines = parseDiff(sampleDiff);
    const rows = buildSideBySideRows(lines);

    const pairRow = rows.find(
      (r) => r.left?.content === 'old line' && r.right?.content === 'new line'
    );
    expect(pairRow).toBeDefined();
    expect(pairRow!.left!.type).toBe('removed');
    expect(pairRow!.right!.type).toBe('added');
  });

  it('places context lines on both sides', () => {
    const lines = parseDiff(sampleDiff);
    const rows = buildSideBySideRows(lines);

    const contextRows = rows.filter(
      (r) => r.left?.type === 'context' && r.right?.type === 'context'
    );
    expect(contextRows.length).toBeGreaterThanOrEqual(2);
    expect(contextRows[0].left!.content).toBe('line1');
    expect(contextRows[0].right!.content).toBe('line1');
  });

  it('pads with null when block sizes differ', () => {
    const unevenDiff = `--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,2 @@
-aaa
-bbb
-ccc
+xxx
+yyy`;
    const lines = parseDiff(unevenDiff);
    const rows = buildSideBySideRows(lines);

    const paddedRow = rows.find((r) => r.left?.type === 'removed' && r.right === null);
    expect(paddedRow).toBeDefined();
  });

  it('marks header lines as full-width spanners', () => {
    const lines = parseDiff(sampleDiff);
    const rows = buildSideBySideRows(lines);

    const headerRows = rows.filter((r) => r.isHeader);
    expect(headerRows.length).toBeGreaterThan(0);
    expect(headerRows[0].left!.type).toBe('header');
  });
});
