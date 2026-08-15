import type { UsageSnapshot } from '../usage/types';
import { invoke } from './invoke';

/** Whatever readings are already stored. Cheap: no process is started. */
export async function usageLimitsRead(): Promise<UsageSnapshot[]> {
  return await invoke<UsageSnapshot[]>('usage_limits_read');
}

/**
 * Asks Codex (and Claude's drop file) for a fresh reading.
 *
 * This is the expensive path: `codex app-server` costs credits. Call it from
 * the refresh button, not from hover, focus or a timer.
 */
export async function usageLimitsRefresh(): Promise<UsageSnapshot[]> {
  return await invoke<UsageSnapshot[]>('usage_limits_refresh');
}
