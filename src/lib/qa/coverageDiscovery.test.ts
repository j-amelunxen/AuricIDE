import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  COMMON_COVERAGE_PATHS,
  discoverCoverage,
  loadCoverageConfig,
  saveCoverageConfig,
} from './coverageDiscovery';

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

const ROOT = '/my/project';

const makeSummaryContent = () =>
  JSON.stringify({
    total: {
      lines: { pct: 80 },
      statements: { pct: 75 },
      functions: { pct: 70 },
      branches: { pct: 65 },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// COMMON_COVERAGE_PATHS
// ---------------------------------------------------------------------------

describe('COMMON_COVERAGE_PATHS', () => {
  it('contains at least one entry', () => {
    expect(COMMON_COVERAGE_PATHS.length).toBeGreaterThan(0);
  });

  it('first entry is coverage/coverage-summary.json', () => {
    expect(COMMON_COVERAGE_PATHS[0].relativePath).toBe('coverage/coverage-summary.json');
    expect(COMMON_COVERAGE_PATHS[0].format).toBe('coverage-summary');
  });

  it('includes lcov entries', () => {
    const lcovPaths = COMMON_COVERAGE_PATHS.filter((p) => p.format === 'lcov');
    expect(lcovPaths.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// loadCoverageConfig
// ---------------------------------------------------------------------------

describe('loadCoverageConfig', () => {
  it('returns null when no config in DB', async () => {
    mockDbGet.mockResolvedValue(null);
    const result = await loadCoverageConfig(ROOT);
    expect(result).toBeNull();
    expect(mockDbGet).toHaveBeenCalledWith(ROOT, 'qa', 'coverage_config');
  });

  it('returns parsed config when found in DB', async () => {
    const config = {
      paths: [{ relativePath: 'custom/coverage.json', format: 'coverage-summary' }],
    };
    mockDbGet.mockResolvedValue(JSON.stringify(config));
    const result = await loadCoverageConfig(ROOT);
    expect(result).toEqual(config);
  });

  it('returns null when DB value is invalid JSON', async () => {
    mockDbGet.mockResolvedValue('not-json');
    const result = await loadCoverageConfig(ROOT);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveCoverageConfig
// ---------------------------------------------------------------------------

describe('saveCoverageConfig', () => {
  it('serialises config and calls dbSet', async () => {
    const config = {
      paths: [
        { relativePath: 'coverage/coverage-summary.json', format: 'coverage-summary' as const },
      ],
    };
    await saveCoverageConfig(ROOT, config);
    expect(mockDbSet).toHaveBeenCalledWith(ROOT, 'qa', 'coverage_config', JSON.stringify(config));
  });
});

// ---------------------------------------------------------------------------
// discoverCoverage – uses configured paths first
// ---------------------------------------------------------------------------

describe('discoverCoverage – config paths', () => {
  it('uses the configured path when file exists', async () => {
    const config = {
      paths: [{ relativePath: 'custom/cov.json', format: 'coverage-summary' as const }],
    };
    mockDbGet.mockResolvedValue(JSON.stringify(config));
    mockExists.mockImplementation((p: string) => Promise.resolve(p.includes('custom/cov.json')));
    mockReadFile.mockResolvedValue(makeSummaryContent());

    const result = await discoverCoverage(ROOT);

    expect(result).not.toBeNull();
    expect(result!.config.relativePath).toBe('custom/cov.json');
    expect(result!.parsed.summary.lines).toBe(80);
    expect(mockExists).toHaveBeenCalledWith(`${ROOT}/custom/cov.json`);
  });

  it('falls through to auto-discovery when configured file is missing', async () => {
    const config = {
      paths: [{ relativePath: 'custom/missing.json', format: 'coverage-summary' as const }],
    };
    mockDbGet.mockResolvedValue(JSON.stringify(config));
    // First call (configured path) → false; second call (first common path) → true
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockReadFile.mockResolvedValue(makeSummaryContent());

    const result = await discoverCoverage(ROOT);

    expect(result).not.toBeNull();
    // Should have found the first COMMON_COVERAGE_PATHS entry
    expect(result!.config.relativePath).toBe(COMMON_COVERAGE_PATHS[0].relativePath);
  });
});

// ---------------------------------------------------------------------------
// discoverCoverage – auto-discovery (no config)
// ---------------------------------------------------------------------------

describe('discoverCoverage – auto-discovery', () => {
  it('returns null when no coverage file is found', async () => {
    mockDbGet.mockResolvedValue(null);
    mockExists.mockResolvedValue(false);

    const result = await discoverCoverage(ROOT);

    expect(result).toBeNull();
  });

  it('returns first matching path when found', async () => {
    mockDbGet.mockResolvedValue(null);
    mockExists
      .mockResolvedValueOnce(false) // coverage/coverage-summary.json
      .mockResolvedValueOnce(true); // coverage/coverage-final.json
    mockReadFile.mockResolvedValue(JSON.stringify({})); // empty coverage-final

    const result = await discoverCoverage(ROOT);

    expect(result).not.toBeNull();
    expect(result!.config.relativePath).toBe('coverage/coverage-final.json');
    expect(result!.config.format).toBe('coverage-final');
  });

  it('saves discovered path to DB (best-effort)', async () => {
    mockDbGet.mockResolvedValue(null);
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockReadFile.mockResolvedValue(JSON.stringify({}));

    await discoverCoverage(ROOT);

    expect(mockDbSet).toHaveBeenCalledWith(
      ROOT,
      'qa',
      'coverage_config',
      expect.stringContaining('coverage-final.json')
    );
  });

  it('does not throw if saving discovered path fails', async () => {
    mockDbGet.mockResolvedValue(null);
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockReadFile.mockResolvedValue(JSON.stringify({}));
    mockDbSet.mockRejectedValue(new Error('DB write failed'));

    await expect(discoverCoverage(ROOT)).resolves.not.toThrow();
  });
});
