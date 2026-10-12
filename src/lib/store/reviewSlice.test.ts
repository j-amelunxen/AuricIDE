import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand';

const mockStatus = vi.fn();
const mockDiff = vi.fn();
const mockRefFiles = vi.fn();
const mockRefDiff = vi.fn();

vi.mock('../tauri/git', () => ({
  getGitStatus: (repoPath: string) => mockStatus(repoPath),
  getGitDiff: (repoPath: string, filePath: string, side?: string) =>
    mockDiff(repoPath, filePath, side),
  getGitDiffRefFiles: (repoPath: string, ref: string) => mockRefFiles(repoPath, ref),
  getGitDiffFileRef: (repoPath: string, ref: string, filePath: string) =>
    mockRefDiff(repoPath, ref, filePath),
}));

import { patchHash, viewedMarksKey } from '../git/review/reviewSession';
import {
  createReviewSlice,
  selectReviewFiles,
  selectReviewSession,
  selectViewedMarks,
  type ReviewSlice,
} from './reviewSlice';

function createTestStore() {
  return createStore<ReviewSlice>()((...a) => ({ ...createReviewSlice(...a) }));
}

function patchFor(path: string, added: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,1 +1,2 @@',
    ' keep',
    `+${added}`,
    '',
  ].join('\n');
}

const REPO = '/work/repo';
const WT_KEY = viewedMarksKey({ kind: 'worktree', repoPath: REPO });

async function settled(store: ReturnType<typeof createTestStore>, tabId: string) {
  await vi.waitFor(() => {
    expect(store.getState().reviewSessions[tabId]?.loading).toBe(false);
  });
}

