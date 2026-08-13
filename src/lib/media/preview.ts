export type PreviewKind = 'image' | 'video' | 'pdf' | 'text';

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

export function fileExtension(path: string): string {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function previewKind(path: string): PreviewKind {
  const ext = fileExtension(path);
  if (ext in IMAGE_MIME) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  return 'text';
}

/** Turns raw `readFileBase64` output into an `<img src>` the webview can paint. */
export function imageDataUri(base64: string, path: string): string {
  if (base64.startsWith('data:')) return base64;
  const ext = fileExtension(path);
  const mime = IMAGE_MIME[ext] ?? 'application/octet-stream';
  return `data:${mime};base64,${base64}`;
}

/**
 * URL for a local file the webview can stream (videos, large media).
 * Falls back to the raw path in browser/test mode.
 */
export async function localFileSrc(path: string): Promise<string> {
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core');
    return convertFileSrc(path);
  } catch {
    return path;
  }
}
