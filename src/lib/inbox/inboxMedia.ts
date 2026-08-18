import { previewKind } from '@/lib/media/preview';
import type { InboxAttachment, InboxItem } from '@/lib/tauri/inbox';

export const INBOX_MEDIA_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'bmp',
  'ico',
  'avif',
  'mp4',
  'webm',
  'mov',
  'm4v',
  'ogv',
] as const;

export type InboxMediaKind = 'image' | 'video';

/** Images and videos only — a PDF or a source file is not an inbox attachment. */
export function inboxMediaKind(path: string): InboxMediaKind | null {
  const kind = previewKind(path);
  if (kind === 'image' || kind === 'video') return kind;
  return null;
}

export function isInboxMediaPath(path: string): boolean {
  return inboxMediaKind(path) !== null;
}

export function inboxAttachments(
  item: Pick<InboxItem, 'attachments'> | InboxItem
): InboxAttachment[] {
  return item.attachments ?? [];
}

/**
 * Where an inbox attachment lands inside the project once the item becomes a
 * ticket. The folder is under `.auric/` so it is gitignored with everything
 * else there; the ticket id keeps two assigned items from colliding.
 */
export function inboxMediaPathsFromFileList(
  files: Array<{ name: string; path?: string }>
): string[] {
  return files
    .map((file) => file.path || file.name)
    .filter((path) => path.length > 0 && isInboxMediaPath(path));
}

export async function pickInboxMediaFiles(): Promise<string[]> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Images and videos', extensions: [...INBOX_MEDIA_EXTENSIONS] }],
    });
    if (selected === null) return [];
    const paths = Array.isArray(selected) ? selected : [selected];
    return paths.filter(isInboxMediaPath);
  } catch {
    return [];
  }
}

export function attachmentFileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}
