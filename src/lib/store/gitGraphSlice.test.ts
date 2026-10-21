import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand';
import { layoutGraph } from '../git/graphLayout';
import type { CommitDetail, GitRefs, GraphCommit, GraphPage, PickResult } from '../tauri/gitGraph';

const m = vi.hoisted(() => ({
  gitGraphLog: vi.fn(),
  gitRefs: vi.fn(),
  gitCommitDetail: vi.fn(),
  gitCheckout: vi.fn(),
  gitBranchCreate: vi.fn(),
  gitBranchRename: vi.fn(),
  gitBranchDelete: vi.fn(),
  gitTagCreate: vi.fn(),
  gitTagDelete: vi.fn(),
  gitCherryPick: vi.fn(),
  gitRevert: vi.fn(),
}));

vi.mock('../tauri/gitGraph', async (importActual) => ({
  ...(await importActual<typeof import('../tauri/gitGraph')>()),
  ...m,
}));

import {
  EMPTY_GRAPH_COMMITS,
  EMPTY_GRAPH_ROWS,
  GRAPH_PAGE_SIZE,
  createGitGraphSlice,
  resolveBranchFilterTip,
  selectGraph,
  selectGraphDetail,
  selectGraphRows,
  type GitGraphSlice,
} from './gitGraphSlice';

const REPO = '/work/repo';
const refreshRepoStatus = vi.fn();
const loadBranches = vi.fn();

function createTestStore() {
  return createStore<
    GitGraphSlice & {
      refreshRepoStatus: typeof refreshRepoStatus;
      loadBranches: typeof loadBranches;
    }
  >()((...a) => ({ ...createGitGraphSlice(...a), refreshRepoStatus, loadBranches }));
}
type TestStore = ReturnType<typeof createTestStore>;

function commit(oid: string, parents: string[] = []): GraphCommit {
  return {
    oid,
    parents,
    summary: `commit ${oid}`,
    authorName: 'Sam',
    authorEmail: 's@example.org',
    authorTime: 1,
    committerTime: 1,
  };
}

function refsAt(headOid: string | null, extra: Partial<GitRefs> = {}): GitRefs {
  return { refs: [], headDetached: false, headOid, operation: 'none', ...extra };
}

const CHAIN = [commit('a', ['b']), commit('b', ['c']), commit('c')];

