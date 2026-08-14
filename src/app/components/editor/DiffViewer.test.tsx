import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { DiffViewer } from './DiffViewer';

const sampleDiff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3`;

const twoHunkDiff = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-old one
+new one
@@ -10,2 +10,2 @@
-old two
+new two`;

const headerOnlyDiff = `--- a/file.txt
+++ b/file.txt`;

function sideBySideColumns(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.w-1\\/2'));
}

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
    const pane = screen.getByTestId('diff-side-by-side');
    expect(pane).toHaveTextContent('new line');
    expect(pane).toHaveTextContent('old line');
  });

  it('shows empty state when diff is empty', () => {
    render(<DiffViewer diff="" fileName="file.txt" />);
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });

  it('toggles between side-by-side and unified view', async () => {
    const user = userEvent.setup();
    render(<DiffViewer diff={sampleDiff} fileName="file.txt" />);

    expect(screen.getByTestId('diff-side-by-side')).toBeInTheDocument();

    await user.click(screen.getByTestId('diff-view-toggle'));
    expect(screen.queryByTestId('diff-side-by-side')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('diff-view-toggle'));
    expect(screen.getByTestId('diff-side-by-side')).toBeInTheDocument();
  });
});

describe('DiffViewer wrap', () => {
  it('gives side-by-side columns min-w-0 and wrapping text', () => {
    render(<DiffViewer diff={sampleDiff} fileName="file.txt" />);
    const columns = sideBySideColumns(screen.getByTestId('diff-side-by-side'));
    expect(columns.length).toBeGreaterThan(0);
    for (const column of columns) {
      expect(column.className).toMatch(/\bmin-w-0\b/);
      expect(column.className).toMatch(/\boverflow-hidden\b/);
      const text = column.querySelector('.whitespace-pre-wrap');
      expect(text).not.toBeNull();
      expect(text!.className).toMatch(/\bbreak-all\b/);
      expect(text!.className).toMatch(/\bmin-w-0\b/);
    }
  });

  it('does not let a long line bleed horizontally out of a column', () => {
    const long = 'x'.repeat(400);
    const diff = `--- a/f.txt
+++ b/f.txt
@@ -1 +1 @@
-${long}
+${long}`;
    render(<DiffViewer diff={diff} fileName="f.txt" />);
    const column = sideBySideColumns(screen.getByTestId('diff-side-by-side'))[0];
    expect(column).toBeDefined();

    Object.defineProperty(column, 'clientWidth', { configurable: true, value: 240 });
    Object.defineProperty(column, 'scrollWidth', {
      configurable: true,
      get() {
        const clips =
          this.classList.contains('min-w-0') && this.classList.contains('overflow-hidden');
        const wraps = !!this.querySelector('.whitespace-pre-wrap');
        return clips && wraps ? this.clientWidth : 4000;
      },
    });
    expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth);
  });

  it('has a single overflow-auto ancestor', () => {
    const { container } = render(<DiffViewer diff={sampleDiff} fileName="file.txt" />);
    expect(container.querySelectorAll('.overflow-auto')).toHaveLength(1);
  });

  it('wraps unified view content the same way', async () => {
    const user = userEvent.setup();
    render(<DiffViewer diff={sampleDiff} fileName="file.txt" />);
    await user.click(screen.getByTestId('diff-view-toggle'));
    const text = screen.getByTestId('diff-viewer').querySelector('.whitespace-pre-wrap');
    expect(text).not.toBeNull();
    expect(text!.className).toMatch(/\bbreak-all\b/);
    expect(text!.className).toMatch(/\bmin-w-0\b/);
  });
});

describe('DiffViewer word highlight', () => {
  it('paints word spans on a paired removed/added row', () => {
    render(<DiffViewer diff={sampleDiff} fileName="file.txt" />);
    const viewer = screen.getByTestId('diff-side-by-side');
    expect(viewer.querySelectorAll('.bg-red-500\\/35').length).toBeGreaterThan(0);
    expect(viewer.querySelectorAll('.bg-green-500\\/35').length).toBeGreaterThan(0);
  });

  it('does not paint word spans on context rows', () => {
    render(<DiffViewer diff={sampleDiff} fileName="file.txt" />);
    const contextTexts = screen.getAllByText('line1');
    expect(contextTexts.length).toBeGreaterThan(0);
    for (const text of contextTexts) {
      const column = text.closest('.w-1\\/2');
      expect(column).not.toBeNull();
      expect(column!.querySelector('.bg-red-500\\/35')).toBeNull();
      expect(column!.querySelector('.bg-green-500\\/35')).toBeNull();
    }
  });

  it('does not paint word spans on unpaired rows', () => {
    const uneven = `--- a/f.txt
+++ b/f.txt
@@ -1,2 +1,1 @@
-aaa
-only left
+zzz`;
    render(<DiffViewer diff={uneven} fileName="f.txt" />);
    const column = screen.getByText('only left').closest('.w-1\\/2');
    expect(column).not.toBeNull();
    expect(column!.querySelector('.bg-red-500\\/35')).toBeNull();
    expect(column!.querySelector('.bg-green-500\\/35')).toBeNull();
  });

  it('keeps unified view line-level without word spans', async () => {
    const user = userEvent.setup();
    render(<DiffViewer diff={sampleDiff} fileName="file.txt" />);
    await user.click(screen.getByTestId('diff-view-toggle'));
    const viewer = screen.getByTestId('diff-viewer');
    expect(viewer.querySelector('.bg-red-500\\/35')).toBeNull();
    expect(viewer.querySelector('.bg-green-500\\/35')).toBeNull();
    expect(viewer).toHaveTextContent('old line');
    expect(viewer).toHaveTextContent('new line');
  });
});

