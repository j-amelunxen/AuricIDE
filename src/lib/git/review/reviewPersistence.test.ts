import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand';
import { reviewLineKey, type ReviewComment } from '../reviewComments';
import { viewedMarksKey } from './reviewSession';

const kv = new Map<string, string>();
const mockGet = vi.fn(
  async (root: string, ns: string, key: string) => kv.get(`${root}|${ns}|${key}`) ?? null
);
const mockSet = vi.fn(async (root: string, ns: string, key: string, value: string) => {
  kv.set(`${root}|${ns}|${key}`, value);
});

vi.mock('@/lib/tauri/db', () => ({
  dbGet: (root: string, ns: string, key: string) => mockGet(root, ns, key),
  dbSet: (root: string, ns: string, key: string, value: string) => mockSet(root, ns, key, value),
}));

import {
  REVIEW_STATE_NAMESPACE,
  SAVE_DEBOUNCE_MS,
  belongsToProject,
  loadReviewState,
  saveReviewState,
  subscribeReviewPersistence,
  type ReviewPersistedState,
} from './reviewPersistence';

const ROOT = '/work/app';
const WT = viewedMarksKey({ kind: 'worktree', repoPath: ROOT });

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'c1',
    repoPath: ROOT,
    filePath: 'src/a.ts',
    lineNo: 3,
    side: 'new',
    lineContent: 'x',
    body: 'fix',
    createdAt: 1,
    ...overrides,
  };
}

interface TestState extends ReviewPersistedState {
  rootPath: string | null;
}

function testStore(initial: Partial<TestState> = {}) {
  return createStore<TestState>()(() => ({
    rootPath: null,
    viewedMarks: {},
    reviewComments: [],
    ...initial,
  }));
}

/** Lets pending promise callbacks (the hydration load) run. */
async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  kv.clear();
  vi.clearAllMocks();
});

describe('belongsToProject', () => {
  it.each([
    [ROOT, true],
    [`${ROOT}/packages/sub`, true],
    [`${ROOT}.auric-wt/agent-one`, true],
    ['/work/app-other', false],
    ['/work/other', false],
    ['/work/app.auric-wt-x/a', false],
  ])('%s → %s', (repoPath, expected) => {
    expect(belongsToProject(repoPath, ROOT)).toBe(expected);
  });
});

