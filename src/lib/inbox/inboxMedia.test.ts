import { describe, expect, it } from 'vitest';
import {
  INBOX_IMAGE_EXTENSIONS,
  INBOX_TEXT_EXTENSIONS,
  INBOX_VIDEO_EXTENSIONS,
  inboxAttachmentKind,
  inboxAttachments,
  inboxMediaKind,
  inboxMediaPathsFromFileList,
  isInboxMediaPath,
} from './inboxMedia';
import attachmentKinds from './attachmentKinds.fixtures.json';
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
  it('keeps image, video and text paths and drops the rest', () => {
    expect(
      inboxMediaPathsFromFileList([
        { name: 'shot.png', path: '/tmp/shot.png' },
        { name: 'notes.md', path: '/tmp/notes.md' },
        { name: 'bundle.zip', path: '/tmp/bundle.zip' },
        { name: 'clip.mp4', path: '/tmp/clip.mp4' },
      ])
    ).toEqual(['/tmp/shot.png', '/tmp/notes.md', '/tmp/clip.mp4']);
  });

  it('falls back to the file name when no path is present', () => {
    expect(inboxMediaPathsFromFileList([{ name: 'shot.png' }])).toEqual(['shot.png']);
  });
});

describe('attachment kinds agree with the shared fixture', () => {
  // The Rust twin (`src-tauri/src/inbox.rs`) asserts the same file. A list
  // that drifts here means the picker offers a file the backend refuses.
  const fixture = attachmentKinds as Record<string, string[]>;

  it('matches the fixture for images', () => {
    expect([...INBOX_IMAGE_EXTENSIONS]).toEqual(fixture.image);
  });

  it('matches the fixture for videos', () => {
    expect([...INBOX_VIDEO_EXTENSIONS]).toEqual(fixture.video);
  });

  it('matches the fixture for text documents', () => {
    expect([...INBOX_TEXT_EXTENSIONS]).toEqual(fixture.text);
  });
});

describe('inboxAttachmentKind', () => {
  it('recognises a pasted or dropped text document', () => {
    expect(inboxAttachmentKind('/tmp/thread.eml')).toBe('text');
    expect(inboxAttachmentKind('notes.MD')).toBe('text');
  });

  it('still recognises media', () => {
    expect(inboxAttachmentKind('shot.png')).toBe('image');
    expect(inboxAttachmentKind('clip.mp4')).toBe('video');
  });

  it('refuses anything else, rather than calling it text', () => {
    expect(inboxAttachmentKind('bundle.zip')).toBeNull();
    expect(inboxAttachmentKind('report.pdf')).toBeNull();
    expect(inboxAttachmentKind('Makefile')).toBeNull();
    expect(inboxAttachmentKind('.gitignore')).toBeNull();
  });

  it('keeps the media-only helper media-only, for the media picker', () => {
    expect(inboxMediaKind('thread.eml')).toBeNull();
    expect(inboxMediaKind('shot.png')).toBe('image');
  });
});

describe('inboxMediaPathsFromFileList', () => {
  it('accepts a dropped email beside a dropped screenshot', () => {
    expect(
      inboxMediaPathsFromFileList([
        { name: 'shot.png', path: '/a/shot.png' },
        { name: 'mail.eml', path: '/a/mail.eml' },
        { name: 'bundle.zip', path: '/a/bundle.zip' },
      ])
    ).toEqual(['/a/shot.png', '/a/mail.eml']);
  });
});
