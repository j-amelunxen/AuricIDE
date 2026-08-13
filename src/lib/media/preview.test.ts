import { describe, expect, it, vi } from 'vitest';
import { imageDataUri, previewKind } from './preview';

describe('previewKind', () => {
  it('classifies the usual image suspects', () => {
    expect(previewKind('/p/shot.png')).toBe('image');
    expect(previewKind('/p/photo.JPG')).toBe('image');
    expect(previewKind('/p/anim.gif')).toBe('image');
    expect(previewKind('/p/icon.webp')).toBe('image');
    expect(previewKind('/p/logo.svg')).toBe('image');
  });

  it('classifies playable video files', () => {
    expect(previewKind('/p/clip.mp4')).toBe('video');
    expect(previewKind('/p/reel.webm')).toBe('video');
    expect(previewKind('/p/take.MOV')).toBe('video');
    expect(previewKind('/p/export.m4v')).toBe('video');
  });

  it('classifies pdfs and leaves everything else as text', () => {
    expect(previewKind('/p/spec.pdf')).toBe('pdf');
    expect(previewKind('/p/notes.md')).toBe('text');
    expect(previewKind('/p/app.ts')).toBe('text');
  });
});

describe('imageDataUri', () => {
  it('wraps raw base64 as a png data URI', () => {
    expect(imageDataUri('abc123', '/p/shot.png')).toBe('data:image/png;base64,abc123');
  });

  it('uses the jpeg mime for both jpg and jpeg', () => {
    expect(imageDataUri('xyz', 'photo.jpg')).toBe('data:image/jpeg;base64,xyz');
    expect(imageDataUri('xyz', 'photo.jpeg')).toBe('data:image/jpeg;base64,xyz');
  });

  it('uses the gif mime so animated gifs keep playing', () => {
    expect(imageDataUri('R0lG', 'anim.gif')).toBe('data:image/gif;base64,R0lG');
  });

  it('leaves an already-prefixed data URI alone', () => {
    const uri = 'data:image/png;base64,abc123';
    expect(imageDataUri(uri, 'shot.png')).toBe(uri);
  });
});

describe('localFileSrc', () => {
  it('uses convertFileSrc so large videos are not slurped into memory', async () => {
    vi.resetModules();
    vi.doMock('@tauri-apps/api/core', () => ({
      convertFileSrc: (path: string) => `asset://localhost${path}`,
    }));
    const { localFileSrc: src } = await import('./preview');
    await expect(src('/movies/clip.mp4')).resolves.toBe('asset://localhost/movies/clip.mp4');
    vi.doUnmock('@tauri-apps/api/core');
    vi.resetModules();
  });
});
