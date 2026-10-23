import type { ContextMenuOption } from '../ide/ContextMenu';

export interface ManagerMenuActions {
  open: () => void;
  ask: () => void;
  editInstructions: () => void;
  rename: () => void;
  showInFinder: () => void;
  validateMemory: () => void;
  archive: () => void;
  restore: () => void;
  remove: () => void;
}

/**
 * The registry could not be read, so nothing may write to it. The sentence is
 * the reason shown under each item that is off, rather than a silent grey.
 */
const writes = (blockedReason: string | undefined) => ({ disabledReason: blockedReason });

/** Archived managers can only come back or go. */
function archivedManagerMenu(
  blockedReason: string | undefined,
  actions: Pick<ManagerMenuActions, 'restore' | 'remove'>
): ContextMenuOption[] {
  return [
    { label: 'Restore', icon: 'undo', action: actions.restore, ...writes(blockedReason) },
    {
      label: 'Remove Project Manager…',
      icon: 'delete',
      danger: true,
      action: actions.remove,
      ...writes(blockedReason),
    },
  ];
}

/** A manager's menu. Archived ones can only come back or go. */
export function managerMenu(
  name: string,
  archived: boolean,
  blockedReason: string | undefined,
  actions: ManagerMenuActions
): ContextMenuOption[] {
  if (archived) {
    return archivedManagerMenu(blockedReason, actions);
  }
  return [
    { label: 'Open', icon: 'open_in_new', action: actions.open },
    { label: `Ask ${name}…`, icon: 'send', action: actions.ask },
    { label: 'Edit Instructions', icon: 'edit', action: actions.editInstructions },
    { label: 'Rename…', icon: 'edit_note', action: actions.rename, ...writes(blockedReason) },
    { label: 'Show in Finder', icon: 'folder', action: actions.showInFinder },
    { label: 'Validate Memory', icon: 'check_circle', action: actions.validateMemory },
    { type: 'separator' },
    { label: 'Archive…', icon: 'archive', action: actions.archive, ...writes(blockedReason) },
  ];
}

export type MissingManagerMenuActions = Pick<ManagerMenuActions, 'archive' | 'restore' | 'remove'>;

/**
 * A manager whose folder is gone: nothing that needs the folder is offered,
 * only the way out. Archived ones can also come back, as any archived manager.
 */
export function missingManagerMenu(
  archived: boolean,
  blockedReason: string | undefined,
  actions: MissingManagerMenuActions
): ContextMenuOption[] {
  if (archived) {
    return archivedManagerMenu(blockedReason, actions);
  }
  return [
    { label: 'Archive…', icon: 'archive', action: actions.archive, ...writes(blockedReason) },
  ];
}

/** An ordinary run's menu: the one way to make it a Project Manager. */
export function runMenu(
  blockedReason: string | undefined,
  promote: () => void
): ContextMenuOption[] {
  return [
    {
      label: 'Promote to Project Manager…',
      icon: 'push_pin',
      action: promote,
      ...writes(blockedReason),
    },
  ];
}
