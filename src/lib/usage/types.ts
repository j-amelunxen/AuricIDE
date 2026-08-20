/**
 * The shape Rust hands across IPC, and nothing more.
 *
 * Raw parsing of the two CLI wire formats lives in
 * `src-tauri/src/usage_limits/contract.rs`; by the time anything reaches here
 * it has already been validated and normalized. The golden fixtures under
 * `fixtures/usage-limits/*.normalized.json` are the boundary the two sides
 * share: Rust asserts it produces them, the tests here assert we render them.
 */

/** Which known window a reading covers. Derived from its length, never from
 *  where it appeared in the response — see the Rust contract for why. */
export type WindowKind = '5h' | '7d' | 'other';

export interface UsageWindow {
  limitId: string;
  limitLabel: string | null;
  kind: WindowKind;
  label: string;
  usedPercent: number;
  resetsAt: number;
  windowMinutes: number;
}

export interface UsageCredits {
  balance: string;
  unlimited: boolean;
}

export interface UsageSnapshot {
  provider: string;
  planLabel: string | null;
  /** Shortest window first. Empty means "nothing was reported", which must
   *  render as nothing rather than as 0 %. */
  windows: UsageWindow[];
  credits: UsageCredits | null;
  /** Unix seconds. The age of a reading is part of the reading. */
  observedAt: number;
  source: string;
}

/**
 * One stored reading, kept so a later one can be a delta rather than a lone
 * percentage. Slimmer than a snapshot: the plan label and the credit balance
 * do not change the rate.
 */
export interface UsageSampleWindow {
  limitId: string;
  kind: WindowKind;
  usedPercent: number;
  resetsAt: number;
  windowMinutes: number;
}

export interface UsageSample {
  provider: string;
  observedAt: number;
  windows: UsageSampleWindow[];
}
