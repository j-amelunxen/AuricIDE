import { exists, readFile } from '@/lib/tauri/fs';
import { dbGet, dbSet } from '@/lib/tauri/db';
import {
  type CoverageConfig,
  type CoveragePathConfig,
  type ParsedCoverage,
  parseByFormat,
} from './coverageParser';

export { type CoverageConfig, type CoveragePathConfig };

export const COMMON_COVERAGE_PATHS: CoveragePathConfig[] = [
  { relativePath: 'coverage/coverage-summary.json', format: 'coverage-summary' },
  { relativePath: 'coverage/coverage-final.json', format: 'coverage-final' },
  { relativePath: 'coverage/lcov.info', format: 'lcov' },
  { relativePath: '.nyc_output/coverage-summary.json', format: 'coverage-summary' },
  { relativePath: '.nyc_output/coverage-final.json', format: 'coverage-final' },
  { relativePath: 'test-results/coverage/lcov.info', format: 'lcov' },
  { relativePath: 'reports/lcov.info', format: 'lcov' },
];

const DB_NAMESPACE = 'qa';
const DB_KEY = 'coverage_config';

export async function loadCoverageConfig(rootPath: string): Promise<CoverageConfig | null> {
  const raw = await dbGet(rootPath, DB_NAMESPACE, DB_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CoverageConfig;
  } catch {
    // stored value is corrupt – treat as no config
    return null;
  }
}

export async function saveCoverageConfig(rootPath: string, config: CoverageConfig): Promise<void> {
  await dbSet(rootPath, DB_NAMESPACE, DB_KEY, JSON.stringify(config));
}

export interface DiscoveredCoverage {
  config: CoveragePathConfig;
  parsed: ParsedCoverage;
}

async function tryPath(
  rootPath: string,
  pathConfig: CoveragePathConfig
): Promise<DiscoveredCoverage | null> {
  const fullPath = `${rootPath}/${pathConfig.relativePath}`;
  const found = await exists(fullPath);
  if (!found) return null;
  const content = await readFile(fullPath);
  const parsed = parseByFormat(content, pathConfig.format);
  return { config: pathConfig, parsed };
}

export async function discoverCoverage(rootPath: string): Promise<DiscoveredCoverage | null> {
  // 1. Try configured paths from DB
  const storedConfig = await loadCoverageConfig(rootPath);
  if (storedConfig) {
    for (const pathConfig of storedConfig.paths) {
      const result = await tryPath(rootPath, pathConfig);
      if (result) return result;
    }
  }

  // 2. Auto-discovery over common paths
  for (const pathConfig of COMMON_COVERAGE_PATHS) {
    const result = await tryPath(rootPath, pathConfig);
    if (result) {
      // Best-effort: persist discovered path so future loads skip the scan
      try {
        await saveCoverageConfig(rootPath, { paths: [pathConfig] });
      } catch {
        // ignore – discovery still succeeds
      }
      return result;
    }
  }

  return null;
}
