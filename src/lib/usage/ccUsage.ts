/**
 * The historical-usage report, as Rust hands it across IPC.
 *
 * The twin of `types.ts`: that one carries the live quota reading for the
 * status-bar chip, this one carries what was actually spent over a period.
 * They are deliberately separate — a quota percentage and a token total are
 * different measurements from different sources, and a shape that held both
 * would invite code that treats one as evidence for the other.
 *
 * Everything here is already validated and normalized by
 * `src-tauri/src/cc_usage/`. Nothing in this file recomputes a cost.
 */

import { invoke } from '../tauri/invoke';

/** Which reporting periods the backend offers. */
export type UsageWindowId = '24h' | '3d' | '7d' | '30d';

export interface UsageTokenCounts {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  /** A subset of `output`, not an addition to it. */
  thinking: number;
  webSearchRequests: number;
  webFetchRequests: number;
}

export interface UsageAggregate {
  counts: UsageTokenCounts;
  cost: number;
  /**
   * What the prompt cache saved: the difference between what the cache reads
   * billed and what they would have billed uncached. Reported beside `cost`,
   * never subtracted from it — a cost with a saving already netted off could
   * not be checked against a published rate.
   */
  cacheSaving: number;
  messages: number;
}

export interface UsageNamedAggregate {
  key: string;
  label: string;
  aggregate: UsageAggregate;
  sessions: number;
  /** No rate was found, so `cost` is zero and understates the row. */
  unpriced: boolean;
  /**
   * Cost per bucket, aligned index-for-index with the window's `buckets`.
   *
   * This is what makes the breakdown small multiples rather than a ranked
   * list: every row is the same shape over the same axis, so a spike in one is
   * directly comparable to a spike in another. Empty on rows the panel does
   * not draw.
   */
  series: number[];
}

export interface UsageBucket {
  /** Unix seconds. */
  startsAt: number;
  cost: number;
  tokens: number;
  messages: number;
}

export interface UsageWindowReport {
  id: UsageWindowId;
  label: string;
  hours: number;
  startsAt: number;
  endsAt: number;
  bucketSeconds: number;
  totals: UsageAggregate;
  /** Costliest first. */
  models: UsageNamedAggregate[];
  /** Costliest first. */
  projects: UsageNamedAggregate[];
  /** Every bucket in the window, quiet ones included. */
  buckets: UsageBucket[];
  sessions: number;
  sidechainMessages: number;
  unpricedModels: string[];
  /**
   * The same length of time, immediately before this window — the answer to
   * "compared to what?".
   *
   * `null` when the transcripts do not reach back across the whole earlier
   * period. Rendering that as a quiet period would make every figure from a
   * new install read as a surge, so the panel shows no comparison at all
   * instead.
   */
  previous: UsageAggregate | null;
}

export interface CcUsageReport {
  pluginId: string;
  pluginName: string;
  currency: string;
  /** Unix seconds. The age of a report is part of the report. */
  generatedAt: number;
  windows: UsageWindowReport[];
  filesScanned: number;
  /** Before deduplication — `turnsRead - counted` is what the dedup removed. */
  turnsRead: number;
  duplicatesDropped: number;
  scanMs: number;
}

export interface CcUsagePlugin {
  id: string;
  name: string;
  currency: string;
  /** False when the plugin's source directories are not on this machine. */
  available: boolean;
}

/** Which usage plugins are installed. Cheap — reads no transcripts. */
export async function ccUsagePlugins(): Promise<CcUsagePlugin[]> {
  return await invoke<CcUsagePlugin[]>('cc_usage_plugins');
}

/**
 * The full report: every window in one call.
 *
 * All four windows come back together because they are one pass over the same
 * transcripts — asking per window would read the corpus four times to produce
 * numbers that are already computed. Switching tabs in the panel is therefore
 * free, and `force` is the only thing that costs a scan.
 */
export async function ccUsageReport(options?: {
  pluginId?: string;
  force?: boolean;
}): Promise<CcUsageReport> {
  return await invoke<CcUsageReport>('cc_usage_report', {
    pluginId: options?.pluginId ?? null,
    force: options?.force ?? false,
  });
}