describe('DiffViewer hunk navigation', () => {
  it('next and prev move to data-hunk-index', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<DiffViewer diff={twoHunkDiff} fileName="file.txt" />);
    const viewer = screen.getByTestId('diff-viewer');
    expect(viewer.querySelector('[data-hunk-index="0"]')).not.toBeNull();
    expect(viewer.querySelector('[data-hunk-index="1"]')).not.toBeNull();
    expect(viewer.querySelector('[data-hunk-index="0"]')!.textContent).toContain('@@ -1,2 +1,2 @@');
    expect(viewer.querySelector('[data-hunk-index="1"]')!.textContent).toContain(
      '@@ -10,2 +10,2 @@'
    );

    await user.click(screen.getByTestId('diff-next-hunk'));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(scrollIntoView.mock.instances[0]).toBe(viewer.querySelector('[data-hunk-index="1"]'));

    await user.click(screen.getByTestId('diff-prev-hunk'));
    expect(scrollIntoView.mock.instances[1]).toBe(viewer.querySelector('[data-hunk-index="0"]'));
  });

  it('wraps next and prev around the first and last hunk', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<DiffViewer diff={twoHunkDiff} fileName="file.txt" />);
    const viewer = screen.getByTestId('diff-viewer');

    await user.click(screen.getByTestId('diff-prev-hunk'));
    expect(scrollIntoView.mock.instances.at(-1)).toBe(
      viewer.querySelector('[data-hunk-index="1"]')
    );

    await user.click(screen.getByTestId('diff-next-hunk'));
    expect(scrollIntoView.mock.instances.at(-1)).toBe(
      viewer.querySelector('[data-hunk-index="0"]')
    );
  });

  it('is a no-op on a header-only patch', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<DiffViewer diff={headerOnlyDiff} fileName="file.txt" />);
    expect(screen.getByTestId('diff-viewer').querySelector('[data-hunk-index]')).toBeNull();

    await user.click(screen.getByTestId('diff-next-hunk'));
    await user.click(screen.getByTestId('diff-prev-hunk'));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('does not treat --- / +++ as hunk stops', () => {
    render(<DiffViewer diff={sampleDiff} fileName="file.txt" />);
    const hunks = screen.getByTestId('diff-viewer').querySelectorAll('[data-hunk-index]');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].textContent).toContain('@@ -1,3 +1,3 @@');
  });

  it('moves hunks with Alt+Arrow keys', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<DiffViewer diff={twoHunkDiff} fileName="file.txt" />);
    const viewer = screen.getByTestId('diff-viewer');
    viewer.focus();

    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(scrollIntoView.mock.instances.at(-1)).toBe(
      viewer.querySelector('[data-hunk-index="1"]')
    );

    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(scrollIntoView.mock.instances.at(-1)).toBe(
      viewer.querySelector('[data-hunk-index="0"]')
    );
  });

  it('follows gitSlice hunkNavNonce from the command palette', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    useStore.getState().resetGitInMemory();

    render(<DiffViewer diff={twoHunkDiff} fileName="file.txt" />);
    const viewer = screen.getByTestId('diff-viewer');

    act(() => {
      useStore.getState().requestHunkNav('next');
    });
    await waitFor(() => {
      expect(scrollIntoView.mock.instances.at(-1)).toBe(
        viewer.querySelector('[data-hunk-index="1"]')
      );
    });

    act(() => {
      useStore.getState().requestHunkNav('prev');
    });
    await waitFor(() => {
      expect(scrollIntoView.mock.instances.at(-1)).toBe(
        viewer.querySelector('[data-hunk-index="0"]')
      );
    });
  });
});
