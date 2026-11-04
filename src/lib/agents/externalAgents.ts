import type { ControlResult } from './agentControl.contract';
import { formatAgentDuration } from './duration';

/**
 * A run the IDE tracks but does not run (`docs/design-external-agents.md`).
 *
 * It is not an agent and never joins the agent list: no console, no kill, not in
 * any "N running" figure. Stale is a reading rather than a state, so the display
 * works it out against the clock instead of trusting the value from when the
 * list was fetched.
 */
export type ExternalAgent = ControlResult<'external_list'>['agents'][number];

/** Above one night and above the longest default run, so a Mac that slept does not trip them. */
export const EXTERNAL_STALE_RUNNING_AFTER_MS = 26 * 60 * 60 * 1000;
export const EXTERNAL_STALE_REGISTERED_AFTER_MS = 72 * 60 * 60 * 1000;

type StaleFields = Pick<ExternalAgent, 'state' | 'lastSeenAt'>;

export function isExternalLive(external: Pick<ExternalAgent, 'state'>): boolean {
  return external.state === 'running' || external.state === 'registered';
}

export function isExternalStale(external: StaleFields, now: number): boolean {
  if (!isExternalLive(external)) return false;
  const limit =
    external.state === 'running'
      ? EXTERNAL_STALE_RUNNING_AFTER_MS
      : EXTERNAL_STALE_REGISTERED_AFTER_MS;
  return now - external.lastSeenAt > limit;
}

/** An open span runs up to now, or up to the end of a run that is already over. */
export function externalOnMs(
  external: Pick<ExternalAgent, 'onSpans'> & Partial<Pick<ExternalAgent, 'finishedAt'>>,
  now: number
): number {
  const openEnd = external.finishedAt ?? now;
  return external.onSpans.reduce(
    (total, span) => total + Math.max(0, (span.to ?? openEnd) - span.from),
    0
  );
}

/** Only what is reported as working and still heard from counts in the "N external" figure. */
export function externalCountsAsOn(external: StaleFields, now: number): boolean {
  return external.state === 'running' && !isExternalStale(external, now);
}

export type ExternalStateLabel = 'Running' | 'Off' | 'Stale?' | 'Stopped' | 'Failed';

export function externalStateLabel(external: StaleFields, now: number): ExternalStateLabel {
  if (external.state === 'stopped') return 'Stopped';
  if (external.state === 'failed') return 'Failed';
  if (isExternalStale(external, now)) return 'Stale?';
  return external.state === 'running' ? 'Running' : 'Off';
}

/** "9h" reads better than "9h 0m" when the figure sits inside a sentence. */
export function formatExternalSpan(ms: number): string {
  return formatAgentDuration(ms).replace(/ 0[mh]$/, '');
}
