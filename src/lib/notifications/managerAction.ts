import type { NotificationAction } from './types';

export type OpenManagerAction = Extract<NotificationAction, { kind: 'open-manager' }>;

/**
 * The one way an `open-manager` action is written: the schedule form and the
 * session-end reminder both go through here, so the label, the id and the
 * "blank text is no task" rule cannot differ between them.
 */
export function managerAction(
  manager: { key: string; name: string },
  options: { task?: string; launch?: OpenManagerAction['launch'] } = {}
): OpenManagerAction {
  const task = options.task?.trim();
  return {
    id: 'open',
    label: `Open ${manager.name}`,
    kind: 'open-manager',
    managerKey: manager.key,
    managerName: manager.name,
    ...(task ? { task } : {}),
    ...(options.launch ? { launch: options.launch } : {}),
  };
}
