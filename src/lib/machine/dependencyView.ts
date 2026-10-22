import type { DependencyReport } from '@/lib/tauri/machine';

/**
 * Where the tool stands, from the report alone. `missing` is calm information
 * (a tool that was never there is news about the machine, not a fault); only a
 * tool that is there and cannot be used is a `problem`.
 */
export type DependencyState = 'found' | 'outside-path' | 'missing' | 'problem';

export interface DependencyView {
  state: DependencyState;
  version: string | null;
  /** Where the binary is, whenever it was found. */
  path: string | null;
}

export function dependencyView(report: DependencyReport): DependencyView {
  const { version, path } = report;
  if (!report.ok) {
    return report.found === null
      ? { state: 'missing', version: null, path: null }
      : { state: 'problem', version, path };
  }
  return { state: report.outsidePath ? 'outside-path' : 'found', version, path };
}

/** "Needed by Video import and okf", in the order Rust lists them. */
export function neededBy(features: string[]): string | null {
  if (features.length === 0) return null;
  if (features.length === 1) return features[0];
  return `${features.slice(0, -1).join(', ')} and ${features[features.length - 1]}`;
}
