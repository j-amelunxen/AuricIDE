/**
 * "Shift Shift" opens file search, as in JetBrains IDEs — but only for a
 * deliberate double tap.
 *
 * The first version counted any two Shift keydowns within the window, so
 * ordinary typing opened the overlay: "OK", a capital after `?` or `:`, a
 * held Shift whose keydown the OS repeats. Typing never produces a *lone*
 * Shift, though: a capital is Shift plus a letter. So a tap counts only when
 * Shift went down and came back up with no other key in between, and the
 * second tap must follow the first with nothing typed between them either.
 *
 * The listeners have to run in the capture phase: xterm stops propagation of
 * every key it sends to the shell except plain letters, so in a terminal a
 * bubbling listener sees the lone Shifts of Shift+Tab, Shift+Tab but never
 * the Tabs between them.
 */

export const DOUBLE_SHIFT_WINDOW_MS = 300;

type KeyLike = Pick<KeyboardEvent, 'key' | 'repeat' | 'metaKey' | 'ctrlKey' | 'altKey'>;

export interface DoubleShiftDetector {
  /** True when this keydown completes a double tap. */
  keydown: (event: KeyLike, now: number) => boolean;
  keyup: (event: KeyLike, now: number) => void;
  /** Anything that is not a key (a Shift-click) breaks a tap sequence too. */
  reset: () => void;
}

export function createDoubleShiftDetector(): DoubleShiftDetector {
  // Shift is down and nothing else has been pressed since.
  let loneShiftDown = false;
  // When the last clean tap was released; null once anything else happened.
  let lastTapAt: number | null = null;

  const isChord = (event: KeyLike) => event.metaKey || event.ctrlKey || event.altKey;

  return {
    keydown(event, now) {
      if (event.key !== 'Shift' || isChord(event)) {
        loneShiftDown = false;
        lastTapAt = null;
        return false;
      }
      if (event.repeat) return false;
      if (loneShiftDown) {
        // A second Shift while the first is still held is not a tap.
        loneShiftDown = false;
        lastTapAt = null;
        return false;
      }
      loneShiftDown = true;
      if (lastTapAt !== null && now - lastTapAt < DOUBLE_SHIFT_WINDOW_MS) {
        lastTapAt = null;
        loneShiftDown = false;
        return true;
      }
      return false;
    },

    keyup(event, now) {
      if (event.key !== 'Shift') return;
      lastTapAt = loneShiftDown ? now : null;
      loneShiftDown = false;
    },

    reset() {
      loneShiftDown = false;
      lastTapAt = null;
    },
  };
}
