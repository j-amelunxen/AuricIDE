import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Capture the attachCustomKeyEventHandler callback
let keyEventHandler: ((event: KeyboardEvent) => boolean) | null = null;
let resizeHandler: ((size: { rows: number; cols: number }) => void) | null = null;

const mockTerminal = {
  loadAddon: vi.fn(),
  open: vi.fn(),
  onData: vi.fn(),
  write: vi.fn(),
  dispose: vi.fn(),
  rows: 24,
  cols: 80,
  attachCustomKeyEventHandler: vi.fn((handler: (event: KeyboardEvent) => boolean) => {
    keyEventHandler = handler;
  }),
  onResize: vi.fn((handler: (size: { rows: number; cols: number }) => void) => {
    resizeHandler = handler;
  }),
};

vi.mock('@xterm/xterm', () => ({
  Terminal: function () {
    return mockTerminal;
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: function () {
    return { fit: vi.fn() };
  },
}));

const mockWriteToShell = vi.fn().mockResolvedValue(undefined);
const mockResizeShell = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/tauri/terminal', () => ({
  spawnShell: vi.fn().mockResolvedValue(undefined),
  writeToShell: (...args: unknown[]) => mockWriteToShell(...args),
  resizeShell: (...args: unknown[]) => mockResizeShell(...args),
  onTerminalOut: vi.fn().mockResolvedValue(vi.fn()),
  onTerminalErr: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock('@/lib/tauri/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/providers')>();
  return {
    ...actual,
    getPromptTemplate: vi.fn().mockRejectedValue(new Error('browser mode')),
  };
});

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
  cb(0);
  return 0;
});

Object.defineProperty(document, 'fonts', {
  value: { ready: Promise.resolve() },
  configurable: true,
});

import { XtermTerminal } from './XtermTerminal';

describe('XtermTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    keyEventHandler = null;
    resizeHandler = null;
  });

  it('registers a custom key event handler', () => {
    render(<XtermTerminal id="test-session" />);
    expect(mockTerminal.attachCustomKeyEventHandler).toHaveBeenCalledTimes(1);
    expect(keyEventHandler).toBeInstanceOf(Function);
  });

  it('CMD+I writes the prompt template from provider (fallback)', () => {
    render(<XtermTerminal id="test-session" />);
    expect(keyEventHandler).not.toBeNull();

    const event = new KeyboardEvent('keydown', { key: 'i', metaKey: true });
    const result = keyEventHandler!(event);

    expect(result).toBe(false);
    expect(mockWriteToShell).toHaveBeenCalledTimes(1);
    // In test env, getPromptTemplate rejects so fallback is used
    expect(mockWriteToShell).toHaveBeenCalledWith('test-session', 'crush "');
  });

  it('does not intercept regular keys', () => {
    render(<XtermTerminal id="test-session" />);

    const event = new KeyboardEvent('keydown', { key: 'a' });
    const result = keyEventHandler!(event);

    expect(result).toBe(true);
    expect(mockWriteToShell).not.toHaveBeenCalled();
  });

  it('does not intercept CMD+other keys', () => {
    render(<XtermTerminal id="test-session" />);

    const event = new KeyboardEvent('keydown', { key: 'c', metaKey: true });
    const result = keyEventHandler!(event);

    expect(result).toBe(true);
  });

  it('loads only the FitAddon on open', () => {
    render(<XtermTerminal id="test-session" />);
    expect(mockTerminal.loadAddon).toHaveBeenCalledTimes(1);
    expect(mockTerminal.loadAddon).toHaveBeenCalledWith({ fit: expect.any(Function) });
  });

  it('registers an onResize handler', () => {
    render(<XtermTerminal id="test-session" />);
    expect(mockTerminal.onResize).toHaveBeenCalledTimes(1);
    expect(resizeHandler).toBeInstanceOf(Function);
  });

  it('calls resizeShell when onResize fires', () => {
    render(<XtermTerminal id="test-session" />);
    expect(resizeHandler).not.toBeNull();

    resizeHandler!({ rows: 50, cols: 120 });
    expect(mockResizeShell).toHaveBeenCalledWith('test-session', 50, 120);
  });
});
