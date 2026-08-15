import type { UsageSnapshot } from '../usage/types';
import { invoke } from './invoke';

/** Whatever readings are already stored. Cheap: no process is started. */
export async function usageLimitsRead(): Promise<UsageSnapshot[]> {
  return await invoke<UsageSnapshot[]>('usage_limits_read');
}

/**
 * Refreshes what has aged out and returns everything.
 *
 * The backend gates this on a five-minute TTL and a single-flight lock, so
 * calling it on focus, on hover and on a timer is not the same as running
 * `codex` three times.
 */
export async function usageLimitsRefresh(): Promise<UsageSnapshot[]> {
  return await invoke<UsageSnapshot[]>('usage_limits_refresh');
}