describe('loadReviewState / saveReviewState', () => {
  it('round-trips through the project kv store, scoped to the project', async () => {
    await saveReviewState(ROOT, {
      viewedMarks: { [WT]: { 'a.ts': 'h1' }, '/elsewhere': { 'b.ts': 'h2' } },
      reviewComments: [comment(), comment({ id: 'c2', repoPath: '/elsewhere' })],
    });

    expect(mockSet).toHaveBeenCalledWith(
      ROOT,
      REVIEW_STATE_NAMESPACE,
      expect.any(String),
      expect.any(String)
    );
    const loaded = await loadReviewState(ROOT);
    expect(loaded).toEqual({
      viewedMarks: { [WT]: { 'a.ts': 'h1' } },
      reviewComments: [comment()],
    });
  });

  it('keeps sentInRound', async () => {
    await saveReviewState(ROOT, { viewedMarks: {}, reviewComments: [comment({ sentInRound: 2 })] });
    expect((await loadReviewState(ROOT)).reviewComments[0].sentInRound).toBe(2);
  });

  it('reads nothing stored as empty, and corrupt or misshapen values as empty', async () => {
    expect(await loadReviewState(ROOT)).toEqual({ viewedMarks: {}, reviewComments: [] });

    kv.set(`${ROOT}|${REVIEW_STATE_NAMESPACE}|viewed_marks`, '{not json');
    kv.set(
      `${ROOT}|${REVIEW_STATE_NAMESPACE}|comments`,
      JSON.stringify([comment(), { id: 'broken' }, 'nope'])
    );
    expect(await loadReviewState(ROOT)).toEqual({ viewedMarks: {}, reviewComments: [comment()] });
  });

  it('drops mark entries whose hash is not a string', async () => {
    kv.set(
      `${ROOT}|${REVIEW_STATE_NAMESPACE}|viewed_marks`,
      JSON.stringify({ [ROOT]: { 'a.ts': 'h', 'b.ts': 3 }, [`${ROOT}/x`]: 'nope' })
    );
    expect((await loadReviewState(ROOT)).viewedMarks).toEqual({
      [viewedMarksKey({ kind: 'worktree', repoPath: ROOT })]: { 'a.ts': 'h' },
    });
  });

  it('reads marks stored per repo as working-tree marks, and keeps per-source keys', async () => {
    const refKey = viewedMarksKey({ kind: 'ref', repoPath: ROOT, ref: 'main' });
    kv.set(
      `${ROOT}|${REVIEW_STATE_NAMESPACE}|viewed_marks`,
      JSON.stringify({ [ROOT]: { 'a.ts': 'old' }, [refKey]: { 'a.ts': 'ref' } })
    );
    expect((await loadReviewState(ROOT)).viewedMarks).toEqual({
      [viewedMarksKey({ kind: 'worktree', repoPath: ROOT })]: { 'a.ts': 'old' },
      [refKey]: { 'a.ts': 'ref' },
    });
  });

  it('loads records written before threads, keyed by their line, without loss', async () => {
    // Before threads a comment's id was its line identity: repo, file, side, line.
    const legacy = [
      comment({ id: `${ROOT}\u0000src/a.ts\u0000new\u00003`, body: 'sent once', sentInRound: 1 }),
      comment({ id: `${ROOT}\u0000src/a.ts\u0000old\u00003`, side: 'old', body: 'old side' }),
      comment({ id: `${ROOT}\u0000src/b.ts\u0000new\u00007`, filePath: 'src/b.ts', lineNo: 7 }),
    ];
    kv.set(`${ROOT}|${REVIEW_STATE_NAMESPACE}|comments`, JSON.stringify(legacy));

    const loaded = (await loadReviewState(ROOT)).reviewComments;
    expect(loaded).toEqual(legacy);
    expect(reviewLineKey(loaded[0])).toBe(loaded[0].id);
  });

  it('keeps a legacy record next to a new comment on the same line through a save', async () => {
    const legacy = comment({ id: `${ROOT}\u0000src/a.ts\u0000new\u00003`, sentInRound: 1 });
    const reply = comment({ id: 'c-new', body: 'still wrong', createdAt: 9 });
    await saveReviewState(ROOT, { viewedMarks: {}, reviewComments: [legacy, reply] });
    expect((await loadReviewState(ROOT)).reviewComments).toEqual([legacy, reply]);
  });

  it('lets a load failure through, so the caller can tell it from an empty project', async () => {
    mockGet.mockRejectedValueOnce(new Error('db closed'));
    await expect(loadReviewState(ROOT)).rejects.toThrow('db closed');
  });
});

