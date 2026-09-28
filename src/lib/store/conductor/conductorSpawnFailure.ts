import type { ConductorTickContext } from './conductorTick';

/**
 * The backend's own words for why a spawn was refused. Tauri rejects with the
 * command's error string, other callers with an Error; either way the reason
 * is what the user needs, not "Failed to launch".
 */
export function spawnFailureReason(err: unknown): string | null {
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

/** `detail`, with the refusal reason appended when there is one. */
export function withSpawnFailureReason(detail: string, reason: string | null): string {
  return reason ? `${detail}: ${reason}` : detail;
}

/**
 * Raises one inbox entry per run for a refused spawn. The conductor retries on
 * its own, so this is not an alarm per attempt — but a run whose agents never
 * start has to say so somewhere besides the decision log, or it looks like it
 * simply did nothing.
 */
export function notifySpawnFailure(ctx: ConductorTickContext, reason: string | null): void {
  if (ctx.get().conductorSpawnFailureNotified) return;
  ctx.set({ conductorSpawnFailureNotified: true });
  ctx.notifyInbox({
    severity: 'error',
    title: 'Conductor could not start an agent',
    body: reason ?? 'The agent process did not start.',
  });
}
