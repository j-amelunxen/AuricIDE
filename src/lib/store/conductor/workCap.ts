/** Same ceiling as the schedule editor's "Tickets per run" field. */
export const CONDUCTOR_WORK_CAP_MAX = 50;

/**
 * A blank, zero, or junk value means no limit. Anything above the ceiling
 * becomes the ceiling, so a typo cannot ask the run to start thousands.
 */
export function normalizeConductorWorkCap(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 1) return null;
  return Math.min(CONDUCTOR_WORK_CAP_MAX, Math.trunc(value));
}
