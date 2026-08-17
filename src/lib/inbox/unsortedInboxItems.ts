import type { InboxItem } from '@/lib/tauri/inbox';

/** The items still waiting to be sorted into a project. */
export function unsortedInboxItems(items: InboxItem[]): InboxItem[] {
  return items.filter((item) => item.projectPath === null);
}
