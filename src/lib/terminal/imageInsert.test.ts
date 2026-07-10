import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Capture the drag-drop handler registered on the Tauri webview
let dragDropHandler: ((event: { payload: DragDropPayload }) => void) | null = null;
const mockUnlistenDragDrop = vi.fn();
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async (handler: (event: { payload: DragDropPayload }) => void) => {
      dragDropHandler = handler;
      return mockUnlistenDragDrop;
    }),
  }),
}));

type DragDropPayload =
  | { type: 'enter'; paths: string[]; position: { x: number; y: number } }
  | { type: 'over'; position: { x: number; y: number } }
  | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
  | { type: 'leave' };

import {
  extractImageFiles,
  shellQuotePath,
  buildPathInsert,
  saveTempImage,
  attachImagePaste,
  attachFileDrop,
} from './imageInsert';

function makeImageFile(name = 'shot.png', type = 'image/png'): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type });
}

function makeClipboardData(files: File[], withText = false): DataTransfer {
  const items = files.map((file) => ({
    kind: 'file',
    type: file.type,
    getAsFile: () => file,
  }));
  if (withText) {
    items.push({
      kind: 'string',
      type: 'text/plain',
      getAsFile: () => null,
    } as unknown as (typeof items)[number]);
  }
  return { items } as unknown as DataTransfer;
}

function makePasteEvent(clipboardData: DataTransfer | null): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  return event;
}

describe('extractImageFiles', () => {
  it('returns image files from clipboard data', () => {
    const file = makeImageFile();
    const files = extractImageFiles(makeClipboardData([file]));
    expect(files).toEqual([file]);
  });

  it('ignores non-image items', () => {
    const files = extractImageFiles(makeClipboardData([], true));
    expect(files).toEqual([]);
  });

  it('returns empty array for null clipboard data', () => {
    expect(extractImageFiles(null)).toEqual([]);
  });
});

describe('shellQuotePath', () => {
  it('leaves simple paths unquoted', () => {
    expect(shellQuotePath('/tmp/screenshot_123.png')).toBe('/tmp/screenshot_123.png');
  });

  it('quotes paths with spaces', () => {
    expect(shellQuotePath('/tmp/my image.png')).toBe("'/tmp/my image.png'");
  });

  it('escapes single quotes inside paths', () => {
    expect(shellQuotePath("/tmp/it's.png")).toBe("'/tmp/it'\\''s.png'");
  });
});

describe('buildPathInsert', () => {
  it('joins quoted paths with a trailing space', () => {
    expect(buildPathInsert(['/tmp/a.png', '/tmp/b c.png'])).toBe("/tmp/a.png '/tmp/b c.png' ");
  });
});

describe('saveTempImage', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('sends the file as base64 data URL to save_temp_image and returns the path', async () => {
    mockInvoke.mockResolvedValue('/cache/screenshot_1.png');
    const path = await saveTempImage(makeImageFile());
    expect(path).toBe('/cache/screenshot_1.png');
    expect(mockInvoke).toHaveBeenCalledWith('save_temp_image', {
      base64Data: expect.stringMatching(/^data:image\/png;base64,/),
    });
  });
});

describe('attachImagePaste', () => {
  let container: HTMLDivElement;
  let sendText: ReturnType<typeof vi.fn<(text: string) => void>>;

  beforeEach(() => {
    mockInvoke.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    sendText = vi.fn<(text: string) => void>();
  });

  it('saves pasted images and sends their paths to the terminal', async () => {
    mockInvoke.mockResolvedValue('/cache/screenshot_1.png');
    const detach = attachImagePaste(container, sendText);

    const event = makePasteEvent(makeClipboardData([makeImageFile()]));
    container.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledWith('/cache/screenshot_1.png ');
    });
    expect(event.defaultPrevented).toBe(true);
    detach();
  });

  it('does not intercept text-only pastes', () => {
    const detach = attachImagePaste(container, sendText);

    const event = makePasteEvent(makeClipboardData([], true));
    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(sendText).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
    detach();
  });

  it('stops intercepting after detach', () => {
    const detach = attachImagePaste(container, sendText);
    detach();

    const event = makePasteEvent(makeClipboardData([makeImageFile()]));
    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('swallows IPC failures (browser mode)', async () => {
    mockInvoke.mockRejectedValue(new Error('not in tauri'));
    const detach = attachImagePaste(container, sendText);

    container.dispatchEvent(makePasteEvent(makeClipboardData([makeImageFile()])));

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });
    expect(sendText).not.toHaveBeenCalled();
    detach();
  });
});

