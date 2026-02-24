import type { StateCreator } from 'zustand';
import {
  type CoverageSummary,
  type FileCoverage,
  type CoverageConfig,
  type CoveragePathConfig,
} from '@/lib/qa/coverageParser';
import {
  discoverCoverage,
  loadCoverageConfig as loadConfig,
  saveCoverageConfig as saveConfig,
} from '@/lib/qa/coverageDiscovery';

export type { CoverageSummary, FileCoverage, CoverageConfig, CoveragePathConfig };

export interface QASlice {
  coverageSummary: CoverageSummary | null;
  fileCoverage: FileCoverage[];
  coverageStatus: 'idle' | 'loading' | 'error' | 'not-found';
  coverageConfig: CoverageConfig | null;

  setCoverageData: (summary: CoverageSummary, files: FileCoverage[]) => void;
  setCoverageStatus: (status: 'idle' | 'loading' | 'error' | 'not-found') => void;
  loadCoverage: (rootPath: string) => Promise<void>;
  loadCoverageConfig: (rootPath: string) => Promise<void>;
  saveCoverageConfig: (rootPath: string, config: CoverageConfig) => Promise<void>;
}

export const createQASlice: StateCreator<QASlice> = (set) => ({
  coverageSummary: null,
  fileCoverage: [],
  coverageStatus: 'idle',
  coverageConfig: null,

  setCoverageData: (summary, files) =>
    set({ coverageSummary: summary, fileCoverage: files, coverageStatus: 'idle' }),

  setCoverageStatus: (status) => set({ coverageStatus: status }),

  loadCoverageConfig: async (rootPath) => {
    const config = await loadConfig(rootPath);
    set({ coverageConfig: config });
  },

  saveCoverageConfig: async (rootPath, config) => {
    await saveConfig(rootPath, config);
    set({ coverageConfig: config });
  },

  loadCoverage: async (rootPath) => {
    set({ coverageStatus: 'loading' });
    try {
      const result = await discoverCoverage(rootPath);

      if (!result) {
        set({ coverageStatus: 'not-found' });
        return;
      }

      set({
        coverageSummary: result.parsed.summary,
        fileCoverage: result.parsed.files,
        coverageStatus: 'idle',
      });
    } catch (error) {
      console.error('Failed to load coverage:', error);
      set({ coverageStatus: 'error' });
    }
  },
});
