import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createQASlice, type QASlice } from './qaSlice';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExists = vi.fn();
const mockReadFile = vi.fn();
const mockDbGet = vi.fn();
const mockDbSet = vi.fn();

vi.mock('@/lib/tauri/fs', () => ({
  exists: (...args: unknown[]) => mockExists(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

vi.mock('@/lib/tauri/db', () => ({
  dbGet: (...args: unknown[]) => mockDbGet(...args),
  dbSet: (...args: unknown[]) => mockDbSet(...args),
}));

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

function createTestStore() {
  return create<QASlice>()((...a) => ({ ...createQASlice(...a) }));
}

const ROOT = '/root';

const makeSummaryJson = (lines = 80, file = 'src/file.ts') =>
  JSON.stringify({
    total: {
      lines: { pct: lines },
      statements: { pct: 75 },
      functions: { pct: 70 },
      branches: { pct: 65 },
    },
    [file]: {
      lines: { pct: 90 },
      statements: { pct: 85 },
      functions: { pct: 80 },
      branches: { pct: 75 },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('initial state', () => {
  it('has null coverageSummary and empty fileCoverage', () => {
    const store = createTestStore();
    expect(store.getState().coverageSummary).toBeNull();
    expect(store.getState().fileCoverage).toEqual([]);
    expect(store.getState().coverageStatus).toBe('idle');
  });

  it('has null coverageConfig', () => {
    const store = createTestStore();
    expect(store.getState().coverageConfig).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setCoverageData / setCoverageStatus
// ---------------------------------------------------------------------------

describe('setCoverageData', () => {
  it('sets summary and files and resets status to idle', () => {
    const store = createTestStore();
    const summary = { lines: 80, statements: 75, functions: 70, branches: 65 };
    const files = [
      { path: 'src/a.ts', size: 10, lines: 90, statements: 85, functions: 80, branches: 75 },
    ];
    store.getState().setCoverageData(summary, files);
    expect(store.getState().coverageSummary).toEqual(summary);
    expect(store.getState().fileCoverage).toEqual(files);
    expect(store.getState().coverageStatus).toBe('idle');
  });
});

describe('setCoverageStatus', () => {
  it('updates status', () => {
    const store = createTestStore();
    store.getState().setCoverageStatus('loading');
    expect(store.getState().coverageStatus).toBe('loading');
  });
});

// ---------------------------------------------------------------------------
// loadCoverageConfig / saveCoverageConfig
// ---------------------------------------------------------------------------

describe('loadCoverageConfig', () => {
  it('sets coverageConfig from DB', async () => {
    const config = {
      paths: [
        { relativePath: 'coverage/coverage-summary.json', format: 'coverage-summary' as const },
      ],
    };
    mockDbGet.mockResolvedValue(JSON.stringify(config));

    const store = createTestStore();
    await store.getState().loadCoverageConfig(ROOT);

    expect(store.getState().coverageConfig).toEqual(config);
  });

  it('leaves coverageConfig null when DB has no entry', async () => {
    mockDbGet.mockResolvedValue(null);

    const store = createTestStore();
    await store.getState().loadCoverageConfig(ROOT);

    expect(store.getState().coverageConfig).toBeNull();
  });
});

describe('saveCoverageConfig', () => {
  it('persists config to DB and updates state', async () => {
    mockDbSet.mockResolvedValue(undefined);

    const config = { paths: [{ relativePath: 'coverage/lcov.info', format: 'lcov' as const }] };
    const store = createTestStore();
    await store.getState().saveCoverageConfig(ROOT, config);

    expect(mockDbSet).toHaveBeenCalledWith(ROOT, 'qa', 'coverage_config', JSON.stringify(config));
    expect(store.getState().coverageConfig).toEqual(config);
  });
});

// ---------------------------------------------------------------------------
// loadCoverage – auto-discovery flow
// ---------------------------------------------------------------------------

describe('loadCoverage', () => {
  it('sets status to loading then idle on success', async () => {
    mockDbGet.mockResolvedValue(null); // no stored config
    mockExists.mockResolvedValueOnce(true); // first common path found
    mockReadFile.mockResolvedValue(makeSummaryJson());
    mockDbSet.mockResolvedValue(undefined);

    const store = createTestStore();
    await store.getState().loadCoverage(ROOT);

    expect(store.getState().coverageStatus).toBe('idle');
    expect(store.getState().coverageSummary?.lines).toBe(80);
  });

  it('sets status to not-found when no coverage file exists', async () => {
    mockDbGet.mockResolvedValue(null);
    mockExists.mockResolvedValue(false);

    const store = createTestStore();
    await store.getState().loadCoverage(ROOT);

    expect(store.getState().coverageStatus).toBe('not-found');
    expect(store.getState().coverageSummary).toBeNull();
  });

  it('sets status to error on unexpected exception', async () => {
    mockDbGet.mockRejectedValue(new Error('DB down'));

    const store = createTestStore();
    await store.getState().loadCoverage(ROOT);

    expect(store.getState().coverageStatus).toBe('error');
  });

  it('uses stored config path when available', async () => {
    const config = {
      paths: [{ relativePath: 'custom/cov.json', format: 'coverage-summary' as const }],
    };
    mockDbGet.mockResolvedValue(JSON.stringify(config));
    mockExists.mockResolvedValueOnce(true); // custom path found
    mockReadFile.mockResolvedValue(makeSummaryJson());

    const store = createTestStore();
    await store.getState().loadCoverage(ROOT);

    expect(mockExists).toHaveBeenCalledWith(`${ROOT}/custom/cov.json`);
    expect(store.getState().coverageStatus).toBe('idle');
  });

  it('populates fileCoverage on success', async () => {
    mockDbGet.mockResolvedValue(null);
    mockExists.mockResolvedValueOnce(true);
    mockReadFile.mockResolvedValue(makeSummaryJson(80, 'src/file.ts'));
    mockDbSet.mockResolvedValue(undefined);

    const store = createTestStore();
    await store.getState().loadCoverage(ROOT);

    expect(store.getState().fileCoverage).toHaveLength(1);
    expect(store.getState().fileCoverage[0].path).toBe('src/file.ts');
  });
});
