import { subscribeToTauriEvent } from './subscribe';

/**
 * Fires when a stored quota reading changes.
 *
 * The Claude reading arrives through a file that a running agent's status line
 * writes, so nothing on this side would otherwise notice it landing — Rust
 * watches that file and emits this.
 */
export const USAGE_LIMITS_CHANGED_EVENT = 'usage-limits-changed';

export function onUsageLimitsChanged(callback: () => void): () => void {
  return subscribeToTauriEvent(
    USAGE_LIMITS_CHANGED_EVENT,
    callback,
    '[Browser mode] Usage limits listener not available'
  );
}