describe('attachFileDrop', () => {
  let container: HTMLDivElement;
  let sendText: ReturnType<typeof vi.fn<(text: string) => void>>;
  let onDragState: ReturnType<typeof vi.fn<(inside: boolean) => void>>;

  beforeEach(() => {
    dragDropHandler = null;
    mockUnlistenDragDrop.mockReset();
    container = document.createElement('div');
    // jsdom has no layout — stub the rect the hit test reads
    container.getBoundingClientRect = () =>
      ({ left: 0, top: 100, right: 400, bottom: 300 }) as DOMRect;
    document.body.appendChild(container);
    sendText = vi.fn<(text: string) => void>();
    onDragState = vi.fn<(inside: boolean) => void>();
  });

  it('sends dropped file paths when the drop lands inside the container', async () => {
    const detach = attachFileDrop(container, sendText, onDragState);
    await vi.waitFor(() => expect(dragDropHandler).not.toBeNull());

    dragDropHandler!({
      payload: { type: 'drop', paths: ['/Users/j/pic.png'], position: { x: 50, y: 200 } },
    });

    expect(sendText).toHaveBeenCalledWith('/Users/j/pic.png ');
    detach();
  });

  it('ignores drops outside the container', async () => {
    const detach = attachFileDrop(container, sendText, onDragState);
    await vi.waitFor(() => expect(dragDropHandler).not.toBeNull());

    dragDropHandler!({
      payload: { type: 'drop', paths: ['/Users/j/pic.png'], position: { x: 50, y: 10 } },
    });

    expect(sendText).not.toHaveBeenCalled();
    detach();
  });

  it('scales physical drop positions by devicePixelRatio', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const detach = attachFileDrop(container, sendText, onDragState);
    await vi.waitFor(() => expect(dragDropHandler).not.toBeNull());

    // Physical (100, 400) → logical (50, 200): inside
    dragDropHandler!({
      payload: { type: 'drop', paths: ['/a.png'], position: { x: 100, y: 400 } },
    });

    expect(sendText).toHaveBeenCalledWith('/a.png ');
    vi.unstubAllGlobals();
    detach();
  });

  it('reports drag-over state transitions for the hover highlight', async () => {
    const detach = attachFileDrop(container, sendText, onDragState);
    await vi.waitFor(() => expect(dragDropHandler).not.toBeNull());

    dragDropHandler!({ payload: { type: 'over', position: { x: 50, y: 200 } } });
    expect(onDragState).toHaveBeenLastCalledWith(true);

    dragDropHandler!({ payload: { type: 'over', position: { x: 50, y: 10 } } });
    expect(onDragState).toHaveBeenLastCalledWith(false);

    dragDropHandler!({ payload: { type: 'leave' } });
    expect(onDragState).toHaveBeenLastCalledWith(false);

    dragDropHandler!({
      payload: { type: 'drop', paths: ['/a.png'], position: { x: 50, y: 200 } },
    });
    expect(onDragState).toHaveBeenLastCalledWith(false);
    detach();
  });

  it('unregisters the webview listener on detach', async () => {
    const detach = attachFileDrop(container, sendText, onDragState);
    await vi.waitFor(() => expect(dragDropHandler).not.toBeNull());

    detach();
    expect(mockUnlistenDragDrop).toHaveBeenCalled();
  });
});
