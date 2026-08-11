import type { StateCreator } from 'zustand';
import type { BranchInfo, GitFileStatus } from '../tauri/git';
import {
  getBranchInfo,
  commitChanges,
  pushChanges,
  stageFiles,
  getGitStatus,
  unstageFiles,
} from '../tauri/git';

export interface GitSlice {
  branchInfo: BranchInfo | null;
  fileStatuses: GitFileStatus[];
  commitMessage: string;
  isCommitting: boolean;
  isPushing: boolean;
  refreshGitStatus: (repoPath: string) => Promise<void>;
  stageFile: (repoPath: string, path: string) => Promise<void>;
  /** Stages every changed file except the ignored ones, in one round trip. */
  stageAll: (repoPath: string) => Promise<void>;
  unstageFile: (repoPath: string, path: string) => Promise<void>;
  commit: (repoPath: string) => Promise<string | null>;
  /** Pushes the current branch to origin. Rethrows so the caller can report. */
  push: (repoPath: string) => Promise<void>;
  setCommitMessage: (msg: string) => void;
}

export const createGitSlice: StateCreator<GitSlice> = (set, get) => ({
  branchInfo: null,
  fileStatuses: [],
  commitMessage: '',
  isCommitting: false,
  isPushing: false,

  refreshGitStatus: async (repoPath) => {
    const [statuses, branch] = await Promise.all([getGitStatus(repoPath), getBranchInfo(repoPath)]);
    set({ fileStatuses: statuses, branchInfo: branch });
  },

  stageFile: async (repoPath, path) => {
    await stageFiles(repoPath, [path]);
    await get().refreshGitStatus(repoPath);
  },

  stageAll: async (repoPath) => {
    // Ignored files are ignored on purpose — "all" means all the work, not
    // everything git happens to have noticed.
    const paths = get()
      .fileStatuses.filter((s) => s.status !== 'ignored')
      .map((s) => s.path);
    if (paths.length === 0) return;
    await stageFiles(repoPath, paths);
    await get().refreshGitStatus(repoPath);
  },

  unstageFile: async (repoPath, path) => {
    await unstageFiles(repoPath, [path]);
    await get().refreshGitStatus(repoPath);
  },

  commit: async (repoPath) => {
    const { commitMessage } = get();
    if (!commitMessage.trim()) return null;

    set({ isCommitting: true });
    try {
      const oid = await commitChanges(repoPath, commitMessage);
      set({ commitMessage: '' });
      await get().refreshGitStatus(repoPath);
      return oid;
    } finally {
      set({ isCommitting: false });
    }
  },

  push: async (repoPath) => {
    set({ isPushing: true });
    try {
      await pushChanges(repoPath);
      // The branch's ahead/behind display is what a push changes.
      await get().refreshGitStatus(repoPath);
    } finally {
      set({ isPushing: false });
    }
  },

  setCommitMessage: (msg) => set({ commitMessage: msg }),
});