function page(commits: GraphCommit[], hasMore = false): GraphPage {
  return { commits, hasMore };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const graphOf = (s: TestStore) => s.getState().graphs[REPO];

beforeEach(() => {
  vi.clearAllMocks();
  m.gitRefs.mockResolvedValue(refsAt('a'));
  m.gitGraphLog.mockResolvedValue(page(CHAIN));
  for (const op of [m.gitCheckout, m.gitBranchCreate, m.gitBranchRename, m.gitBranchDelete]) {
    op.mockResolvedValue(undefined);
  }
  for (const op of [m.gitTagCreate, m.gitTagDelete]) op.mockResolvedValue(undefined);
  refreshRepoStatus.mockResolvedValue(undefined);
  loadBranches.mockResolvedValue(undefined);
});

describe('opening and paging', () => {
  it('opens a graph: refs and first page are loaded and laid out', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    const g = graphOf(store);
    expect(m.gitGraphLog).toHaveBeenCalledWith(REPO, 0, GRAPH_PAGE_SIZE);
    expect(g.commits).toEqual(CHAIN);
    expect(g.rows).toEqual(layoutGraph(CHAIN, 'a').rows);
    expect(g.refs?.headOid).toBe('a');
    expect(g.hasMore).toBe(false);
    expect(g.loading).toBe(false);
  });

  it('does not reload an already open graph', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    await store.getState().openGraph(REPO);
    expect(m.gitGraphLog).toHaveBeenCalledTimes(1);
  });

  it('keeps graphs of different repositories apart', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    await store.getState().openGraph('/other');
    expect(Object.keys(store.getState().graphs).sort()).toEqual(['/other', REPO]);
  });

  it('loadMore appends the next page and lays it out as one call over both would', async () => {
    const store = createTestStore();
    m.gitGraphLog.mockResolvedValueOnce(page(CHAIN.slice(0, 2), true));
    await store.getState().openGraph(REPO);
    m.gitGraphLog.mockResolvedValueOnce(page(CHAIN.slice(2)));
    await store.getState().loadMore(REPO);
    const g = graphOf(store);
    expect(m.gitGraphLog).toHaveBeenLastCalledWith(REPO, 2, GRAPH_PAGE_SIZE);
    expect(g.commits).toEqual(CHAIN);
    expect(g.rows).toEqual(layoutGraph(CHAIN, 'a').rows);
    expect(g.hasMore).toBe(false);
  });

  it('does not load the same page twice while one is running', async () => {
    const store = createTestStore();
    m.gitGraphLog.mockResolvedValueOnce(page(CHAIN.slice(0, 2), true));
    await store.getState().openGraph(REPO);
    const slow = deferred<GraphPage>();
    m.gitGraphLog.mockReturnValueOnce(slow.promise);
    const first = store.getState().loadMore(REPO);
    await store.getState().loadMore(REPO);
    expect(m.gitGraphLog).toHaveBeenCalledTimes(2);
    slow.resolve(page(CHAIN.slice(2)));
    await first;
    expect(graphOf(store).commits).toHaveLength(3);
  });

  it('reloads from the start instead of appending when the refs changed since the first page', async () => {
    const store = createTestStore();
    m.gitGraphLog.mockResolvedValueOnce(page(CHAIN.slice(0, 2), true));
    await store.getState().openGraph(REPO);
    m.gitRefs.mockResolvedValue(refsAt('n'));
    m.gitGraphLog.mockResolvedValueOnce(page(CHAIN.slice(2)));
    m.gitGraphLog.mockResolvedValueOnce(page([commit('n', ['a']), ...CHAIN]));
    await store.getState().loadMore(REPO);
    expect(m.gitGraphLog).toHaveBeenLastCalledWith(REPO, 0, GRAPH_PAGE_SIZE);
    expect(graphOf(store).commits.map((c) => c.oid)).toEqual(['n', 'a', 'b', 'c']);
    expect(graphOf(store).refs?.headOid).toBe('n');
  });

  it('never lays out an oid twice when a page repeats a commit it already holds', async () => {
    const store = createTestStore();
    m.gitGraphLog.mockResolvedValueOnce(page(CHAIN.slice(0, 2), true));
    await store.getState().openGraph(REPO);
    m.gitGraphLog.mockResolvedValueOnce(page(CHAIN.slice(1)));
    await store.getState().loadMore(REPO);
    const g = graphOf(store);
    expect(g.commits.map((c) => c.oid)).toEqual(['a', 'b', 'c']);
    expect(g.rows).toEqual(layoutGraph(CHAIN, 'a').rows);
  });

  it('does nothing when there is no more history', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    await store.getState().loadMore(REPO);
    expect(m.gitGraphLog).toHaveBeenCalledTimes(1);
  });

  it('shows an unborn repository as empty, not as an error', async () => {
    m.gitRefs.mockResolvedValue(refsAt(null));
    m.gitGraphLog.mockResolvedValue(page([]));
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    expect(graphOf(store).rows).toEqual([]);
    expect(graphOf(store).lastError).toBeNull();
  });

  it('turns a failed load into a sentence and ends loading', async () => {
    m.gitGraphLog.mockRejectedValue(new Error('fatal: raw git text'));
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    expect(graphOf(store).loading).toBe(false);
    expect(graphOf(store).lastError).toBe('Could not read the commit history.');
  });
});

