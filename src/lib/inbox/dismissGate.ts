import type { InboxItem } from '@/lib/tauri/inbox';

/**
 * A bare unsorted item is disposable — dismissing it loses nothing worth a
 * prompt. An item that carries notes or is already assigned to a project
 * (with a real ticket behind it) is not, so those confirm first.
 */
export function needsDismissConfirm(item: Pick<InboxItem, 'notes' | 'projectPath'>): boolean {
  return item.notes.trim() !== '' || item.projectPath !== null;
}
