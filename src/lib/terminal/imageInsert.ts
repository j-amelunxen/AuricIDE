import { invoke } from '../tauri/invoke';

/**
 * Warp-style image handling for terminals: pasting an image saves it to the
 * app cache and inserts its file path; dropping files inserts their paths.
 * CLI agents (Claude Code etc.) pick the path up as an image attachment.
 */

export function extractImageFiles(data: DataTransfer | null): File[] {
  if (!data?.items) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

export function shellQuotePath(path: string): string {
  if (/^[A-Za-z0-9_\-./~]+$/.test(path)) return path;
  return `'${path.replace(/'/g, "'\\''")}'`;
}

export function buildPathInsert(paths: string[]): string {
  return paths.map(shellQuotePath).join(' ') + ' ';
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Persist a pasted image into the app cache; returns the absolute file path. */
export async function saveTempImage(file: File): Promise<string> {
  const base64Data = await fileToDataUrl(file);
  return invoke<string>('save_temp_image', { base64Data });
}

/**
 * Intercept image pastes on a terminal container (capture phase, so it runs
 * before xterm's own paste handler). Text pastes pass through untouched.
 */
export function attachImagePaste(
  container: HTMLElement,
  sendText: (text: string) => void
): () => void {
  const onPaste = (event: Event) => {
    const images = extractImageFiles((event as ClipboardEvent).clipboardData);
    if (images.length === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    Promise.all(images.map(saveTempImage))
      .then((paths) => sendText(buildPathInsert(paths)))
      .catch(() => {
        // Browser mode / IPC failure — nothing sensible to insert
      });
  };
  container.addEventListener('paste', onPaste, true);
  return () => container.removeEventListener('paste', onPaste, true);
}

interface DragDropPosition {
  x: number;
  y: number;
}

/**
 * Insert dropped file paths into the terminal. Tauri swallows HTML5 file
 * drops, so this listens to the webview drag-drop event and hit-tests the
 * (physical-pixel) drop position against the container.
 *
 * `onInsert` fires only when a path actually went in — a native drag moves no
 * keyboard focus, so the caller uses it to hand the keyboard to the terminal
 * the path landed in. Without that, the prompt holds the path but Enter goes
 * elsewhere until the user clicks in.
 */
export function attachFileDrop(
  container: HTMLElement,
  sendText: (text: string) => void,
  onDragState?: (inside: boolean) => void,
  onInsert?: () => void
): () => void {
  let unlisten: (() => void) | undefined;
  let disposed = false;

  const isInside = (position: DragDropPosition): boolean => {
    const scale = window.devicePixelRatio || 1;
    const x = position.x / scale;
    const y = position.y / scale;
    const rect = container.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
    // Rects alone can't distinguish stacked terminal tabs (inactive ones are
    // invisible + pointer-events-none but keep their layout box) — resolve
    // the actual element under the cursor when the DOM can tell us.
    const hit = typeof document.elementFromPoint === 'function' && document.elementFromPoint(x, y);
    return hit ? container.contains(hit) : true;
  };

  (async () => {
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      const un = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'enter' || payload.type === 'over') {
          onDragState?.(isInside(payload.position));
        } else if (payload.type === 'drop') {
          onDragState?.(false);
          if (payload.paths.length > 0 && isInside(payload.position)) {
            sendText(buildPathInsert(payload.paths));
            onInsert?.();
          }
        } else {
          onDragState?.(false);
        }
      });
      if (disposed) un();
      else unlisten = un;
    } catch {
      // Browser mode — no native drag-drop events available
    }
  })();

  return () => {
    disposed = true;
    unlisten?.();
  };
}
