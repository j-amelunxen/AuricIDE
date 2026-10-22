import { beforeEach, describe, expect, it } from 'vitest';
import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';
import {
  managersForMenuBar,
  managersForQuickAccess,
  parseManagerPresentations,
  presentationOf,
  readManagerPresentations,
  updateManagerPresentation,
} from './managerPresentation';

const manager = (key: string, archivedAt: string | null = null): SupervisorManager => ({
  key,
  name: key,
  runDir: `2026-10-21_${key}`,
  promotedAt: '2026-10-21T09:00:00Z',
  archivedAt,
  lastLaunch: null,
});

describe('parseManagerPresentations', () => {
  it('reads nothing from a missing or broken value', () => {
    expect(parseManagerPresentations(null)).toEqual({});
    expect(parseManagerPresentations('{not json')).toEqual({});
    expect(parseManagerPresentations('[1,2]')).toEqual({});
    expect(parseManagerPresentations('"text"')).toEqual({});
  });

  it('keeps only fields of the right type', () => {
    const raw = JSON.stringify({
      'release-desk': { quickAccess: false, menuBar: 'yes', shortcut: 'Control+Alt+KeyR', x: 1 },
      broken: 'nope',
      empty: { shortcut: '  ' },
    });
    expect(parseManagerPresentations(raw)).toEqual({
      'release-desk': { quickAccess: false, shortcut: 'Control+Alt+KeyR' },
      broken: {},
      empty: {},
    });
  });
});

describe('presentationOf', () => {
  it('shows a manager in both places, without a shortcut, until told otherwise', () => {
    expect(presentationOf({}, 'release-desk')).toEqual({
      quickAccess: true,
      menuBar: true,
      shortcut: null,
    });
  });

  it('applies what was stored for that key only', () => {
    const all = { a: { quickAccess: false, shortcut: 'F5' }, b: { menuBar: false } };
    expect(presentationOf(all, 'a')).toEqual({ quickAccess: false, menuBar: true, shortcut: 'F5' });
    expect(presentationOf(all, 'b')).toEqual({ quickAccess: true, menuBar: false, shortcut: null });
  });
});

describe('what each surface lists', () => {
  const managers = [manager('a'), manager('b'), manager('old', '2026-10-22T00:00:00Z')];
  const all = {
    a: { menuBar: false },
    b: { quickAccess: false },
    old: {},
    gone: { quickAccess: true },
  };

  it('Quick Access lists non-archived managers set to show there', () => {
    expect(managersForQuickAccess(managers, all).map((m) => m.key)).toEqual(['a']);
  });

  it('the menu bar lists non-archived managers set to show there', () => {
    expect(managersForMenuBar(managers, all).map((m) => m.key)).toEqual(['b']);
  });

  it('ignores a preference for a key the registry no longer has', () => {
    expect(managersForQuickAccess([], all)).toEqual([]);
  });
});

describe('updateManagerPresentation', () => {
  beforeEach(() => localStorage.clear());

  it('merges into what is stored and keeps the other managers', () => {
    updateManagerPresentation('a', { quickAccess: false });
    updateManagerPresentation('a', { shortcut: 'F5' });
    updateManagerPresentation('b', { menuBar: false });
    expect(readManagerPresentations()).toEqual({
      a: { quickAccess: false, shortcut: 'F5' },
      b: { menuBar: false },
    });
  });

  it('drops the shortcut when it is cleared', () => {
    updateManagerPresentation('a', { shortcut: 'F5' });
    updateManagerPresentation('a', { shortcut: null });
    expect(localStorage.getItem(APP_CONFIG_KEYS.supervisorManagers)).toBe('{"a":{}}');
  });
});
