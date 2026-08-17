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

export function notificationTrust(source: NotificationSource | string): NotificationTrust {
  return source === 'system' || source === 'ui' ? 'user' : 'foreign';
}
