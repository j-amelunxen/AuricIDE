/**
 * macOS draws its title bar as a transparent overlay for this app
 * (`titleBarStyle: "Overlay"` in `tauri.conf.json`), which hands the whole
 * strip to the web view: the header *is* the title bar rather than sitting
 * below a grey one that belongs to nobody.
 *
 * Two things have to agree for that to look right, and both live here so they
 * cannot drift apart:
 *
 * - **The traffic lights are positioned by the window, the header is laid out
 *   by CSS.** `tauri.conf.json` owns the pixel position; the constants below
 *   restate it for the layout, and `titlebar.test.ts` fails if the two ever
 *   disagree.
 * - **Only this one platform gets the overlay.** Windows, Linux and the
 *   browser dev server keep a normal title bar (or none), so reserving space
 *   for buttons that are not there would just be a dent in the layout.
 */

/**
 * Height of the title-bar row, in CSS pixels. The row stays exactly this tall
 * in every header variant — extra rows grow downwards — because the traffic
 * lights are pinned to a fixed offset and cannot follow a header that
 * changes height.
 */
export const TITLEBAR_ROW_HEIGHT = 48;

/**
 * The traffic lights' own box, as macOS lays it out: the button frame is
 * taller than the coloured circle it draws. Only used to check that the
 * configured offset centres the buttons in the row.
 */
export const TRAFFIC_LIGHT_BUTTON_HEIGHT = 16;

/** Left edge of the close button, measured from the window's left edge. */
export const TRAFFIC_LIGHT_INSET_X = 16;

/** Top edge of the buttons, measured from the window's top edge. */
export const TRAFFIC_LIGHT_INSET_Y = (TITLEBAR_ROW_HEIGHT - TRAFFIC_LIGHT_BUTTON_HEIGHT) / 2;

/**
 * Space the header must keep clear on the left before its own content starts:
 * the three buttons plus the gap that separates them from the app's content.
 */
export const TRAFFIC_LIGHT_GUTTER = 78;

/** Marks the document as wearing the overlay title bar. */
export const TITLEBAR_ATTRIBUTE = 'data-titlebar';
export const TITLEBAR_OVERLAY_VALUE = 'overlay';

/** The window-ish shape this module needs to recognise its own platform. */
export interface TitleBarEnvironment {
  /** Tauri's IPC bridge — present only inside the desktop shell. */
  __TAURI_INTERNALS__?: unknown;
  navigator?: { platform?: string; userAgent?: string };
}

/**
 * True when the window really is drawing the overlay title bar: the desktop
 * shell, on macOS. In the browser dev server there is no window chrome to
 * make room for, and on Windows/Linux Tauri keeps the native one.
 */
export function isOverlayTitleBar(env: TitleBarEnvironment | undefined): boolean {
  if (!env || !env.__TAURI_INTERNALS__) return false;
  const nav = env.navigator;
  // `platform` is the honest signal and `userAgent` the fallback for the
  // webviews that have already dropped it.
  const signal = `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
  return /mac/i.test(signal);
}

/**
 * Turns the gutter on and off after boot.
 *
 * The buttons are not a fixed fact of the window: in fullscreen macOS takes
 * the title bar away entirely and only slides the traffic lights in when the
 * pointer goes for the top edge. Holding their gutter open for the rest of the
 * session would indent the header around buttons that are not there, so the
 * mark the boot script sets has to be removable again.
 */
export function setTitleBarOverlay(root: Element, overlay: boolean): void {
  if (overlay) {
    root.setAttribute(TITLEBAR_ATTRIBUTE, TITLEBAR_OVERLAY_VALUE);
  } else {
    root.removeAttribute(TITLEBAR_ATTRIBUTE);
  }
}

/**
 * Runs before first paint, from the document head: the header reserves the
 * traffic lights' gutter through CSS keyed on this attribute, and setting it
 * from an effect instead would show one frame with the logo under the buttons.
 *
 * Kept as a string rather than a second hand-written copy in `layout.tsx` so
 * the behaviour that ships is the behaviour the tests run.
 */
export const TITLEBAR_BOOT_SCRIPT = `try{if(window.__TAURI_INTERNALS__&&/mac/i.test((navigator.platform||'')+' '+(navigator.userAgent||''))){document.documentElement.setAttribute('${TITLEBAR_ATTRIBUTE}','${TITLEBAR_OVERLAY_VALUE}');}}catch(e){}`;
