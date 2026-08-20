import type { UsageSample, UsageSnapshot } from '../usage/types';
import { invoke } from './invoke';

/** Last reading per provider, plus the trail a forecast is taken from. */
export interface UsageLimitsView {
  snapshots: UsageSnapshot[];
  history: UsageSample[];
}

/** Whatever readings are already stored. Cheap: no process is started. */
export async function usageLimitsRead(): Promise<UsageLimitsView> {
  return await invoke<UsageLimitsView>('usage_limits_read');
}

/**
 * Asks Codex (and Claude's drop file) for a fresh reading.
 *
 * This is the expensive path: `codex app-server` costs credits. Call it from
 * the refresh button, not from hover or focus. The 15-minute poller lives in
 * Rust and does not go through this wrapper.
 */
export async function usageLimitsRefresh(): Promise<UsageLimitsView> {
  return await invoke<UsageLimitsView>('usage_limits_refresh');
}
