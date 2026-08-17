/**
 * The one link between a schedule and the notifications it raised.
 *
 * It goes through the dedupe key — `schedule:<id>:<utc occurrence>`, written
 * in Rust (`schedules.rs`) — and never through `origin`, which carries the
 * schedule's *name*. A name is the user's to change at any moment, and a
 * renamed schedule that loses its own firing history would look like one that
 * never fired. The id does not move.
 *
 * The occurrence half is read back by `scheduleOccurrenceMs` in
 * `src/lib/conductor/scheduledRun.ts`; both sides are tested against
 * `scheduleDedupeKey.fixtures.json`, so the format cannot drift on one end.
 */

/**
 * Greedy on purpose: an id may itself contain colons, and the timestamp tail
 * is what pins where the id ends.
 */
const SCHEDULE_DEDUPE_KEY = /^schedule:(.+):\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** The schedule a notification came from, or null when it came from elsewhere. */
export function scheduleIdFromDedupeKey(dedupeKey: string | null): string | null {
  if (dedupeKey === null) return null;
  const match = SCHEDULE_DEDUPE_KEY.exec(dedupeKey);
  return match === null ? null : match[1];
}
