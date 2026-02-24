import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { createGitSlice, type GitSlice } from './gitSlice';

vi.mock('../tauri/git', () => ({
  getGitStatus: vi.fn(async () => [{ path: 'file.md', status: 'modified' }]),
  getBranchInfo: vi.fn(async () => ({ name: 'main', ahead: 0, behind: 0 })),
  stageFiles: vi.fn(async () => undefined),
  unstageFiles: vi.fn(async () => undefined),
  commitChanges: vi.fn(async () => 'abc123'),
}));

describe('gitSlice', () => {
  let store: ReturnType<typeof createStore<GitSlice>>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<GitSlice>()(createGitSlice);
  });

  it('initializes with empty state', () => {
    const state = store.getState();
    expect(state.branchInfo).toBeNull();
    expect(state.fileStatuses).toEqual([]);
    expect(state.commitMessage).toBe('');
    expect(state.isCommitting).toBe(false);
  });

  it('refreshGitStatus fetches statuses and branch info', async () => {
    await store.getState().refreshGitStatus('/repo');
    const state = store.getState();
    expect(state.fileStatuses).toEqual([{ path: 'file.md', status: 'modified' }]);
    expect(state.branchInfo).toEqual({ name: 'main', ahead: 0, behind: 0 });
  });

  it('setCommitMessage updates message', () => {
    store.getState().setCommitMessage('test commit');
    expect(store.getState().commitMessage).toBe('test commit');
  });

  it('commit calls commitChanges and clears message', async () => {
    store.getState().setCommitMessage('test commit');
    const oid = await store.getState().commit('/repo');
    expect(oid).toBe('abc123');
    expect(store.getState().commitMessage).toBe('');
  });

  it('commit returns null if message is empty', async () => {
    const oid = await store.getState().commit('/repo');
    expect(oid).toBeNull();
  });

  it('stageFile calls stageFiles and refreshes', async () => {
    const { stageFiles: mockStage } = await import('../tauri/git');
    await store.getState().stageFile('/repo', 'file.md');
    expect(mockStage).toHaveBeenCalledWith('/repo', ['file.md']);
    expect(store.getState().fileStatuses.length).toBeGreaterThan(0);
  });

  it('unstageFile calls unstageFiles and refreshes', async () => {
    const { unstageFiles: mockUnstage } = await import('../tauri/git');
    await store.getState().unstageFile('/repo', 'file.md');
    expect(mockUnstage).toHaveBeenCalledWith('/repo', ['file.md']);
  });
});