describe('late results', () => {
  it('drops a slow first page that arrives after a newer reload', async () => {
    const store = createTestStore();
    const slow = deferred<GraphPage>();
    m.gitGraphLog.mockReturnValueOnce(slow.promise);
    const stale = store.getState().loadFirstPage(REPO);
    m.gitGraphLog.mockResolvedValueOnce(page([commit('new')]));
    m.gitRefs.mockResolvedValue(refsAt('new'));
    await store.getState().loadFirstPage(REPO);
    slow.resolve(page(CHAIN));
    await stale;
    expect(graphOf(store).commits.map((c) => c.oid)).toEqual(['new']);
    expect(graphOf(store).loading).toBe(false);
  });

  it('drops a slow next page that arrives after a reload', async () => {
    const store = createTestStore();
    m.gitGraphLog.mockResolvedValueOnce(page(CHAIN.slice(0, 2), true));
    await store.getState().openGraph(REPO);
    const slow = deferred<GraphPage>();
    m.gitGraphLog.mockReturnValueOnce(slow.promise);
    const stale = store.getState().loadMore(REPO);
    m.gitGraphLog.mockResolvedValueOnce(page([commit('only')]));
    await store.getState().loadFirstPage(REPO);
    slow.resolve(page(CHAIN.slice(2)));
    await stale;
    expect(graphOf(store).commits.map((c) => c.oid)).toEqual(['only']);
  });

  it('drops results for a graph that was closed meanwhile', async () => {
    const store = createTestStore();
    const slow = deferred<GraphPage>();
    m.gitGraphLog.mockReturnValueOnce(slow.promise);
    const pending = store.getState().openGraph(REPO);
    store.getState().closeGraph(REPO);
    slow.resolve(page(CHAIN));
    await pending;
    expect(store.getState().graphs[REPO]).toBeUndefined();
  });

  it('does not let a closed and reopened graph take the old answer', async () => {
    const store = createTestStore();
    const slow = deferred<GraphPage>();
    m.gitGraphLog.mockReturnValueOnce(slow.promise);
    const stale = store.getState().openGraph(REPO);
    store.getState().closeGraph(REPO);
    m.gitGraphLog.mockResolvedValueOnce(page([commit('fresh')]));
    await store.getState().openGraph(REPO);
    slow.resolve(page(CHAIN));
    await stale;
    expect(graphOf(store).commits.map((c) => c.oid)).toEqual(['fresh']);
  });
});

describe('refreshRefs', () => {
  it('reports no change for equal refs delivered as fresh objects, and keeps the reference', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    const before = graphOf(store).refs;
    m.gitRefs.mockResolvedValueOnce(refsAt('a'));
    await expect(store.getState().refreshRefs(REPO)).resolves.toBe(false);
    expect(graphOf(store).refs).toBe(before);
  });

  it('reports a change and stores the new refs', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    m.gitRefs.mockResolvedValueOnce(refsAt('b', { headDetached: true }));
    await expect(store.getState().refreshRefs(REPO)).resolves.toBe(true);
    expect(graphOf(store).refs?.headOid).toBe('b');
  });

  it('is false for a graph that is not open', async () => {
    const store = createTestStore();
    await expect(store.getState().refreshRefs(REPO)).resolves.toBe(false);
  });
});

describe('selection, filters and details', () => {
  it('keeps selection, filter text and branch filter per repository', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    store.getState().selectGraphCommit(REPO, 'b');
    store.getState().setGraphFilterText(REPO, 'fix');
    store.getState().setGraphBranchFilter(REPO, 'current');
    expect(graphOf(store)).toMatchObject({
      selectedOid: 'b',
      filterText: 'fix',
      branchFilter: 'current',
    });
    store.getState().selectGraphCommit(REPO, null);
    expect(graphOf(store).selectedOid).toBeNull();
  });

  it('loads a detail once per commit and parent index', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    const detail = { oid: 'a', files: [] } as unknown as CommitDetail;
    m.gitCommitDetail.mockResolvedValue(detail);
    expect(await store.getState().loadGraphDetail(REPO, 'a')).toBe(detail);
    await store.getState().loadGraphDetail(REPO, 'a');
    expect(m.gitCommitDetail).toHaveBeenCalledTimes(1);
    expect(m.gitCommitDetail).toHaveBeenCalledWith(REPO, 'a', 0);
    await store.getState().loadGraphDetail(REPO, 'a', 1);
    expect(m.gitCommitDetail).toHaveBeenCalledTimes(2);
    expect(selectGraphDetail(store.getState(), REPO, 'a', 0)).toBe(detail);
    expect(selectGraphDetail(store.getState(), REPO, 'a', 2)).toBeUndefined();
  });

  it('answers null when the detail cannot be read', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    m.gitCommitDetail.mockRejectedValue(new Error('boom'));
    expect(await store.getState().loadGraphDetail(REPO, 'a')).toBeNull();
  });
});

