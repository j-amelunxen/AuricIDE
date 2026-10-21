import { describe, expect, it } from 'vitest';
import {
  acceleratorFromKeyEvent,
  duplicateShortcuts,
  formatAccelerator,
  menuBarConfig,
} from './supervisorMenuBar';

const key = (code: string, mods: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>>) => ({
  code,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe('menuBarConfig', () => {
  const library = [{ id: 'vtt', name: 'video to tasklist', prompt: '/video-to-tasklist live' }];

  it('lists pinned skills with their shortcut, then the unpinned library', () => {
    const config = menuBarConfig(
      {
        skills: [{ id: 'p1', label: 'Ping', prompt: 'Say PONG', shortcut: 'Control+Alt+KeyP' }],
        wheelSlots: [],
      },
      library,
      { tray: true, shortcuts: true },
      0
    );
    expect(config).toEqual({
      tray: true,
      shortcuts: true,
      running: 0,
      skills: [
        { id: 'p1', label: 'Ping', shortcut: 'Control+Alt+KeyP' },
        { id: 'auric:vtt', label: 'video to tasklist' },
      ],
    });
  });

  it('shows a pinned library skill under its current name', () => {
    const config = menuBarConfig(
      {
        skills: [{ id: 'auric:vtt', label: 'old name', prompt: 'old', auricSkillId: 'vtt' }],
        wheelSlots: [],
      },
      library,
      { tray: true, shortcuts: false },
      2
    );
    expect(config.running).toBe(2);
    expect(config.skills).toEqual([{ id: 'auric:vtt', label: 'video to tasklist' }]);
  });
});

describe('acceleratorFromKeyEvent', () => {
  it('builds an accelerator from the physical key, so Option does not change the letter', () => {
    expect(acceleratorFromKeyEvent(key('KeyV', { ctrl: true, alt: true }))).toBe(
      'Control+Alt+KeyV'
    );
    expect(acceleratorFromKeyEvent(key('Digit1', { meta: true, shift: true }))).toBe(
      'Shift+Super+Digit1'
    );
    expect(acceleratorFromKeyEvent(key('F5', {}))).toBe('F5');
  });

  it('refuses a plain key or Shift alone, which would steal typing everywhere', () => {
    expect(acceleratorFromKeyEvent(key('KeyV', {}))).toBeNull();
    expect(acceleratorFromKeyEvent(key('KeyV', { shift: true }))).toBeNull();
  });

  it('waits while only modifiers are held', () => {
    expect(acceleratorFromKeyEvent(key('AltLeft', { alt: true }))).toBeNull();
  });
});

describe('formatAccelerator', () => {
  it('reads like a macOS menu', () => {
    expect(formatAccelerator('Control+Alt+KeyV')).toBe('⌃⌥V');
    expect(formatAccelerator('Shift+Super+Digit1')).toBe('⇧⌘1');
    expect(formatAccelerator('F5')).toBe('F5');
  });
});

describe('duplicateShortcuts', () => {
  it('names the shortcuts used by more than one skill', () => {
    expect(
      duplicateShortcuts([
        { shortcut: 'Control+Alt+KeyV' },
        { shortcut: 'Control+Alt+KeyV' },
        { shortcut: 'F5' },
        {},
      ])
    ).toEqual(new Set(['Control+Alt+KeyV']));
  });
});