describe('reviewSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts empty, and selectors for unknown tabs and repos return stable empties', () => {
    const state = createTestStore().getState();
    expect(selectReviewSession(state, 'review:/x:worktree')).toBeUndefined();
    expect(selectReviewFiles(state, 'review:/x:worktree')).toEqual([]);
    expect(selectReviewFiles(state, 'a')).toBe(selectReviewFiles(state, 'b'));
    expect(selectViewedMarks(state, '/x')).toEqual({});
    expect(selectViewedMarks(state, '/x')).toBe(selectViewedMarks(state, '/y'));
  });

  it('opens a worktree session: status + combined diff per file, flagged and risk-ordered', async () => {
    mockStatus.mockResolvedValue([
      { path: 'src/plain.ts', status: 'modified', staged: null, unstaged: 'modified' },
      { path: 'src/escape.ts', status: 'modified', staged: 'modified', unstaged: null },
      { path: 'new.ts', status: 'untracked', staged: null, unstaged: 'untracked' },
      { path: 'ignored.log', status: 'ignored', staged: null, unstaged: null },
      { path: 'clash.ts', status: 'conflicted', staged: null, unstaged: 'conflicted' },
    ]);
    mockDiff.mockImplementation(async (_repo: string, path: string) =>
      path === 'src/escape.ts' ? patchFor(path, 'const x = y as any;') : patchFor(path, 'ok')
    );
    const store = createTestStore();

    const tabId = store.getState().openReviewSession({ kind: 'worktree', repoPath: REPO });
    expect(tabId).toBe('review:/work/repo:worktree');
    expect(store.getState().reviewSessions[tabId].loading).toBe(true);
    await settled(store, tabId);

    const files = selectReviewFiles(store.getState(), tabId);
    expect(files.map((f) => f.path)).toEqual([
      'src/escape.ts',
      'clash.ts',
      'new.ts',
      'src/plain.ts',
    ]);
    expect(files[0].flags.map((f) => f.kind)).toEqual(['type-escape']);
    expect(files[0].hash).toBe(patchHash(files[0].patch));
    expect(files.find((f) => f.path === 'new.ts')?.status).toBe('untracked');
    // A conflicted file belongs to the merge panel; its diff is not read here.
    expect(files.find((f) => f.path === 'clash.ts')).toMatchObject({
      status: 'conflicted',
      patch: '',
    });
    expect(mockDiff).not.toHaveBeenCalledWith(REPO, 'clash.ts', undefined);
    expect(mockDiff).toHaveBeenCalledWith(REPO, 'src/plain.ts', undefined);
    expect(store.getState().reviewSessions[tabId].error).toBeNull();
  });

  it('opens a ref session through the existing ref diff wrappers', async () => {
    mockRefFiles.mockResolvedValue([
      { path: 'a.ts', status: 'added' },
      { path: 'b.ts', status: 'deleted' },
    ]);
    mockRefDiff.mockImplementation(async (_r: string, _ref: string, path: string) =>
      patchFor(path, 'x')
    );
    const store = createTestStore();

    const tabId = store.getState().openReviewSession({ kind: 'ref', repoPath: REPO, ref: 'main' });
    await settled(store, tabId);

    expect(mockRefFiles).toHaveBeenCalledWith(REPO, 'main');
    expect(mockRefDiff).toHaveBeenCalledWith(REPO, 'main', 'a.ts');
    expect(selectReviewFiles(store.getState(), tabId).map((f) => [f.path, f.status])).toEqual([
      ['a.ts', 'added'],
      ['b.ts', 'deleted'],
    ]);
  });

  it('reads a ref session against its merge base, under the same tab id as the branch', async () => {
    mockRefFiles.mockResolvedValue([{ path: 'a.ts', status: 'modified' }]);
    mockRefDiff.mockResolvedValue(patchFor('a.ts', 'x'));
    const store = createTestStore();
    const base = { kind: 'merge-base' as const, oid: 'f'.repeat(40) };

    const tabId = store
      .getState()
      .openReviewSession({ kind: 'ref', repoPath: REPO, ref: 'main', base });
    await settled(store, tabId);

    expect(tabId).toBe(`review:${REPO}:ref=main`);
    expect(mockRefFiles).toHaveBeenCalledWith(REPO, base.oid);
    expect(mockRefDiff).toHaveBeenCalledWith(REPO, base.oid, 'a.ts');
  });

  it('a re-open takes the newer source of an open session', async () => {
    mockRefFiles.mockResolvedValue([]);
    const store = createTestStore();
    const tabId = store.getState().openReviewSession({ kind: 'ref', repoPath: REPO, ref: 'main' });
    await settled(store, tabId);
    const base = { kind: 'tip' as const, reason: 'no common ancestor' };
    store.getState().openReviewSession({ kind: 'ref', repoPath: REPO, ref: 'main', base });
    expect(selectReviewSession(store.getState(), tabId)?.source).toMatchObject({ base });
  });

  it('keeps going when one file fails to load, and says so on that file', async () => {
    mockStatus.mockResolvedValue([
      { path: 'a.ts', status: 'modified', staged: null, unstaged: 'modified' },
      { path: 'b.ts', status: 'modified', staged: null, unstaged: 'modified' },
    ]);
    mockDiff.mockImplementation(async (_r: string, path: string) => {
      if (path === 'a.ts') throw new Error('Failed to read file');
      return patchFor(path, 'x');
    });
    const store = createTestStore();
    const tabId = store.getState().openReviewSession({ kind: 'worktree', repoPath: REPO });
    await settled(store, tabId);

    const files = selectReviewFiles(store.getState(), tabId);
    expect(files.find((f) => f.path === 'a.ts')?.loadError).toBe('Failed to read file');
    expect(files.find((f) => f.path === 'b.ts')?.patch).toContain('+x');
  });

  it('records a list failure as the session error and keeps the files it had', async () => {
    mockStatus.mockResolvedValueOnce([
      { path: 'a.ts', status: 'modified', staged: null, unstaged: 'modified' },
    ]);
    mockDiff.mockResolvedValue(patchFor('a.ts', 'x'));
    const store = createTestStore();
    const tabId = store.getState().openReviewSession({ kind: 'worktree', repoPath: REPO });
    await settled(store, tabId);

    mockStatus.mockRejectedValueOnce(new Error('not a repo'));
    await store.getState().refreshReviewSession(tabId);

    const session = store.getState().reviewSessions[tabId];
    expect(session.error).toBe('not a repo');
    expect(session.loading).toBe(false);
    expect(session.files.map((f) => f.path)).toEqual(['a.ts']);
  });

  it('reopening an open session refreshes it instead of starting a second one', async () => {
    mockStatus.mockResolvedValue([]);
    const store = createTestStore();
    const source = { kind: 'worktree', repoPath: REPO } as const;
    const first = store.getState().openReviewSession(source);
    await settled(store, first);
    const second = store.getState().openReviewSession(source);
    expect(second).toBe(first);
    expect(Object.keys(store.getState().reviewSessions)).toEqual([first]);
    await settled(store, first);
    expect(mockStatus).toHaveBeenCalledTimes(2);
  });

  it('drops a stale load that finishes after a newer one', async () => {
    let releaseSlow: (v: unknown) => void = () => {};
    mockStatus
      .mockImplementationOnce(() => new Promise((resolve) => (releaseSlow = resolve)))
      .mockResolvedValueOnce([
        { path: 'new.ts', status: 'modified', staged: null, unstaged: 'modified' },
      ]);
    mockDiff.mockResolvedValue(patchFor('new.ts', 'x'));
    const store = createTestStore();
    const tabId = store.getState().openReviewSession({ kind: 'worktree', repoPath: REPO });
    await store.getState().refreshReviewSession(tabId);
    releaseSlow([{ path: 'old.ts', status: 'modified', staged: null, unstaged: 'modified' }]);
    await new Promise((r) => setTimeout(r, 0));

    expect(selectReviewFiles(store.getState(), tabId).map((f) => f.path)).toEqual(['new.ts']);
    expect(store.getState().reviewSessions[tabId].loading).toBe(false);
  });

  it('closing a session drops it, and a load finishing afterwards does not bring it back', async () => {
    let release: (v: unknown) => void = () => {};
    mockStatus.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const store = createTestStore();
    const tabId = store.getState().openReviewSession({ kind: 'worktree', repoPath: REPO });
    store.getState().closeReviewSession(tabId);
    release([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getState().reviewSessions[tabId]).toBeUndefined();
  });

  it('toggles viewed against the hash of the patch on screen', async () => {
    mockStatus.mockResolvedValue([
      { path: 'a.ts', status: 'modified', staged: null, unstaged: 'modified' },
    ]);
    mockDiff.mockResolvedValueOnce(patchFor('a.ts', 'first'));
    const store = createTestStore();
    const tabId = store.getState().openReviewSession({ kind: 'worktree', repoPath: REPO });
    await settled(store, tabId);
    const hash = selectReviewFiles(store.getState(), tabId)[0].hash;

    store.getState().toggleViewed(tabId, 'a.ts');
    expect(selectViewedMarks(store.getState(), WT_KEY)).toEqual({ 'a.ts': hash });

    store.getState().toggleViewed(tabId, 'a.ts');
    expect(selectViewedMarks(store.getState(), WT_KEY)).toEqual({});
  });

  it('a changed file keeps its old mark, and toggling re-marks the new version', async () => {
    mockStatus.mockResolvedValue([
      { path: 'a.ts', status: 'modified', staged: null, unstaged: 'modified' },
    ]);
    mockDiff.mockResolvedValueOnce(patchFor('a.ts', 'first'));
    const store = createTestStore();
    const tabId = store.getState().openReviewSession({ kind: 'worktree', repoPath: REPO });
    await settled(store, tabId);
    store.getState().toggleViewed(tabId, 'a.ts');
    const firstHash = selectViewedMarks(store.getState(), WT_KEY)['a.ts'];

    mockDiff.mockResolvedValueOnce(patchFor('a.ts', 'second'));
    await store.getState().refreshReviewSession(tabId);
    const newHash = selectReviewFiles(store.getState(), tabId)[0].hash;
    expect(newHash).not.toBe(firstHash);
    expect(selectViewedMarks(store.getState(), WT_KEY)['a.ts']).toBe(firstHash);

    store.getState().toggleViewed(tabId, 'a.ts');
    expect(selectViewedMarks(store.getState(), WT_KEY)['a.ts']).toBe(newHash);
  });

  it('keeps a working-tree mark apart from a mark for the same file against a ref', async () => {
    mockStatus.mockResolvedValue([
      { path: 'a.ts', status: 'modified', staged: null, unstaged: 'modified' },
    ]);
    mockDiff.mockResolvedValue(patchFor('a.ts', 'x'));
    mockRefFiles.mockResolvedValue([{ path: 'a.ts', status: 'modified' }]);
    mockRefDiff.mockResolvedValue(patchFor('a.ts', 'x'));
    const store = createTestStore();
    const wt = store.getState().openReviewSession({ kind: 'worktree', repoPath: REPO });
    const ref = store.getState().openReviewSession({ kind: 'ref', repoPath: REPO, ref: 'main' });
    await settled(store, wt);
    await settled(store, ref);

    store.getState().toggleViewed(wt, 'a.ts');
    expect(selectViewedMarks(store.getState(), WT_KEY)['a.ts']).toBeDefined();
    const refKey = viewedMarksKey({ kind: 'ref', repoPath: REPO, ref: 'main' });
    expect(selectViewedMarks(store.getState(), refKey)).toEqual({});
  });

  it('refreshes one file in place, and drops it when nothing is left to show', async () => {
    mockStatus.mockResolvedValue([
      { path: 'a.ts', status: 'modified', staged: null, unstaged: 'modified' },
      { path: 'b.ts', status: 'modified', staged: null, unstaged: 'modified' },
    ]);
    mockDiff.mockImplementation(async (_r: string, path: string) => patchFor(path, 'one'));
    const store = createTestStore();
    const tabId = store.getState().openReviewSession({ kind: 'worktree', repoPath: REPO });
    await settled(store, tabId);
    mockStatus.mockClear();
    mockDiff.mockClear();

    mockDiff.mockResolvedValueOnce(patchFor('b.ts', 'two'));
    await store.getState().refreshReviewFile(tabId, 'b.ts');
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockDiff).toHaveBeenCalledTimes(1);
    const files = selectReviewFiles(store.getState(), tabId);
    expect(files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(files[1].patch).toContain('+two');

    mockDiff.mockResolvedValueOnce('');
    await store.getState().refreshReviewFile(tabId, 'a.ts');
    expect(selectReviewFiles(store.getState(), tabId).map((f) => f.path)).toEqual(['b.ts']);
  });

  it('a refresh that reads a file back unchanged keeps its object', async () => {
    mockStatus.mockResolvedValue([
      { path: 'a.ts', status: 'modified', staged: null, unstaged: 'modified' },
      { path: 'b.ts', status: 'modified', staged: null, unstaged: 'modified' },
    ]);
    mockDiff.mockImplementation(async (_r: string, path: string) => patchFor(path, 'same'));
    const store = createTestStore();
    const tabId = store.getState().openReviewSession({ kind: 'worktree', repoPath: REPO });
    await settled(store, tabId);
    const [a, b] = selectReviewFiles(store.getState(), tabId);

    mockDiff.mockImplementation(async (_r: string, path: string) =>
      patchFor(path, path === 'b.ts' ? 'new' : 'same')
    );
    await store.getState().refreshReviewSession(tabId);
    const [a2, b2] = selectReviewFiles(store.getState(), tabId);
    expect(a2).toBe(a);
    expect(b2).not.toBe(b);
  });

  it('ignores toggles for unknown tabs and files', () => {
    const store = createTestStore();
    const before = store.getState().viewedMarks;
    store.getState().toggleViewed('review:/nope:worktree', 'a.ts');
    expect(store.getState().viewedMarks).toBe(before);
  });

  it('resetReviewInMemory drops sessions but keeps viewed marks', async () => {
    mockStatus.mockResolvedValue([]);
    const store = createTestStore();
    const tabId = store.getState().openReviewSession({ kind: 'worktree', repoPath: REPO });
    await settled(store, tabId);
    store.setState({ viewedMarks: { [WT_KEY]: { 'a.ts': 'h' } } });
    store.getState().resetReviewInMemory();
    expect(store.getState().reviewSessions).toEqual({});
    expect(selectViewedMarks(store.getState(), WT_KEY)).toEqual({ 'a.ts': 'h' });
  });
});