describe('operations', () => {
  const pickClean: PickResult = { clean: true, conflicts: [], newOid: 'n' };

  const OPERATIONS: Array<
    [string, (s: TestStore) => Promise<unknown>, ReturnType<typeof vi.fn>, unknown[]]
  > = [
    [
      'checkout',
      (s) => s.getState().graphCheckout(REPO, 'refs/heads/dev'),
      m.gitCheckout,
      [REPO, 'refs/heads/dev'],
    ],
    [
      'createBranch',
      (s) => s.getState().graphCreateBranch(REPO, 'feat', 'a', true),
      m.gitBranchCreate,
      [REPO, 'feat', 'a', true],
    ],
    [
      'renameBranch',
      (s) => s.getState().graphRenameBranch(REPO, 'old', 'new'),
      m.gitBranchRename,
      [REPO, 'old', 'new'],
    ],
    [
      'deleteBranch',
      (s) => s.getState().graphDeleteBranch(REPO, 'feat', true),
      m.gitBranchDelete,
      [REPO, 'feat', true],
    ],
    [
      'createTag',
      (s) => s.getState().graphCreateTag(REPO, 'v1', 'a', 'msg'),
      m.gitTagCreate,
      [REPO, 'v1', 'a', 'msg'],
    ],
    ['deleteTag', (s) => s.getState().graphDeleteTag(REPO, 'v1'), m.gitTagDelete, [REPO, 'v1']],
  ];

  it.each(OPERATIONS)(
    '%s calls its command, then reloads graph, status and branches',
    async (_n, run, command, args) => {
      const store = createTestStore();
      await store.getState().openGraph(REPO);
      m.gitGraphLog.mockClear();
      const result = await run(store);
      expect(result).toEqual({ ok: true });
      expect(command).toHaveBeenCalledWith(...args);
      expect(m.gitGraphLog).toHaveBeenCalledWith(REPO, 0, GRAPH_PAGE_SIZE);
      expect(refreshRepoStatus).toHaveBeenCalledWith(REPO);
      expect(loadBranches).toHaveBeenCalledWith(REPO);
      expect(graphOf(store).busy).toBeNull();
    }
  );

  it('shows the running operation as busy while it runs', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    const slow = deferred<void>();
    m.gitCheckout.mockReturnValueOnce(slow.promise);
    const running = store.getState().graphCheckout(REPO, 'refs/heads/dev');
    expect(graphOf(store).busy).toBe('Checking out');
    slow.resolve();
    await running;
    expect(graphOf(store).busy).toBeNull();
  });

  it('refuses a second operation while one runs, without calling git', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    const slow = deferred<void>();
    m.gitCheckout.mockReturnValueOnce(slow.promise);
    const running = store.getState().graphCheckout(REPO, 'refs/heads/dev');
    const second = await store.getState().graphDeleteBranch(REPO, 'x', false);
    expect(second).toMatchObject({ ok: false, code: 'busy' });
    expect(m.gitBranchDelete).not.toHaveBeenCalled();
    slow.resolve();
    await running;
  });

  it('returns the refusal as code and sentence, clears busy and still reloads refs and the first page', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    m.gitGraphLog.mockClear();
    m.gitRefs.mockResolvedValue(refsAt('a', { operation: 'cherry-pick' }));
    m.gitBranchDelete.mockRejectedValueOnce('not_merged: Two commits exist only on this branch.');
    const result = await store.getState().graphDeleteBranch(REPO, 'feat', false);
    expect(result).toEqual({
      ok: false,
      code: 'not_merged',
      message: 'Two commits exist only on this branch.',
    });
    expect(graphOf(store).busy).toBeNull();
    expect(m.gitGraphLog).toHaveBeenCalledWith(REPO, 0, GRAPH_PAGE_SIZE);
    expect(graphOf(store).refs?.operation).toBe('cherry-pick');
    expect(refreshRepoStatus).toHaveBeenCalledWith(REPO);
  });

  it('keeps the refusal as lastError even though the reload cleared the load error', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    m.gitCheckout.mockRejectedValueOnce('would_overwrite: a.ts would be lost.');
    await store.getState().graphCheckout(REPO, 'x');
    expect(graphOf(store).lastError).toBe('a.ts would be lost.');
  });

  it('clears the previous error when the next operation succeeds', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    m.gitCheckout.mockRejectedValueOnce('would_overwrite: a.ts would be lost.');
    await store.getState().graphCheckout(REPO, 'x');
    await store.getState().graphCheckout(REPO, 'y');
    expect(graphOf(store).lastError).toBeNull();
  });

  it.each([
    ['cherry-pick', m.gitCherryPick, (s: TestStore) => s.getState().graphCherryPick(REPO, 'b')],
    ['revert', m.gitRevert, (s: TestStore) => s.getState().graphRevert(REPO, 'b')],
  ])('%s returns the pick result', async (_n, command, run) => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    command.mockResolvedValueOnce(pickClean);
    expect(await run(store)).toEqual({ ok: true, pick: pickClean });
    expect(command).toHaveBeenCalledWith(REPO, 'b');
  });

  it('a conflicting pick is a success with conflicts, and the graph still reloads', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    m.gitGraphLog.mockClear();
    const conflicted: PickResult = { clean: false, conflicts: ['a.ts', 'b.ts'], newOid: null };
    m.gitCherryPick.mockResolvedValueOnce(conflicted);
    m.gitRefs.mockResolvedValue(refsAt('a', { operation: 'cherry-pick' }));
    const result = await store.getState().graphCherryPick(REPO, 'b');
    expect(result).toEqual({ ok: true, pick: conflicted });
    expect(m.gitGraphLog).toHaveBeenCalled();
    expect(graphOf(store).refs?.operation).toBe('cherry-pick');
  });

  it('still reports success when only the Source Control refresh fails', async () => {
    const store = createTestStore();
    await store.getState().openGraph(REPO);
    refreshRepoStatus.mockRejectedValueOnce(new Error('status failed'));
    await expect(store.getState().graphCheckout(REPO, 'x')).resolves.toEqual({ ok: true });
  });
});

