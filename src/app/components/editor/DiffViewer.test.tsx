import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { buildSideBySideRows, DiffViewer, parseDiff } from './DiffViewer';

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

describe('DiffViewer', () => {
  it('renders the diff viewer container', () => {
    render(<DiffViewer diff={sampleDiff} fileName="file.txt" />);
    expect(screen.getByTestId('diff-viewer')).toBeInTheDocument();
  });

  it('displays the file name', () => {
    render(<DiffViewer diff={sampleDiff} fileName="file.txt" />);
    expect(screen.getByText('file.txt')).toBeInTheDocument();
  });

  it('renders added and removed content', () => {
    render(<DiffViewer diff={sampleDiff} fileName="file.txt" />);
    expect(screen.getByText('new line')).toBeInTheDocument();
    expect(screen.getByText('old line')).toBeInTheDocument();
  });

  it('shows empty state when diff is empty', () => {
    render(<DiffViewer diff="" fileName="file.txt" />);
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });

  it('toggles between side-by-side and unified view', async () => {
    const user = userEvent.setup();
    render(<DiffViewer diff={sampleDiff} fileName="file.txt" />);

    // Side-by-side is the default
    expect(screen.getByTestId('diff-side-by-side')).toBeInTheDocument();

    // Click toggle to switch to unified
    await user.click(screen.getByTestId('diff-view-toggle'));
    expect(screen.queryByTestId('diff-side-by-side')).not.toBeInTheDocument();

    // Click again to go back to side-by-side
    await user.click(screen.getByTestId('diff-view-toggle'));
    expect(screen.getByTestId('diff-side-by-side')).toBeInTheDocument();
  });
});

describe('buildSideBySideRows', () => {
  it('pairs removed/added blocks correctly', () => {
    const lines = parseDiff(sampleDiff);
    const rows = buildSideBySideRows(lines);

    // Find the row that pairs "old line" and "new line"
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

    // 3 removed vs 2 added → one row must have right=null
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
