import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { DiffViewer } from '../DiffViewer';

const mockReloadDiffPatch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/git/applyLineEdit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/git/applyLineEdit')>();
  return {
    ...actual,
    reloadDiffPatch: (...args: unknown[]) => mockReloadDiffPatch(...args),
  };
});

const twoHunks = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,2 @@
-old one
+new one
@@ -10,2 +10,2 @@
-old two
+new two`;

const oneHunk = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,2 +10,2 @@
-old two
+new two`;

const TAB = 'diff:unstaged:/repo:src/app.ts';
const applyHunkAction = vi.fn();
const showToast = vi.fn();

function seedTab(patch: string, kind: 'unstaged' | 'staged' = 'unstaged') {
  useStore.getState().setDiffTab(TAB, {
    patch,
    filePath: 'src/app.ts',
    repoPath: '/repo',
    source: { kind },
  });
}

beforeEach(() => {
  applyHunkAction.mockReset().mockResolvedValue(undefined);
  showToast.mockReset();
  mockReloadDiffPatch.mockReset().mockResolvedValue(oneHunk);
  useStore.getState().resetGitInMemory();
  useStore.setState({
    activeTabId: TAB,
    applyHunkAction,
    showToast,
    refreshRepoStatus: vi.fn().mockResolvedValue(undefined),
    spawnDialogOpen: false,
    agents: [],
  });
  seedTab(twoHunks);
});

function toolbars() {
  return screen.getAllByTestId('hunk-toolbar');
}

