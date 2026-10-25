import { describe, expect, it } from 'vitest';
import { createDoubleShiftDetector, DOUBLE_SHIFT_WINDOW_MS } from './doubleShift';

type Key = {
  key: string;
  repeat?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

/** Replays a typed sequence; `down`/`up` events at the given times. Returns how often it fired. */
function replay(events: Array<['down' | 'up', Key, number]>): number {
  const detector = createDoubleShiftDetector();
  let fired = 0;
  for (const [kind, key, at] of events) {
    const event = { repeat: false, metaKey: false, ctrlKey: false, altKey: false, ...key };
    if (kind === 'down' && detector.keydown(event, at)) fired += 1;
    if (kind === 'up') detector.keyup(event, at);
  }
  return fired;
}

const SHIFT = { key: 'Shift' };

describe('createDoubleShiftDetector', () => {
  it('fires on two lone Shift taps inside the window', () => {
    expect(
      replay([
        ['down', SHIFT, 0],
        ['up', SHIFT, 60],
        ['down', SHIFT, 150],
        ['up', SHIFT, 200],
      ])
    ).toBe(1);
  });

  it('does not fire when the second tap comes too late', () => {
    expect(
      replay([
        ['down', SHIFT, 0],
        ['up', SHIFT, 60],
        ['down', SHIFT, 60 + DOUBLE_SHIFT_WINDOW_MS + 1],
      ])
    ).toBe(0);
  });

  it('does not fire for two capitals typed in a row ("OK")', () => {
    expect(
      replay([
        ['down', SHIFT, 0],
        ['down', { key: 'O' }, 40],
        ['up', SHIFT, 80],
        ['down', SHIFT, 120],
        ['down', { key: 'K' }, 150],
        ['up', SHIFT, 190],
      ])
    ).toBe(0);
  });

  it('does not fire when a key lands between the taps (capital after a symbol)', () => {
    expect(
      replay([
        ['down', SHIFT, 0],
        ['down', { key: '?' }, 30],
        ['up', SHIFT, 60],
        ['down', { key: ' ' }, 90],
        ['down', SHIFT, 140],
      ])
    ).toBe(0);
  });

  it('does not fire when Shift is held and the OS repeats the keydown', () => {
    expect(
      replay([
        ['down', SHIFT, 0],
        ['down', { key: 'Shift', repeat: true }, 100],
        ['down', { key: 'Shift', repeat: true }, 130],
      ])
    ).toBe(0);
  });

  it('does not fire for a second Shift pressed without releasing the first', () => {
    // Left Shift held, right Shift pressed: two keydowns, no keyup between.
    expect(
      replay([
        ['down', SHIFT, 0],
        ['down', SHIFT, 100],
      ])
    ).toBe(0);
  });

  it('does not count Shift as part of a modifier chord', () => {
    expect(
      replay([
        ['down', { key: 'Shift', metaKey: true }, 0],
        ['up', { key: 'Shift', metaKey: true }, 50],
        ['down', { key: 'Shift', metaKey: true }, 120],
      ])
    ).toBe(0);
  });

  it('starts over after a pointer press (Shift-click, Shift-click)', () => {
    const detector = createDoubleShiftDetector();
    const shift = { key: 'Shift', repeat: false, metaKey: false, ctrlKey: false, altKey: false };
    detector.keydown(shift, 0);
    detector.keyup(shift, 50);
    detector.reset();
    expect(detector.keydown(shift, 120)).toBe(false);
  });

  it('does not chain a third tap into a second trigger', () => {
    expect(
      replay([
        ['down', SHIFT, 0],
        ['up', SHIFT, 40],
        ['down', SHIFT, 100],
        ['up', SHIFT, 140],
        ['down', SHIFT, 200],
        ['up', SHIFT, 240],
      ])
    ).toBe(1);
  });
});
