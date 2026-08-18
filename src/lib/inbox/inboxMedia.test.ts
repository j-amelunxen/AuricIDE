import { describe, expect, it } from 'vitest';
import {
  inboxAttachments,
  inboxMediaKind,
  inboxMediaPathsFromFileList,
  isInboxMediaPath,
} from './inboxMedia';
import type { InboxAttachment, InboxItem } from '@/lib/tauri/inbox';

function attachment(overrides: Partial<InboxAttachment> = {}): InboxAttachment {
  return {
    id: 'att-1',
    itemId: 'item-1',
    kind: 'image',
    fileName: 'shot.png',
    storedPath: '/app/inbox-attachments/item-1/shot.png',
    createdAt: '2026-08-18 00:00:00',
    ...overrides,
  };
}

describe('inboxMediaKind', () => {
  it('accepts the same images the rest of the IDE can preview', () => {
    expect(inboxMediaKind('/p/shot.png')).toBe('image');
    expect(inboxMediaKind('/p/photo.JPG')).toBe('image');
    expect(inboxMediaKind('/p/clip.mp4')).toBe('video');
    expect(inboxMediaKind('/p/take.MOV')).toBe('video');
  });

  it('rejects everything that is not an image or a video', () => {
    expect(inboxMediaKind('/p/notes.md')).toBeNull();
    expect(inboxMediaKind('/p/spec.pdf')).toBeNull();
    expect(inboxMediaKind('/p/app.ts')).toBeNull();
  });
});

describe('isInboxMediaPath', () => {
  it('is true only for image and video paths', () => {
    expect(isInboxMediaPath('bug.png')).toBe(true);
    expect(isInboxMediaPath('walkthrough.webm')).toBe(true);
    expect(isInboxMediaPath('readme.md')).toBe(false);
  });
});

describe('inboxAttachments', () => {
  it('returns the stored list when the backend sent one', () => {
    const item = { attachments: [attachment()] } as InboxItem;
    expect(inboxAttachments(item)).toEqual([attachment()]);
  });

  it('treats a missing list as empty so older fixtures keep working', () => {
    const item = {} as InboxItem;
    expect(inboxAttachments(item)).toEqual([]);
  });
});

describe('inboxMediaPathsFromFileList', () => {
  it('keeps only image and video paths', () => {
    expect(
      inboxMediaPathsFromFileList([
        { name: 'shot.png', path: '/tmp/shot.png' },
        { name: 'notes.md', path: '/tmp/notes.md' },
        { name: 'clip.mp4', path: '/tmp/clip.mp4' },
      ])
    ).toEqual(['/tmp/shot.png', '/tmp/clip.mp4']);
  });

  it('falls back to the file name when no path is present', () => {
    expect(inboxMediaPathsFromFileList([{ name: 'shot.png' }])).toEqual(['shot.png']);
  });
});
