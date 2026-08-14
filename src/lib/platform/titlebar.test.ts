import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TITLEBAR_ATTRIBUTE,
  TITLEBAR_BOOT_SCRIPT,
  TITLEBAR_OVERLAY_VALUE,
  TITLEBAR_ROW_HEIGHT,
  TRAFFIC_LIGHT_BUTTON_HEIGHT,
  TRAFFIC_LIGHT_GUTTER,
  TRAFFIC_LIGHT_INSET_X,
  TRAFFIC_LIGHT_INSET_Y,
  isOverlayTitleBar,
  setTitleBarOverlay,
} from './titlebar';

const MAC = { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const WINDOWS = { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

describe('isOverlayTitleBar', () => {
  it('is on inside the desktop shell on macOS', () => {
    expect(isOverlayTitleBar({ __TAURI_INTERNALS__: {}, navigator: MAC })).toBe(true);
  });

  it('is off in the browser, where there is no window chrome to make room for', () => {
    expect(isOverlayTitleBar({ navigator: MAC })).toBe(false);
  });

  it('is off on Windows, which keeps its native title bar', () => {
    expect(isOverlayTitleBar({ __TAURI_INTERNALS__: {}, navigator: WINDOWS })).toBe(false);
  });

  it('falls back to the user agent when the platform string is gone', () => {
    expect(
      isOverlayTitleBar({ __TAURI_INTERNALS__: {}, navigator: { userAgent: MAC.userAgent } })
    ).toBe(true);
  });

  it('survives a window without a navigator at all', () => {
    expect(isOverlayTitleBar({ __TAURI_INTERNALS__: {} })).toBe(false);
    expect(isOverlayTitleBar(undefined)).toBe(false);
  });
});

/** Runs the head script against a stand-in window, returning the attribute it set. */
function runBootScript(win: Record<string, unknown>, nav: Record<string, unknown>): string | null {
  let attribute: string | null = null;
  const doc = {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        if (name === TITLEBAR_ATTRIBUTE) attribute = value;
      },
    },
  };
  new Function('window', 'navigator', 'document', TITLEBAR_BOOT_SCRIPT)(win, nav, doc);
  return attribute;
}

describe('TITLEBAR_BOOT_SCRIPT', () => {
  it('marks the document before first paint on desktop macOS', () => {
    expect(runBootScript({ __TAURI_INTERNALS__: {} }, MAC)).toBe(TITLEBAR_OVERLAY_VALUE);
  });

  it('leaves the document alone in the browser', () => {
    expect(runBootScript({}, MAC)).toBeNull();
  });

  it('leaves the document alone on Windows', () => {
    expect(runBootScript({ __TAURI_INTERNALS__: {} }, WINDOWS)).toBeNull();
  });

  it('agrees with isOverlayTitleBar rather than drifting from it', () => {
    const cases = [
      { win: { __TAURI_INTERNALS__: {} }, nav: MAC },
      { win: { __TAURI_INTERNALS__: {} }, nav: WINDOWS },
      { win: {}, nav: MAC },
      { win: {}, nav: WINDOWS },
    ];
    for (const { win, nav } of cases) {
      const scriptSaysOverlay = runBootScript(win, nav) === TITLEBAR_OVERLAY_VALUE;
      expect(scriptSaysOverlay).toBe(isOverlayTitleBar({ ...win, navigator: nav }));
    }
  });

  it('cannot throw the head script — a broken navigator must not stop the app booting', () => {
    expect(() =>
      new Function('window', 'navigator', 'document', TITLEBAR_BOOT_SCRIPT)(
        { __TAURI_INTERNALS__: {} },
        MAC,
        undefined
      )
    ).not.toThrow();
  });
});

describe('the window config and the layout constants', () => {
  const config = JSON.parse(
    readFileSync(join(__dirname, '../../../src-tauri/tauri.conf.json'), 'utf-8')
  );
  const mainWindow = config.app.windows[0];

  it('asks macOS for the overlay title bar', () => {
    expect(mainWindow.titleBarStyle).toBe('Overlay');
  });

  it('hides the native title text, which the header already carries', () => {
    expect(mainWindow.hiddenTitle).toBe(true);
  });

  it('places the traffic lights exactly where the header reserves room for them', () => {
    expect(mainWindow.trafficLightPosition).toEqual({
      x: TRAFFIC_LIGHT_INSET_X,
      y: TRAFFIC_LIGHT_INSET_Y,
    });
  });

  it('centres the traffic lights in the title-bar row', () => {
    const gapAbove = TRAFFIC_LIGHT_INSET_Y;
    const gapBelow = TITLEBAR_ROW_HEIGHT - TRAFFIC_LIGHT_INSET_Y - TRAFFIC_LIGHT_BUTTON_HEIGHT;
    expect(gapAbove).toBe(gapBelow);
  });
});

/**
 * The header is laid out in CSS and Tailwind classes, so the numbers above can
 * only be authoritative if the stylesheet is checked against them. Both halves
 * of every pair below are one measurement stated twice; drift shows up as a
 * logo sitting under the close button, or a row the traffic lights miss.
 */
describe('the stylesheet and the layout constants', () => {
  const read = (path: string) => readFileSync(join(__dirname, '../../', path), 'utf-8');

  it('reserves exactly the configured gutter for the traffic lights', () => {
    const overlayBlock = /:root\[data-titlebar=['"]overlay['"]\]\s*\{([^}]*)\}/.exec(
      read('app/globals.css')
    );
    expect(overlayBlock).not.toBeNull();
    expect(overlayBlock?.[1]).toContain(`--titlebar-gutter: ${TRAFFIC_LIGHT_GUTTER}px`);
  });

  it('leaves no gutter when the buttons are not drawn over the page', () => {
    expect(read('app/globals.css')).toContain('--titlebar-gutter: 0px');
  });

  it('gives the title-bar row the height the traffic lights are centred in', () => {
    // Tailwind's spacing scale is 0.25rem per step, so h-12 is 48px.
    const row = /data-testid="titlebar-row"[\s\S]{0,600}?className="([^"]*)"/.exec(
      read('app/components/ide/Header.tsx')
    );
    expect(row).not.toBeNull();
    expect(row?.[1].split(/\s+/)).toContain(`h-${TITLEBAR_ROW_HEIGHT / 4}`);
  });
});

describe('setTitleBarOverlay', () => {
  const root = () => {
    const el = { attrs: new Map<string, string>() };
    return {
      el: {
        setAttribute: (name: string, value: string) => el.attrs.set(name, value),
        removeAttribute: (name: string) => el.attrs.delete(name),
      } as unknown as Element,
      value: () => el.attrs.get(TITLEBAR_ATTRIBUTE) ?? null,
    };
  };

  it('marks the document while the overlay title bar is on screen', () => {
    const { el, value } = root();
    setTitleBarOverlay(el, true);
    expect(value()).toBe(TITLEBAR_OVERLAY_VALUE);
  });

  it('takes the mark away again, so the gutter cannot outlive the buttons', () => {
    const { el, value } = root();
    setTitleBarOverlay(el, true);
    setTitleBarOverlay(el, false);
    expect(value()).toBeNull();
  });
});
