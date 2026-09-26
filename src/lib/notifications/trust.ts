import { scheduleIdFromDedupeKey } from './scheduleLink';
import type { NotificationSource } from './types';

/**
 * Who wrote the payload, and therefore how much of it may be believed.
 *
 * A notification's actions can decide how much authority the agent they start
 * gets — a permission mode, and whether the launch skips the spawn dialog
 * altogether. That is exactly what makes a scheduled run frictionless, and
 * exactly what must not be reachable by anything that is not the user.
 *
 * The line is the dispatcher, not the content: schedules and the app itself
 * only ever carry what a person entered in a form, while `agent` and `mcp`
 * payloads are written by a running model. So the same action shape is honoured
 * in full from a schedule and read conservatively from an agent — which means
 * an agent can still offer a Start button, it just cannot decide that the
 * button skips the dialog or hands out more permissions than the last launch.
 */
export type NotificationTrust = 'user' | 'foreign';

/**
 * Id prefix of schedules an agent created through MCP (`createSchedule` in
 * `src/mcp/notificationsDb.ts`); mirrors `MCP_SCHEDULE_ID_PREFIX` in
 * `src-tauri/src/schedules/database.rs`.
 */
const MCP_SCHEDULE_ID_PREFIX = 'mcp-';

/**
 * Sub-goal 09, review r4: until r4 the runner fired an agent's schedule as
 * `system`. Migration 8 marks those rows as `agent`, but the dev and the
 * installed build share the inbox, so an older build can still fire one as
 * `system`. The schedule id in the dedupe key does not change, so it decides.
 */
function isAgentScheduleReminder(dedupeKey: string | null): boolean {
  return scheduleIdFromDedupeKey(dedupeKey)?.startsWith(MCP_SCHEDULE_ID_PREFIX) ?? false;
}

export function notificationTrust(notification: {
  source: NotificationSource | string;
  dedupeKey: string | null;
}): NotificationTrust {
  if (isAgentScheduleReminder(notification.dedupeKey)) return 'foreign';
  const { source } = notification;
  return source === 'system' || source === 'ui' ? 'user' : 'foreign';
}