describe('subscribeReviewPersistence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hydrates when a project opens, merging what is already in memory', async () => {
    await saveReviewState(ROOT, {
      viewedMarks: { [WT]: { 'a.ts': 'h1', 'b.ts': 'old' } },
      reviewComments: [comment({ id: 'stored' })],
    });
    const store = testStore({
      viewedMarks: { [WT]: { 'b.ts': 'new' } },
      reviewComments: [comment({ id: 'fresh', lineNo: 9 })],
    });
    const stop = subscribeReviewPersistence(store, () => store.getState().rootPath);

    store.setState({ rootPath: ROOT });
    await flushMicrotasks();

    expect(store.getState().viewedMarks[WT]).toEqual({ 'a.ts': 'h1', 'b.ts': 'new' });
    expect(
      store
        .getState()
        .reviewComments.map((c) => c.id)
        .sort()
    ).toEqual(['fresh', 'stored']);
    stop();
  });

  it('hydrates at once when the project is already open on subscribe', async () => {
    await saveReviewState(ROOT, { viewedMarks: { [WT]: { 'a.ts': 'h1' } }, reviewComments: [] });
    const store = testStore({ rootPath: ROOT });
    const stop = subscribeReviewPersistence(store, () => store.getState().rootPath);
    await flushMicrotasks();
    expect(store.getState().viewedMarks[WT]).toEqual({ 'a.ts': 'h1' });
    stop();
  });

  it('debounces writes: many changes, one save after the quiet period', async () => {
    const store = testStore({ rootPath: ROOT });
    const stop = subscribeReviewPersistence(store, () => store.getState().rootPath);
    await flushMicrotasks();
    mockSet.mockClear();

    store.setState({ viewedMarks: { [WT]: { 'a.ts': '1' } } });
    store.setState({ viewedMarks: { [WT]: { 'a.ts': '2' } } });
    store.setState({ reviewComments: [comment()] });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(mockSet).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(mockSet).toHaveBeenCalledTimes(2); // one write per key
    const loaded = await loadReviewState(ROOT);
    expect(loaded.viewedMarks[WT]).toEqual({ 'a.ts': '2' });
    expect(loaded.reviewComments).toEqual([comment()]);
    stop();
  });

  it('ignores changes to unrelated state', async () => {
    const store = testStore({ rootPath: ROOT });
    const stop = subscribeReviewPersistence(store, () => store.getState().rootPath);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    mockSet.mockClear();

    store.setState({ rootPath: ROOT });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(mockSet).not.toHaveBeenCalled();
    stop();
  });

  it('does not write before hydration has finished, so a stored state is never overwritten', async () => {
    await saveReviewState(ROOT, { viewedMarks: {}, reviewComments: [comment({ id: 'stored' })] });
    let releaseLoad: () => void = () => {};
    mockGet.mockImplementationOnce(
      (root, ns, key) =>
        new Promise((resolve) => {
          releaseLoad = () => resolve(kv.get(`${root}|${ns}|${key}`) ?? null);
        })
    );
    const store = testStore();
    const stop = subscribeReviewPersistence(store, () => store.getState().rootPath);
    store.setState({ rootPath: ROOT });
    mockSet.mockClear();

    store.setState({ reviewComments: [comment({ id: 'early', lineNo: 2 })] });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(mockSet).not.toHaveBeenCalled();

    releaseLoad();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    const ids = (await loadReviewState(ROOT)).reviewComments.map((c) => c.id).sort();
    expect(ids).toEqual(['early', 'stored']);
    stop();
  });

  it('never writes after a failed load for that project', async () => {
    mockGet.mockRejectedValue(new Error('db closed'));
    const store = testStore();
    const stop = subscribeReviewPersistence(store, () => store.getState().rootPath);
    store.setState({ rootPath: ROOT });
    await flushMicrotasks();
    store.setState({ reviewComments: [comment()] });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(mockSet).not.toHaveBeenCalled();
    mockGet.mockReset();
    stop();
  });

  it('drops a pending write when the project changes: a reset before the switch must not wipe the old project', async () => {
    await saveReviewState(ROOT, { viewedMarks: {}, reviewComments: [comment({ id: 'keep' })] });
    const store = testStore({ rootPath: ROOT });
    const stop = subscribeReviewPersistence(store, () => store.getState().rootPath);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

    // What opening another folder does: clear in-memory state, then switch root.
    store.setState({ reviewComments: [] });
    store.setState({ rootPath: '/work/next' });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

    expect((await loadReviewState(ROOT)).reviewComments.map((c) => c.id)).toEqual(['keep']);
    stop();
  });

  it('flushes a pending write on unsubscribe', async () => {
    const store = testStore({ rootPath: ROOT });
    const stop = subscribeReviewPersistence(store, () => store.getState().rootPath);
    await flushMicrotasks();
    store.setState({ reviewComments: [comment()] });
    stop();
    await flushMicrotasks();
    expect((await loadReviewState(ROOT)).reviewComments).toEqual([comment()]);
  });

  it('stops listening after unsubscribe', async () => {
    const store = testStore({ rootPath: ROOT });
    const stop = subscribeReviewPersistence(store, () => store.getState().rootPath);
    await flushMicrotasks();
    stop();
    mockSet.mockClear();
    store.setState({ reviewComments: [comment()] });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(mockSet).not.toHaveBeenCalled();
  });
});
