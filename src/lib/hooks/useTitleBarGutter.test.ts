import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TITLEBAR_ATTRIBUTE, TITLEBAR_OVERLAY_VALUE } from '@/lib/platform/titlebar';
import { useTitleBarGutter } from './useTitleBarGutter';

const isFullscreen = vi.fn(async () => false);
const unlisten = vi.fn();
let onResized: (() => void) | null = null;

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFullscreen,
    onResized: async (cb: () => void) => {
      onResized = cb;
      return unlisten;
    },
  }),
}));

/** Makes the environment look like the desktop shell on macOS. */
function pretendMacDesktop() {
  (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  Object.defineProperty(window.navigator, 'platform', {
    value: 'MacIntel',
    configurable: true,
  });
}

describe('useTitleBarGutter', () => {
  beforeEach(() => {
    isFullscreen.mockResolvedValue(false);
    onResized = null;
    vi.clearAllMocks();
    document.documentElement.removeAttribute(TITLEBAR_ATTRIBUTE);
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('keeps the gutter while the window shows its title bar', async () => {
    pretendMacDesktop();
    document.documentElement.setAttribute(TITLEBAR_ATTRIBUTE, TITLEBAR_OVERLAY_VALUE);

    renderHook(() => useTitleBarGutter());

    await waitFor(() => expect(isFullscreen).toHaveBeenCalled());
    expect(document.documentElement.getAttribute(TITLEBAR_ATTRIBUTE)).toBe(TITLEBAR_OVERLAY_VALUE);
  });

  it('drops the gutter in fullscreen, where macOS hides the traffic lights', async () => {
    pretendMacDesktop();
    document.documentElement.setAttribute(TITLEBAR_ATTRIBUTE, TITLEBAR_OVERLAY_VALUE);
    isFullscreen.mockResolvedValue(true);

    renderHook(() => useTitleBarGutter());

    await waitFor(() =>
      expect(document.documentElement.hasAttribute(TITLEBAR_ATTRIBUTE)).toBe(false)
    );
  });

  it('puts the gutter back when the window leaves fullscreen', async () => {
    pretendMacDesktop();
    isFullscreen.mockResolvedValue(true);

    renderHook(() => useTitleBarGutter());
    await waitFor(() => expect(onResized).not.toBeNull());
    await waitFor(() =>
      expect(document.documentElement.hasAttribute(TITLEBAR_ATTRIBUTE)).toBe(false)
    );

    isFullscreen.mockResolvedValue(false);
    onResized?.();

    await waitFor(() =>
      expect(document.documentElement.getAttribute(TITLEBAR_ATTRIBUTE)).toBe(TITLEBAR_OVERLAY_VALUE)
    );
  });

  it('does nothing where the title bar was never an overlay', async () => {
    // Browser mode: no attribute was ever set, and asking the window about
    // fullscreen would only import a bridge that is not there.
    renderHook(() => useTitleBarGutter());

    await Promise.resolve();
    expect(isFullscreen).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute(TITLEBAR_ATTRIBUTE)).toBe(false);
  });

  it('stops listening when the app unmounts', async () => {
    pretendMacDesktop();
    const { unmount } = renderHook(() => useTitleBarGutter());
    await waitFor(() => expect(onResized).not.toBeNull());

    unmount();
    expect(unlisten).toHaveBeenCalled();
  });
});