describe('selectors and helpers', () => {
  it('return the same empty reference for a graph that is not open', () => {
    const state = createTestStore().getState();
    expect(selectGraph(state, REPO)).toBeUndefined();
    expect(selectGraphRows(state, REPO)).toBe(EMPTY_GRAPH_ROWS);
    expect(selectGraphRows(state, REPO)).toBe(selectGraphRows(state, REPO));
    expect(EMPTY_GRAPH_COMMITS).toEqual([]);
  });

  it('resolveBranchFilterTip: none, current branch, detached HEAD, a named ref', () => {
    const refs = refsAt('h', {
      refs: [
        {
          name: 'refs/heads/dev',
          shorthand: 'dev',
          kind: 'local',
          target: 'd',
          upstream: null,
          ahead: null,
          behind: null,
          isCurrent: false,
        },
      ],
    });
    expect(resolveBranchFilterTip(null, refs)).toBeNull();
    expect(resolveBranchFilterTip('current', refs)).toBe('h');
    expect(resolveBranchFilterTip('refs/heads/dev', refs)).toBe('d');
    expect(resolveBranchFilterTip('refs/heads/gone', refs)).toBeNull();
    expect(resolveBranchFilterTip('current', null)).toBeNull();
    expect(resolveBranchFilterTip('current', refsAt(null))).toBeNull();
  });
});
