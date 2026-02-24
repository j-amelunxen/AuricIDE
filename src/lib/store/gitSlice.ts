import type { StateCreator } from 'zustand';
import type { BranchInfo, GitFileStatus } from '../tauri/git';
import { getBranchInfo, commitChanges, stageFiles, getGitStatus, unstageFiles } from '../tauri/git';

export interface GitSlice {
  branchInfo: BranchInfo | null;
  fileStatuses: GitFileStatus[];
  commitMessage: string;
  isCommitting: boolean;
  refreshGitStatus: (repoPath: string) => Promise<void>;
  stageFile: (repoPath: string, path: string) => Promise<void>;
  unstageFile: (repoPath: string, path: string) => Promise<void>;
  commit: (repoPath: string) => Promise<string | null>;
  setCommitMessage: (msg: string) => void;
}

export const createGitSlice: StateCreator<GitSlice> = (set, get) => ({
  branchInfo: null,
  fileStatuses: [],
  commitMessage: '',
  isCommitting: false,

  refreshGitStatus: async (repoPath) => {
    const [statuses, branch] = await Promise.all([getGitStatus(repoPath), getBranchInfo(repoPath)]);
    set({ fileStatuses: statuses, branchInfo: branch });
  },

  stageFile: async (repoPath, path) => {
    await stageFiles(repoPath, [path]);
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

  setCommitMessage: (msg) => set({ commitMessage: msg }),
});
