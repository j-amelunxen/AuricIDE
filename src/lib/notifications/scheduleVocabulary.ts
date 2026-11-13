/**
 * The words a schedule is stored with. Rust's engine reads the same ones
 * (`schedules::types`); `backendNames.fixtures.json` pins both sides.
 */
export const SCHEDULE_SPEC_KINDS = ['cron', 'every'] as const;
export const SCHEDULE_EVERY_UNITS = ['hour', 'day', 'week'] as const;
/**
 * What happens to occurrences that came due while AuricIDE was closed.
 *
 * `coalesce` is the default because three weeks away should not produce three
 * identical reminders — one that says how overdue it is carries more and costs
 * less attention.
 */
export const SCHEDULE_CATCH_UPS = ['coalesce', 'skip', 'all'] as const;

/** How a schedule repeats. */
export type ScheduleSpecKind = (typeof SCHEDULE_SPEC_KINDS)[number];
export type ScheduleEveryUnit = (typeof SCHEDULE_EVERY_UNITS)[number];
export type ScheduleCatchUp = (typeof SCHEDULE_CATCH_UPS)[number];
