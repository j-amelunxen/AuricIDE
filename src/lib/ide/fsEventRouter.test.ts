import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createFsEventRouter, isProjectDbPath } from './fsEventRouter';

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
