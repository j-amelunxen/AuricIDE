import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createFsEventRouter, isContentOnlyKind, isProjectDbPath } from './fsEventRouter';

describe('isProjectDbPath', () => {
  it('matches the project SQLite database and its WAL/SHM side files', () => {
    expect(isProjectDbPath('/proj/.auric/project.db')).toBe(true);
    expect(isProjectDbPath('/proj/.auric/project.db-wal')).toBe(true);
    expect(isProjectDbPath('/proj/.auric/project.db-shm')).toBe(true);
    expect(isProjectDbPath('/proj/.auric/project.db-journal')).toBe(true);
  });

  it('does not match regular project files', () => {
    expect(isProjectDbPath('/proj/specs/spec-a.md')).toBe(false);
    expect(isProjectDbPath('/proj/src/index.ts')).toBe(false);
    expect(isProjectDbPath('/proj/project.db')).toBe(false);
    expect(isProjectDbPath('/proj/.auric/other.txt')).toBe(false);
  });
});

describe('createFsEventRouter', () => {
  const onTreeChange = vi.fn();
  const onProjectDataChange = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const router = () =>
    createFsEventRouter({
      onTreeChange,
      onProjectDataChange,
      treeDebounceMs: 300,
      dataDebounceMs: 500,
    });

  it('routes regular file events to a debounced tree refresh', () => {
    const r = router();
    r.handle({ path: '/proj/specs/spec-a.md', kind: 'Create' });
    r.handle({ path: '/proj/specs/spec-b.md', kind: 'Create' });

    expect(onTreeChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    expect(onProjectDataChange).not.toHaveBeenCalled();
  });

  it('routes project DB events to a debounced data refresh, not the tree', () => {
    const r = router();
    r.handle({ path: '/proj/.auric/project.db-wal', kind: 'Modify' });
    r.handle({ path: '/proj/.auric/project.db', kind: 'Modify' });

    expect(onProjectDataChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onProjectDataChange).toHaveBeenCalledTimes(1);
    expect(onTreeChange).not.toHaveBeenCalled();
  });

  it('keeps the two debounce lanes independent', () => {
    const r = router();
    r.handle({ path: '/proj/.auric/project.db-wal', kind: 'Modify' });
    r.handle({ path: '/proj/specs/spec-a.md', kind: 'Create' });

    vi.advanceTimersByTime(300);
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    expect(onProjectDataChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(onProjectDataChange).toHaveBeenCalledTimes(1);
  });

  it('hands the tree lane the deduplicated parent directories that changed', () => {
    const r = router();
    r.handle({ path: '/proj/src/lib/a.ts', kind: 'Create' });
    r.handle({ path: '/proj/src/lib/b.ts', kind: 'Create' });
    r.handle({ path: '/proj/README.md', kind: 'Modify' });

    vi.advanceTimersByTime(300);
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    expect([...onTreeChange.mock.calls[0][0]].sort()).toEqual(['/proj', '/proj/src/lib']);
  });

  it('starts each flush from an empty set of directories', () => {
    const r = router();
    r.handle({ path: '/proj/src/a.ts', kind: 'Create' });
    vi.advanceTimersByTime(300);
    r.handle({ path: '/proj/docs/b.md', kind: 'Create' });
    vi.advanceTimersByTime(300);

    expect(onTreeChange).toHaveBeenCalledTimes(2);
    expect(onTreeChange.mock.calls[1][0]).toEqual(['/proj/docs']);
  });

  it('flushes a continuous write stream instead of starving on it', () => {
    const r = createFsEventRouter({
      onTreeChange,
      onProjectDataChange,
      treeDebounceMs: 300,
      treeMaxWaitMs: 1000,
    });
    // A build tool writing every 100ms would reset a pure trailing debounce
    // forever, and the explorer would never refresh while it runs.
    for (let elapsed = 0; elapsed < 1000; elapsed += 100) {
      r.handle({ path: `/proj/out/chunk-${elapsed}.js`, kind: 'Create' });
      vi.advanceTimersByTime(100);
    }
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    expect(onTreeChange.mock.calls[0][0]).toEqual(['/proj/out']);
  });

  it('dispose cancels pending refreshes', () => {
    const r = router();
    r.handle({ path: '/proj/.auric/project.db', kind: 'Modify' });
    r.handle({ path: '/proj/specs/spec-a.md', kind: 'Create' });

    r.dispose();
    vi.advanceTimersByTime(1000);

    expect(onTreeChange).not.toHaveBeenCalled();
    expect(onProjectDataChange).not.toHaveBeenCalled();
  });
});

describe('evidence lane', () => {
  it('feeds non-db changes into both the tree and the evidence lane', () => {
    vi.useFakeTimers();
    const onTreeChange = vi.fn();
    const onProjectDataChange = vi.fn();
    const onEvidenceChange = vi.fn();
    const router = createFsEventRouter({
      onTreeChange,
      onProjectDataChange,
      onEvidenceChange,
      treeDebounceMs: 300,
      evidenceDebounceMs: 1000,
    });

    router.handle({ path: '/p/docs/readme.md', kind: 'modify' });
    vi.advanceTimersByTime(300);
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    expect(onEvidenceChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(700);
    expect(onEvidenceChange).toHaveBeenCalledTimes(1);

    // DB writes stay out of the evidence lane — data reloads own that path.
    router.handle({ path: '/p/.auric/project.db-wal', kind: 'modify' });
    vi.advanceTimersByTime(2000);
    expect(onEvidenceChange).toHaveBeenCalledTimes(1);
    router.dispose();
    vi.useRealTimers();
  });
});

describe('isContentOnlyKind', () => {
  it('treats data and metadata writes as content-only', () => {
    expect(isContentOnlyKind('Modify(Data(Content))')).toBe(true);
    expect(isContentOnlyKind('Modify(Data(Any))')).toBe(true);
    expect(isContentOnlyKind('Modify(Metadata(Any))')).toBe(true);
    expect(isContentOnlyKind('Access(Close(Write))')).toBe(true);
  });

  it('treats anything that can change the set of paths as structural', () => {
    expect(isContentOnlyKind('Create(File)')).toBe(false);
    expect(isContentOnlyKind('Remove(File)')).toBe(false);
    expect(isContentOnlyKind('Modify(Name(Any))')).toBe(false);
    // Unknown shapes are structural: the safe answer is the expensive one.
    expect(isContentOnlyKind('Any')).toBe(false);
    expect(isContentOnlyKind('Other')).toBe(false);
  });
});

describe('createFsEventRouter change summary', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const flushWith = (events: Array<{ path: string; kind: string }>) => {
    const onTreeChange = vi.fn();
    const r = createFsEventRouter({ onTreeChange, onProjectDataChange: vi.fn() });
    for (const e of events) r.handle(e);
    vi.advanceTimersByTime(1_000);
    expect(onTreeChange).toHaveBeenCalledTimes(1);
    return onTreeChange.mock.calls[0][1];
  };

  it('reports a burst of content writes as non-structural', () => {
    expect(
      flushWith([
        { path: '/p/a.md', kind: 'Modify(Data(Content))' },
        { path: '/p/b.md', kind: 'Modify(Data(Content))' },
      ])
    ).toEqual({ structural: false, ignoreRulesChanged: false });
  });

  it('reports a burst with one create as structural', () => {
    expect(
      flushWith([
        { path: '/p/a.md', kind: 'Modify(Data(Content))' },
        { path: '/p/new.md', kind: 'Create(File)' },
      ])
    ).toMatchObject({ structural: true });
  });

  it('notices a changed ignore file anywhere in the project', () => {
    expect(flushWith([{ path: '/p/.gitignore', kind: 'Modify(Data(Content))' }])).toEqual({
      structural: false,
      ignoreRulesChanged: true,
    });
    expect(flushWith([{ path: '/p/sub/.gitignore', kind: 'Modify(Data(Content))' }])).toMatchObject(
      { ignoreRulesChanged: true }
    );
  });

  it('starts every burst with a clean summary', () => {
    const onTreeChange = vi.fn();
    const r = createFsEventRouter({ onTreeChange, onProjectDataChange: vi.fn() });
    r.handle({ path: '/p/new.md', kind: 'Create(File)' });
    vi.advanceTimersByTime(1_000);
    r.handle({ path: '/p/new.md', kind: 'Modify(Data(Content))' });
    vi.advanceTimersByTime(1_000);
    expect(onTreeChange.mock.calls[1][1]).toEqual({
      structural: false,
      ignoreRulesChanged: false,
    });
  });
});