describe('DiffViewer hunk actions', () => {
  it('offers stage and discard on every hunk of an unstaged diff', () => {
    render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    expect(toolbars()).toHaveLength(2);
    for (const bar of toolbars()) {
      expect(within(bar).getByRole('button', { name: /stage hunk/i })).toBeInTheDocument();
      expect(within(bar).getByRole('button', { name: /discard hunk/i })).toBeInTheDocument();
    }
  });

  it('offers only unstage on a staged diff and nothing on a revision', () => {
    const { rerender } = render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'staged' }}
      />
    );
    expect(screen.getAllByRole('button', { name: /unstage hunk/i })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /discard hunk/i })).not.toBeInTheDocument();

    rerender(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'revision', oid: 'abc', summary: 's' }}
      />
    );
    expect(screen.queryByTestId('hunk-toolbar')).not.toBeInTheDocument();
  });

  it('stages one hunk and reloads the tab patch', async () => {
    const user = userEvent.setup();
    render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Stage hunk 2 of 2 in app.ts' }));
    await waitFor(() => expect(useStore.getState().diffByTabId[TAB].patch).toBe(oneHunk));
    expect(applyHunkAction).toHaveBeenCalledWith('/repo', 'src/app.ts', twoHunks, 1, 'stage');
    expect(mockReloadDiffPatch).toHaveBeenCalledWith('/repo', 'src/app.ts', { kind: 'unstaged' });
  });

  it('asks before discarding and does nothing on cancel', async () => {
    const user = userEvent.setup();
    render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Discard hunk 1 of 2 in app.ts' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(applyHunkAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Discard hunk 1 of 2 in app.ts' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard hunk' })
    );
    await waitFor(() =>
      expect(applyHunkAction).toHaveBeenCalledWith('/repo', 'src/app.ts', twoHunks, 0, 'discard')
    );
  });

  it('shows a refusal as a toast and still reloads', async () => {
    applyHunkAction.mockRejectedValue(
      new Error('Could not stage the hunk in src/app.ts: no longer applies')
    );
    const user = userEvent.setup();
    render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Stage hunk 1 of 2 in app.ts' }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        'Could not stage the hunk in src/app.ts: no longer applies',
        'error'
      )
    );
    expect(mockReloadDiffPatch).toHaveBeenCalled();
  });

  it('S stages the focused hunk, and the focus follows hunk navigation', async () => {
    render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    const viewer = screen.getByTestId('diff-viewer');
    fireEvent.keyDown(viewer, { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(viewer, { key: 's' });
    await waitFor(() =>
      expect(applyHunkAction).toHaveBeenCalledWith('/repo', 'src/app.ts', twoHunks, 1, 'stage')
    );
  });

  it('keeps the focused hunk on a real hunk when the patch shrinks', async () => {
    const { rerender } = render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    fireEvent.keyDown(screen.getByTestId('diff-viewer'), { key: 'ArrowDown', altKey: true });
    rerender(
      <DiffViewer
        diff={oneHunk}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    fireEvent.keyDown(screen.getByTestId('diff-viewer'), { key: 'S' });
    await waitFor(() =>
      expect(applyHunkAction).toHaveBeenCalledWith('/repo', 'src/app.ts', oneHunk, 0, 'stage')
    );
  });

  it('Delete asks before discarding the focused hunk', async () => {
    render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    fireEvent.keyDown(screen.getByTestId('diff-viewer'), { key: 'Delete' });
    expect(await screen.findByRole('dialog')).toHaveTextContent('hunk 1 of src/app.ts');
    expect(applyHunkAction).not.toHaveBeenCalled();
  });
});

describe('DiffViewer risk chips', () => {
  it('puts a hunk flag on its own hunk and a path flag in the header', () => {
    const testFile = `diff --git a/src/app.test.ts b/src/app.test.ts
--- a/src/app.test.ts
+++ b/src/app.test.ts
@@ -1,2 +1,2 @@
 describe('x', () => {
-  it('works', () => {});
+  it.skip('works', () => {});
@@ -20,1 +20,1 @@
-const a = 1;
+const a = 2;`;
    render(
      <DiffViewer
        diff={testFile}
        fileName="src/app.test.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    const [first, second] = toolbars();
    expect(within(first).getByTestId('risk-chip')).toHaveAttribute('data-kind', 'test-skipped');
    expect(within(first).getByTestId('risk-chip')).toHaveAttribute(
      'title',
      expect.stringMatching(/skips/)
    );
    expect(within(second).queryByTestId('risk-chip')).not.toBeInTheDocument();
  });

  it('shows a lockfile flag once, in the file header', () => {
    const lock = `--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1,1 +1,1 @@
-a: 1
+a: 2`;
    render(<DiffViewer diff={lock} fileName="pnpm-lock.yaml" />);
    const chips = screen.getAllByTestId('risk-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveAttribute('data-kind', 'lockfile');
  });
});

describe('DiffViewer sent comments', () => {
  const base = {
    repoPath: '/repo',
    filePath: 'src/app.ts',
    side: 'new' as const,
    lineContent: 'new one',
  };

  it('shows a sent comment as sent, without a remove button, and leaves it out of the count', () => {
    useStore.setState({
      reviewComments: [
        { ...base, id: 's', lineNo: 1, body: 'done already', createdAt: 1, sentInRound: 1 },
        { ...base, id: 'o', lineNo: 10, lineContent: 'new two', body: 'still open', createdAt: 2 },
      ],
    });
    render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    const comments = screen.getAllByTestId('diff-line-comment');
    const sent = comments.find((c) => c.textContent?.includes('done already'))!;
    expect(sent).toHaveTextContent('Sent in round 1');
    expect(within(sent).queryByRole('button', { name: 'Remove comment' })).not.toBeInTheDocument();
    expect(screen.getByTestId('diff-send-comments')).toHaveTextContent('Send 1 comment');
  });

  it('marks the comments sent once the spawn dialog closes with an agent launched', async () => {
    const user = userEvent.setup();
    useStore.getState().addReviewComment({ ...base, lineNo: 1, body: 'rename' });
    render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    await user.click(screen.getByTestId('diff-send-comments'));
    expect(useStore.getState().spawnDialogOpen).toBe(true);

    act(() => {
      useStore.setState({
        agents: [
          {
            id: 'new',
            name: 'fixer',
            status: 'running',
            model: 'm',
            provider: 'p',
            startedAt: 1,
            currentTask: useStore.getState().initialAgentTask,
          },
        ],
      });
      useStore.setState({ spawnDialogOpen: false });
    });
    expect(useStore.getState().reviewComments[0].sentInRound).toBe(1);
    expect(screen.queryByTestId('diff-send-comments')).not.toBeInTheDocument();
  });

  it('keeps the comments open when the dialog is cancelled', async () => {
    const user = userEvent.setup();
    useStore.getState().addReviewComment({ ...base, lineNo: 1, body: 'rename' });
    render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    await user.click(screen.getByTestId('diff-send-comments'));
    act(() => useStore.setState({ spawnDialogOpen: false }));
    expect(useStore.getState().reviewComments[0].sentInRound).toBeUndefined();
  });
});

describe('DiffViewer focus and narrow width', () => {
  it('puts focus back on the diff after a hunk action and after a comment', async () => {
    const user = userEvent.setup();
    render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Stage hunk 1 of 2 in app.ts' }));
    await waitFor(() => expect(screen.getByTestId('diff-viewer')).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Comment on line 1' }));
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('diff-viewer')).toHaveFocus();
  });

  it('names the key on the focused hunk for assistive tech, and shows it only visually', () => {
    render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    const discard = screen.getByRole('button', { name: 'Discard hunk 1 of 2 in app.ts' });
    expect(discard).toHaveAttribute('aria-keyshortcuts', 'Backspace Delete');
    expect(discard.querySelector('kbd')).toHaveAttribute('aria-hidden', 'true');
    // Hunk 2 is not focused: no key caps there.
    expect(
      screen.getByRole('button', { name: 'Discard hunk 2 of 2 in app.ts' }).querySelector('kbd')
    ).toBeNull();
  });

  it('falls back to one column when the editor is narrow', () => {
    let callback: ResizeObserverCallback | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          callback = cb;
        }
        observe() {}
        disconnect() {}
      }
    );
    try {
      render(<DiffViewer diff={twoHunks} fileName="src/app.ts" />);
      expect(screen.getByTestId('diff-side-by-side')).toBeInTheDocument();
      act(() =>
        callback?.([{ contentRect: { width: 500 } } as ResizeObserverEntry], {} as ResizeObserver)
      );
      expect(screen.queryByTestId('diff-side-by-side')).toBeNull();
      expect(screen.getByTestId('diff-view-toggle')).toBeDisabled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('DiffViewer shortcut sheet', () => {
  it('? opens the diff shortcuts', async () => {
    render(
      <DiffViewer
        diff={twoHunks}
        fileName="src/app.ts"
        repoPath="/repo"
        source={{ kind: 'unstaged' }}
      />
    );
    fireEvent.keyDown(screen.getByTestId('diff-viewer'), { key: '?' });
    expect(await screen.findByRole('dialog', { name: 'Diff shortcuts' })).toHaveTextContent(
      'Discard the focused hunk'
    );
  });
});

const removalOnly = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -5,2 +5,1 @@
 keep
-gone`;

function renderDiff(diff = twoHunks) {
  return render(
    <DiffViewer diff={diff} fileName="src/app.ts" repoPath="/repo" source={{ kind: 'unstaged' }} />
  );
}

describe('DiffViewer comment threads', () => {
  const line = {
    repoPath: '/repo',
    filePath: 'src/app.ts',
    side: 'new' as const,
    lineNo: 1,
    lineContent: 'new one',
  };

  it('shows every comment of a line, the sent one muted and read only, the open one editable', () => {
    useStore.setState({
      reviewComments: [
        { ...line, id: 's', body: 'rename it', createdAt: 1, sentInRound: 1 },
        { ...line, id: 'o', body: 'still wrong', createdAt: 2 },
      ],
    });
    renderDiff();
    const [sent, open] = screen.getAllByTestId('diff-line-comment');
    expect(sent).toHaveTextContent('rename it');
    expect(sent).toHaveTextContent('Sent in round 1');
    expect(within(sent).queryByRole('button', { name: /edit comment/i })).toBeNull();
    expect(within(sent).queryByRole('button', { name: 'Remove comment' })).toBeNull();
    expect(open).toHaveTextContent('still wrong');
    expect(within(open).getByRole('button', { name: 'Edit comment' })).toBeInTheDocument();
    expect(within(open).getByRole('button', { name: 'Remove comment' })).toBeInTheDocument();
  });

  it('Reply adds a new comment to the thread and leaves the sent one as it was', async () => {
    const user = userEvent.setup();
    useStore.setState({
      reviewComments: [{ ...line, id: 's', body: 'rename it', createdAt: 1, sentInRound: 1 }],
    });
    renderDiff();
    await user.click(screen.getByRole('button', { name: 'Reply on line 1' }));
    const composer = screen.getByRole('textbox', { name: 'Review comment' });
    expect(composer).toHaveValue('');
    expect(composer).toHaveFocus();
    await user.type(composer, 'still wrong');
    await user.click(screen.getByRole('button', { name: 'Save comment' }));

    const comments = useStore.getState().reviewComments;
    expect(comments).toHaveLength(2);
    expect(comments.find((c) => c.id === 's')).toMatchObject({ body: 'rename it', sentInRound: 1 });
    expect(screen.getAllByTestId('diff-line-comment')).toHaveLength(2);
  });

  it('the gutter button starts a new comment even when the line has an open one', async () => {
    const user = userEvent.setup();
    useStore.setState({ reviewComments: [{ ...line, id: 'o', body: 'first', createdAt: 1 }] });
    renderDiff();
    await user.click(screen.getByRole('button', { name: 'Comment on line 1' }));
    expect(screen.getByRole('textbox', { name: 'Review comment' })).toHaveValue('');
    expect(screen.getByTestId('diff-line-comment')).toHaveTextContent('first');
  });

  it('Edit rewrites that open comment in place', async () => {
    const user = userEvent.setup();
    useStore.setState({ reviewComments: [{ ...line, id: 'o', body: 'first', createdAt: 1 }] });
    renderDiff();
    await user.click(screen.getByRole('button', { name: 'Edit comment' }));
    const composer = screen.getByRole('textbox', { name: 'Review comment' });
    expect(composer).toHaveValue('first');
    await user.clear(composer);
    await user.type(composer, 'second thoughts');
    await user.click(screen.getByRole('button', { name: 'Save comment' }));

    expect(useStore.getState().reviewComments).toEqual([
      expect.objectContaining({ id: 'o', body: 'second thoughts', createdAt: 1 }),
    ]);
  });

  it('Remove drops only that comment of the thread', async () => {
    const user = userEvent.setup();
    useStore.setState({
      reviewComments: [
        { ...line, id: 'a', body: 'one', createdAt: 1 },
        { ...line, id: 'b', body: 'two', createdAt: 2 },
      ],
    });
    renderDiff();
    const [firstComment] = screen.getAllByTestId('diff-line-comment');
    await user.click(within(firstComment).getByRole('button', { name: 'Remove comment' }));
    expect(useStore.getState().reviewComments.map((c) => c.id)).toEqual(['b']);
  });
});

describe('DiffViewer C shortcut', () => {
  it('C opens the composer on the focused hunk first changed line, Esc returns to the diff', async () => {
    renderDiff();
    const viewer = screen.getByTestId('diff-viewer');
    viewer.focus();
    fireEvent.keyDown(viewer, { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(viewer, { key: 'c' });

    const composer = screen.getByRole('textbox', { name: 'Review comment' });
    expect(document.activeElement).toBe(composer);
    fireEvent.keyDown(composer, { key: 'Escape' });
    expect(viewer).toHaveFocus();

    fireEvent.keyDown(viewer, { key: 'C' });
    const again = screen.getByRole('textbox', { name: 'Review comment' });
    fireEvent.change(again, { target: { value: 'why two?' } });
    fireEvent.keyDown(again, { key: 'Enter', metaKey: true });
    expect(viewer).toHaveFocus();
    expect(useStore.getState().reviewComments).toEqual([
      expect.objectContaining({
        side: 'new',
        lineNo: 10,
        lineContent: 'new two',
        body: 'why two?',
      }),
    ]);
  });

  it('comments on the old side when the hunk only removes', () => {
    renderDiff(removalOnly);
    const viewer = screen.getByTestId('diff-viewer');
    fireEvent.keyDown(viewer, { key: 'c' });
    const composer = screen.getByRole('textbox', { name: 'Review comment' });
    fireEvent.change(composer, { target: { value: 'keep this' } });
    fireEvent.keyDown(composer, { key: 'Enter', metaKey: true });
    expect(useStore.getState().reviewComments).toEqual([
      expect.objectContaining({ side: 'old', lineNo: 6, lineContent: 'gone' }),
    ]);
  });

  it('a C typed into the composer is text, not a second composer', async () => {
    const user = userEvent.setup();
    renderDiff();
    fireEvent.keyDown(screen.getByTestId('diff-viewer'), { key: 'c' });
    await user.keyboard('c');
    expect(screen.getAllByRole('textbox', { name: 'Review comment' })).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Review comment' })).toHaveValue('c');
  });

  it('is listed on the shortcut sheet', async () => {
    renderDiff();
    fireEvent.keyDown(screen.getByTestId('diff-viewer'), { key: '?' });
    expect(await screen.findByRole('dialog', { name: 'Diff shortcuts' })).toHaveTextContent(
      'Comment on the focused hunk'
    );
  });
});
