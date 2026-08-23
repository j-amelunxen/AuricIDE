import type { InboxAttachment, InboxAttachmentKind, InboxItem } from '@/lib/tauri/inbox';

/**
 * What may hang off an inbox item, by extension.
 *
 * The twin of the three lists in `src-tauri/src/inbox.rs`; both are tested
 * against `attachmentKinds.fixtures.json`, because this side decides what the
 * picker and the drop target offer and that side decides what is accepted. A
 * disagreement is a file the user can select and then watch bounce.
 *
 * `previewKind` is deliberately not reused here: it answers "how would the
 * viewer paint this", and its answer for an unknown extension is `text` — a
 * `.zip` would become an attachment nobody can read.
 */
export const INBOX_IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'bmp',
  'ico',
  'avif',
] as const;
export const INBOX_VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'ogv'] as const;
export const INBOX_TEXT_EXTENSIONS = ['md', 'markdown', 'txt', 'text', 'eml', 'log'] as const;

export const INBOX_MEDIA_EXTENSIONS = [
  ...INBOX_IMAGE_EXTENSIONS,
  ...INBOX_VIDEO_EXTENSIONS,
] as const;

export const INBOX_ATTACHMENT_EXTENSIONS = [
  ...INBOX_MEDIA_EXTENSIONS,
  ...INBOX_TEXT_EXTENSIONS,
] as const;

function extensionOf(path: string): string {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** What kind of attachment a path would become, or null if it cannot be one. */
export function inboxAttachmentKind(path: string): InboxAttachmentKind | null {
  const ext = extensionOf(path);
  if ((INBOX_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image';
  if ((INBOX_VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return 'video';
  if ((INBOX_TEXT_EXTENSIONS as readonly string[]).includes(ext)) return 'text';
  return null;
}

/** Images and videos only — for the media picker, which filters to those. */
export function inboxMediaKind(path: string): 'image' | 'video' | null {
  const kind = inboxAttachmentKind(path);
  return kind === 'text' ? null : kind;
}

export function isInboxMediaPath(path: string): boolean {
  return inboxMediaKind(path) !== null;
}

/** Whether a dropped path is attachable at all — text documents included. */
export function isInboxAttachmentPath(path: string): boolean {
  return inboxAttachmentKind(path) !== null;
}

export function inboxAttachments(
  item: Pick<InboxItem, 'attachments'> | InboxItem
): InboxAttachment[] {
  return item.attachments ?? [];
}

/** The attachable paths in a drop, in the order they were dropped. */
export function inboxMediaPathsFromFileList(
  files: Array<{ name: string; path?: string }>
): string[] {
  return files
    .map((file) => file.path || file.name)
    .filter((path) => path.length > 0 && isInboxAttachmentPath(path));
}

export async function pickInboxMediaFiles(): Promise<string[]> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: true,
      filters: [
        { name: 'Attachments', extensions: [...INBOX_ATTACHMENT_EXTENSIONS] },
        { name: 'Images and videos', extensions: [...INBOX_MEDIA_EXTENSIONS] },
        { name: 'Text documents', extensions: [...INBOX_TEXT_EXTENSIONS] },
      ],
    });
    if (selected === null) return [];
    const paths = Array.isArray(selected) ? selected : [selected];
    return paths.filter(isInboxAttachmentPath);
  } catch {
    return [];
  }
}

export function attachmentFileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}
