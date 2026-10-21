import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type { GraphRepoState } from '@/lib/store/gitGraphSlice';
import type { GitRefs, GraphCommit } from '@/lib/tauri/gitGraph';
import { GitGraphView } from './GitGraphView';
import { laidOut, linearCommits, makeCommit, makeRef, makeRefs } from './testGraph';

const REPO = '/work/app';
const NOW = 1_760_000_000_000;

const openMergeTabOrToast = vi.fn();
vi.mock('@/lib/ide/openMergeTab', () => ({
  openMergeTabOrToast: (...args: unknown[]) => openMergeTabOrToast(...args),
}));
const openRevisionDiff = vi.fn();
vi.mock('./openRevisionDiff', () => ({
  openRevisionDiff: (...args: unknown[]) => openRevisionDiff(...args),
}));
vi.mock('@/lib/tauri/clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }));

const ok = async () => ({ ok: true as const });

function graphState(commits: GraphCommit[], refs: GitRefs, over: Partial<GraphRepoState> = {}) {
  return {
    commits,
    rows: laidOut(commits, refs.headOid),
    carry: null,
    hasMore: false,
    loading: false,
    refs,
    selectedOid: null,
    details: {},
    filterText: '',
    branchFilter: null,
    busy: null,
    lastError: null,
    generation: 1,
    ...over,
  } satisfies GraphRepoState;
}

const mainRefs = (over: Partial<GitRefs> = {}) =>
  makeRefs(
    [
      makeRef('main', 'local', 'c0', true),
      makeRef('feature', 'local', 'c2'),
      makeRef('v1.0', 'tag', 'c4'),
    ],
    over
  );

function seed(
  over: Partial<GraphRepoState> = {},
  refs: GitRefs = mainRefs(),
  commits = linearCommits(10)
) {
  useStore.setState({
    repos: [{ path: REPO, name: 'app', relativePath: '', kind: 'root' }],
    graphs: { [REPO]: graphState(commits, refs, over) },
    toasts: [],
    openTabs: [],
    activeTabId: null,
    openGraph: vi.fn(async () => undefined),
    loadMore: vi.fn(async () => undefined),
    loadFirstPage: vi.fn(async () => undefined),
    refreshRefs: vi.fn(async () => false),
    loadGraphDetail: vi.fn(async () => null),
    refreshMergeState: vi.fn(async () => null),
    graphCheckout: vi.fn(ok),
    graphCreateBranch: vi.fn(ok),
    graphRenameBranch: vi.fn(ok),
    graphDeleteBranch: vi.fn(ok),
    graphCreateTag: vi.fn(ok),
    graphDeleteTag: vi.fn(ok),
    graphCherryPick: vi.fn(ok),
    graphRevert: vi.fn(ok),
  } as never);
}

const rowOf = (n: number) =>
  screen.getByRole('option', { name: new RegExp(`Commit number ${n},`) });
const menuItem = (name: string | RegExp) => screen.getByRole('menuitem', { name });

describe('GitGraphView', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    openMergeTabOrToast.mockClear();
    seed();
  });

  it('shows the toolbar, the commits, and a prompt in place of the inspector', () => {
    render(<GitGraphView repoPath={REPO} />);
    expect(screen.getByRole('group', { name: 'Graph' })).toBeInTheDocument();
    expect(screen.getAllByRole('option').length).toBe(10);
    expect(screen.getByText('Select a commit to inspect it.')).toBeInTheDocument();
  });

  it('starts loading the graph when it opens', () => {
    render(<GitGraphView repoPath={REPO} />);
    expect(useStore.getState().openGraph).toHaveBeenCalledWith(REPO);
  });

  it('fills in when the graph arrives after the tab is already open', () => {
    useStore.setState({ graphs: {} });
    render(<GitGraphView repoPath={REPO} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading history…');
    act(() => {
      useStore.setState({ graphs: { [REPO]: graphState(linearCommits(4), mainRefs()) } });
    });
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('says so for a folder that is not a known repository', () => {
    useStore.setState({ graphs: {}, repos: [] });
    render(<GitGraphView repoPath="/nowhere" />);
    expect(screen.getByText('Not a git repository')).toBeInTheDocument();
  });

  it('says so for a repository without commits', () => {
    seed({}, makeRefs([], { headOid: null }), []);
    render(<GitGraphView repoPath={REPO} />);
    expect(screen.getByText('No commits yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jump to HEAD' })).toBeDisabled();
  });

  it('offers a retry when the first load failed', async () => {
    const user = userEvent.setup();
    seed({ lastError: 'Could not read the commit history.' }, mainRefs(), []);
    render(<GitGraphView repoPath={REPO} />);
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(useStore.getState().loadFirstPage).toHaveBeenCalledWith(REPO);
  });

  describe('selection and inspector', () => {
    it('opens a commit in the inspector when its row is clicked', async () => {
      const user = userEvent.setup();
      render(<GitGraphView repoPath={REPO} />);
      await user.click(rowOf(3));
      expect(useStore.getState().graphs[REPO].selectedOid).toBe('c3');
      expect(screen.getByRole('heading', { name: 'Commit number 3' })).toBeInTheDocument();
    });

    it('hides the inspector from the toolbar and with Return', async () => {
      const user = userEvent.setup();
      render(<GitGraphView repoPath={REPO} />);
      await user.click(screen.getByRole('button', { name: 'Inspector' }));
      expect(screen.queryByRole('complementary', { name: 'Commit inspector' })).toBeNull();
      screen.getByRole('listbox').focus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('complementary', { name: 'Commit inspector' })).toBeInTheDocument();
    });

    it('opens a file of the commit in the revision diff tab', async () => {
      const user = userEvent.setup();
      const detail = {
        oid: 'c3',
        parents: ['c4'],
        message: 'Commit number 3',
        authorName: 'Ada',
        authorEmail: 'a@x',
        authorTime: 0,
        committerName: 'Ada',
        committerEmail: 'a@x',
        committerTime: 0,
        files: [{ path: 'src/a.ts', status: 'modified' as const }],
      };
      seed({ selectedOid: 'c3', details: { 'c3:0': detail } });
      render(<GitGraphView repoPath={REPO} />);
      await user.click(screen.getByRole('button', { name: /a\.ts/ }));
      expect(openRevisionDiff).toHaveBeenCalledWith(
        REPO,
        expect.objectContaining({ oid: 'c3', summary: 'Commit number 3' }),
        'src/a.ts',
        0
      );
    });

    it('follows a parent button to the parent commit', async () => {
      const user = userEvent.setup();
      seed({ selectedOid: 'c3' });
      render(<GitGraphView repoPath={REPO} />);
      await user.click(screen.getByRole('button', { name: /^Parent c4/ }));
      expect(useStore.getState().graphs[REPO].selectedOid).toBe('c4');
    });
  });

  describe('search', () => {
    it('marks matching rows and steps between them with Cmd+G', async () => {
      const user = userEvent.setup();
      render(<GitGraphView repoPath={REPO} />);
      await user.type(screen.getByRole('searchbox', { name: 'Search commits' }), 'number 5');
      expect(rowOf(5)).toHaveAttribute('data-match', 'true');
      expect(rowOf(4)).not.toHaveAttribute('data-match');
      fireEvent.keyDown(screen.getByTestId('git-graph'), { key: 'g', metaKey: true });
      expect(useStore.getState().graphs[REPO].selectedOid).toBe('c5');
      expect(screen.getByText('1 of 1')).toBeInTheDocument();
    });

    it('matches a ref name too', async () => {
      const user = userEvent.setup();
      render(<GitGraphView repoPath={REPO} />);
      await user.type(screen.getByRole('searchbox'), 'v1.0');
      expect(rowOf(4)).toHaveAttribute('data-match', 'true');
    });

    it('wraps around with Cmd+G and goes back with Shift+Cmd+G', () => {
      seed({ filterText: 'number', selectedOid: 'c9' });
      render(<GitGraphView repoPath={REPO} />);
      const root = screen.getByTestId('git-graph');
      fireEvent.keyDown(root, { key: 'g', metaKey: true });
      expect(useStore.getState().graphs[REPO].selectedOid).toBe('c0');
      fireEvent.keyDown(root, { key: 'g', metaKey: true, shiftKey: true });
      expect(useStore.getState().graphs[REPO].selectedOid).toBe('c9');
    });

    it('focuses the search field with Cmd+F', () => {
      render(<GitGraphView repoPath={REPO} />);
      screen.getByRole('listbox').focus();
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'f', metaKey: true });
      expect(screen.getByRole('searchbox')).toHaveFocus();
    });

    it('clears the search with Escape first, then the selection', () => {
      seed({ filterText: 'number', selectedOid: 'c2' });
      render(<GitGraphView repoPath={REPO} />);
      const list = screen.getByRole('listbox');
      fireEvent.keyDown(list, { key: 'Escape' });
      expect(useStore.getState().graphs[REPO].filterText).toBe('');
      expect(useStore.getState().graphs[REPO].selectedOid).toBe('c2');
      fireEvent.keyDown(list, { key: 'Escape' });
      expect(useStore.getState().graphs[REPO].selectedOid).toBeNull();
    });
  });

  describe('branch filter', () => {
    it('dims commits the chosen branch does not reach, without reloading', async () => {
      const user = userEvent.setup();
      render(<GitGraphView repoPath={REPO} />);
      await user.click(screen.getByRole('button', { name: /Branches: All Branches/ }));
      await user.click(screen.getByRole('menuitemradio', { name: 'feature' }));
      expect(rowOf(0)).toHaveAttribute('data-dimmed', 'true');
      expect(rowOf(5)).not.toHaveAttribute('data-dimmed');
      expect(useStore.getState().loadFirstPage).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Branches: feature/ })).toBeInTheDocument();
    });
  });

  describe('context menus', () => {
    it('offers the commit operations on a row', async () => {
      const user = userEvent.setup();
      render(<GitGraphView repoPath={REPO} />);
      await user.pointer({ keys: '[MouseRight]', target: rowOf(3) });
      expect(
        within(screen.getByRole('menu'))
          .getAllByRole('menuitem')
          .map((i) => i.textContent)
      ).toEqual([
        'Check Out (detached)…',
        'New Branch…',
        'New Tag…',
        'Cherry-Pick…',
        'Revert…',
        'Copy SHA',
        'Copy Summary',
      ]);
    });

    it('opens the same menu from the inspector button', async () => {
      const user = userEvent.setup();
      seed({ selectedOid: 'c3' });
      render(<GitGraphView repoPath={REPO} />);
      await user.click(screen.getByRole('button', { name: 'More actions' }));
      expect(menuItem('Revert…')).toBeInTheDocument();
    });

    it('states why writes are unavailable while a cherry-pick is open', async () => {
      const user = userEvent.setup();
      seed({}, mainRefs({ operation: 'cherry-pick' }));
      render(<GitGraphView repoPath={REPO} />);
      await user.pointer({ keys: '[MouseRight]', target: rowOf(3) });
      expect(menuItem('Revert…')).toHaveAttribute('aria-disabled', 'true');
      expect(within(menuItem('Revert…')).getByText('Finish the cherry-pick first')).toBeVisible();
      await user.click(menuItem('Revert…'));
      expect(useStore.getState().graphRevert).not.toHaveBeenCalled();
    });

    it('disables Check Out and Delete on the current branch', async () => {
      const user = userEvent.setup();
      render(<GitGraphView repoPath={REPO} />);
      await user.pointer({ keys: '[MouseRight]', target: within(rowOf(0)).getByText('main') });
      expect(menuItem('Check Out')).toHaveAttribute('aria-disabled', 'true');
      expect(menuItem('Delete…')).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getAllByText('You are on this branch').length).toBe(2);
    });
  });

  describe('operations', () => {
    it('reverts only after a sheet that names the real commit and branch', async () => {
      const user = userEvent.setup();
      render(<GitGraphView repoPath={REPO} />);
      await user.pointer({ keys: '[MouseRight]', target: rowOf(3) });
      await user.click(menuItem('Revert…'));
      const sheet = screen.getByRole('dialog', { name: 'Revert “Commit number 3”?' });
      expect(sheet).toHaveTextContent(
        'Revert “Commit number 3” on main. This creates one new commit on main.'
      );
      expect(useStore.getState().graphRevert).not.toHaveBeenCalled();
      await user.click(within(sheet).getByRole('button', { name: 'Revert' }));
      expect(useStore.getState().graphRevert).toHaveBeenCalledWith(REPO, 'c3');
    });

    it('does nothing when the sheet is cancelled', async () => {
      const user = userEvent.setup();
      render(<GitGraphView repoPath={REPO} />);
      await user.pointer({ keys: '[MouseRight]', target: rowOf(3) });
      await user.click(menuItem('Cherry-Pick…'));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(useStore.getState().graphCherryPick).not.toHaveBeenCalled();
    });

    it('turns a conflicting cherry-pick into a toast that opens the merge panel', async () => {
      const user = userEvent.setup();
      useStore.setState({
        graphCherryPick: vi.fn(async () => ({
          ok: true as const,
          pick: { clean: false, conflicts: ['a.ts', 'b.ts'], newOid: null },
        })),
      } as never);
      render(<GitGraphView repoPath={REPO} />);
      await user.pointer({ keys: '[MouseRight]', target: rowOf(3) });
      await user.click(menuItem('Cherry-Pick…'));
      await user.click(screen.getByRole('button', { name: 'Cherry-Pick' }));
      const [toast] = useStore.getState().toasts;
      expect(toast.message).toBe('Cherry-pick stopped on 2 conflicts');
      toast.action?.run();
      expect(openMergeTabOrToast).toHaveBeenCalledWith(REPO, 'a.ts');
    });

    it('creates a branch from the popover and checks it out', async () => {
      const user = userEvent.setup();
      render(<GitGraphView repoPath={REPO} />);
      await user.pointer({ keys: '[MouseRight]', target: rowOf(3) });
      await user.click(menuItem('New Branch…'));
      await user.type(screen.getByRole('textbox', { name: 'Name' }), 'topic{Enter}');
      expect(useStore.getState().graphCreateBranch).toHaveBeenCalledWith(REPO, 'topic', 'c3', true);
    });

    it('asks a second time before deleting an unmerged branch, and counts the commits', async () => {
      const user = userEvent.setup();
      const commits = [
        makeCommit(0, ['c1']),
        makeCommit(5, ['c6']),
        makeCommit(6, ['c1']),
        makeCommit(1, []),
      ];
      const refs = makeRefs([
        makeRef('main', 'local', 'c0', true),
        makeRef('feature', 'local', 'c5'),
      ]);
      seed({}, refs, commits);
      const graphDeleteBranch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, code: 'not_merged', message: 'Not merged.' })
        .mockResolvedValueOnce({ ok: true });
      useStore.setState({ graphDeleteBranch } as never);
      render(<GitGraphView repoPath={REPO} />);
      await user.pointer({ keys: '[MouseRight]', target: within(rowOf(5)).getByText('feature') });
      await user.click(menuItem('Delete…'));
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      expect(graphDeleteBranch).toHaveBeenLastCalledWith(REPO, 'feature', false);
      const second = await screen.findByRole('dialog', {
        name: 'Delete Unmerged Branch “feature”?',
      });
      expect(second).toHaveTextContent('2 commits');
      expect(useStore.getState().toasts).toEqual([]);
      await user.click(within(second).getByRole('button', { name: 'Delete Anyway' }));
      expect(graphDeleteBranch).toHaveBeenLastCalledWith(REPO, 'feature', true);
    });

    it('selects and pulses the new HEAD row after a checkout', async () => {
      const user = userEvent.setup();
      useStore.setState({
        graphCheckout: vi.fn(async () => {
          const graph = useStore.getState().graphs[REPO];
          useStore.setState({
            graphs: { [REPO]: { ...graph, refs: { ...graph.refs!, headOid: 'c2' } } },
          });
          return { ok: true as const };
        }),
      } as never);
      render(<GitGraphView repoPath={REPO} />);
      await user.pointer({ keys: '[MouseRight]', target: within(rowOf(2)).getByText('feature') });
      await user.click(menuItem('Check Out'));
      expect(useStore.getState().graphCheckout).toHaveBeenCalledWith(REPO, 'refs/heads/feature');
      expect(await screen.findByRole('option', { name: /Commit number 2,/ })).toHaveAttribute(
        'data-pulse',
        'true'
      );
      expect(useStore.getState().graphs[REPO].selectedOid).toBe('c2');
      expect(useStore.getState().toasts[0].message).toBe('Checked out feature');
    });

    it('shows a refusal with its mapped title and sentence', async () => {
      const user = userEvent.setup();
      useStore.setState({
        graphCheckout: vi.fn(async () => ({
          ok: false as const,
          code: 'would_overwrite',
          message: 'Local changes to a.ts would be overwritten.',
        })),
      } as never);
      render(<GitGraphView repoPath={REPO} />);
      await user.pointer({ keys: '[MouseRight]', target: within(rowOf(2)).getByText('feature') });
      await user.click(menuItem('Check Out'));
      expect(useStore.getState().toasts[0]).toMatchObject({
        message: 'Your changes are in the way. Local changes to a.ts would be overwritten.',
        variant: 'error',
      });
    });
  });

  describe('focus and keyboard menus', () => {
    it('returns focus to the list after a keyboard-opened menu leads to a cancelled sheet', async () => {
      const user = userEvent.setup();
      seed({ selectedOid: 'c3' });
      render(<GitGraphView repoPath={REPO} />);
      const list = screen.getByRole('listbox');
      list.focus();
      await user.keyboard('{ContextMenu}');
      expect(screen.getByRole('menu', { name: 'Commit actions' })).toBeInTheDocument();
      await user.click(menuItem('Revert…'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(list).toHaveFocus();
    });

    it("reaches a branch pill's actions from the keyboard-opened menu", async () => {
      const user = userEvent.setup();
      seed({ selectedOid: 'c2' });
      render(<GitGraphView repoPath={REPO} />);
      screen.getByRole('listbox').focus();
      await user.keyboard('{ContextMenu}');
      expect(menuItem('Rename…')).toBeInTheDocument();
      expect(menuItem('Delete…')).toBeInTheDocument();
    });

    it('returns focus to the inspector button after cancelling from its menu', async () => {
      const user = userEvent.setup();
      seed({ selectedOid: 'c3' });
      render(<GitGraphView repoPath={REPO} />);
      const button = screen.getByRole('button', { name: 'More actions' });
      await user.click(button);
      await user.click(menuItem('Cherry-Pick…'));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(button).toHaveFocus();
    });

    it('announces the running operation', () => {
      seed({ busy: 'Checking out' });
      render(<GitGraphView repoPath={REPO} />);
      expect(screen.getAllByRole('status').some((s) => s.textContent === 'Checking out…')).toBe(
        true
      );
    });

    it('labels the branch filter as a group of choices', async () => {
      const user = userEvent.setup();
      render(<GitGraphView repoPath={REPO} />);
      await user.click(screen.getByRole('button', { name: /Branches:/ }));
      expect(screen.getByRole('menu', { name: 'Branch filter' })).toBeInTheDocument();
      expect(screen.getByRole('menuitemradio', { name: 'All Branches' })).toBeChecked();
      expect(screen.getByRole('menuitemradio', { name: 'Current Branch' })).not.toBeChecked();
    });
  });

  describe('banners', () => {
    it('offers branches to check out while HEAD is detached', async () => {
      const user = userEvent.setup();
      seed({}, mainRefs({ headDetached: true, headOid: 'c3' }));
      render(<GitGraphView repoPath={REPO} />);
      await user.click(screen.getByRole('button', { name: 'Check Out a Branch…' }));
      await user.click(menuItem('feature'));
      expect(useStore.getState().graphCheckout).toHaveBeenCalledWith(REPO, 'refs/heads/feature');
    });

    it('opens the first conflict of a running operation in the merge panel', async () => {
      const user = userEvent.setup();
      seed({}, mainRefs({ operation: 'cherry-pick' }));
      useStore.setState({
        refreshMergeState: vi.fn(async () => ({
          conflicts: [{ path: 'src/a.ts', kind: 'both-modified' }],
        })),
      } as never);
      render(<GitGraphView repoPath={REPO} />);
      await user.click(screen.getByRole('button', { name: 'Open Merge Panel' }));
      expect(openMergeTabOrToast).toHaveBeenCalledWith(REPO, 'src/a.ts');
    });

    it('says so when there is no conflict left to open', async () => {
      const user = userEvent.setup();
      seed({}, mainRefs({ operation: 'cherry-pick' }));
      render(<GitGraphView repoPath={REPO} />);
      await user.click(screen.getByRole('button', { name: 'Open Merge Panel' }));
      expect(useStore.getState().toasts[0].message).toMatch(/No conflicts to resolve/);
    });
  });

  describe('staying current', () => {
    it('reloads the first page when the window returns and the refs moved', async () => {
      useStore.setState({ refreshRefs: vi.fn(async () => true) } as never);
      render(<GitGraphView repoPath={REPO} />);
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });
      expect(useStore.getState().refreshRefs).toHaveBeenCalledWith(REPO);
      expect(useStore.getState().loadFirstPage).toHaveBeenCalledWith(REPO);
    });

    it('leaves the list alone when nothing moved', async () => {
      render(<GitGraphView repoPath={REPO} />);
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });
      expect(useStore.getState().loadFirstPage).not.toHaveBeenCalled();
    });

    it('shows a spinner on the row an operation works on', async () => {
      const user = userEvent.setup();
      let finish: () => void = () => undefined;
      useStore.setState({
        graphRevert: vi.fn(
          () =>
            new Promise((resolve) => {
              useStore.setState({
                graphs: { [REPO]: { ...useStore.getState().graphs[REPO], busy: 'Reverting' } },
              });
              finish = () => resolve({ ok: true });
            })
        ),
      } as never);
      render(<GitGraphView repoPath={REPO} />);
      await user.pointer({ keys: '[MouseRight]', target: rowOf(3) });
      await user.click(menuItem('Revert…'));
      await user.click(screen.getByRole('button', { name: 'Revert' }));
      expect(within(rowOf(3)).getByRole('progressbar')).toBeInTheDocument();
      await act(async () => finish());
      expect(within(rowOf(3)).queryByRole('progressbar')).toBeNull();
    });
  });
});
