import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG_CHANGED_EVENT, APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import type { SupervisorManager } from '@/lib/tauri/supervisorManagers';
import {
  forgetRemovedManagers,
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

describe("a manager's model", () => {
  beforeEach(() => localStorage.clear());

  it('is read as a trimmed string and ignored when blank or not a string', () => {
    const raw = JSON.stringify({ a: { model: ' haiku ' }, b: { model: '  ' }, c: { model: 3 } });
    expect(parseManagerPresentations(raw)).toEqual({ a: { model: 'haiku' }, b: {}, c: {} });
  });

  it('defaults to none, meaning the supervisor default', () => {
    expect(presentationOf({}, 'a').model).toBeNull();
    expect(presentationOf({ a: { model: 'haiku' } }, 'a').model).toBe('haiku');
  });

  it('is stored next to the other choices and dropped when cleared', () => {
    updateManagerPresentation('a', { shortcut: 'F5' });
    updateManagerPresentation('a', { model: 'haiku' });
    expect(readManagerPresentations()).toEqual({ a: { shortcut: 'F5', model: 'haiku' } });
    updateManagerPresentation('a', { model: null });
    expect(readManagerPresentations()).toEqual({ a: { shortcut: 'F5' } });
  });
});

describe('presentationOf', () => {
  it('shows a manager in both places, without a shortcut, until told otherwise', () => {
    expect(presentationOf({}, 'release-desk')).toEqual({
      quickAccess: true,
      menuBar: true,
      shortcut: null,
      model: null,
    });
  });

  it('applies what was stored for that key only', () => {
    const all = { a: { quickAccess: false, shortcut: 'F5' }, b: { menuBar: false } };
    expect(presentationOf(all, 'a')).toMatchObject({ quickAccess: false, shortcut: 'F5' });
    expect(presentationOf(all, 'b')).toMatchObject({ menuBar: false, shortcut: null });
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

describe('forgetRemovedManagers', () => {
  beforeEach(() => localStorage.clear());

  it('drops the choices of a key the registry no longer has, so a new manager starts clean', () => {
    updateManagerPresentation('gone', { shortcut: 'F5', menuBar: false });
    updateManagerPresentation('kept', { shortcut: 'F6' });
    forgetRemovedManagers(['kept']);
    expect(readManagerPresentations()).toEqual({ kept: { shortcut: 'F6' } });
  });

  it('writes nothing when every stored key is still in the registry', () => {
    updateManagerPresentation('kept', { shortcut: 'F6' });
    const changed = vi.fn();
    window.addEventListener(APP_CONFIG_CHANGED_EVENT, changed);
    forgetRemovedManagers(['kept', 'other']);
    window.removeEventListener(APP_CONFIG_CHANGED_EVENT, changed);
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('managersForMenuBar and a missing run folder', () => {
  it('leaves out a manager whose folder is gone: the menu bar entry would only fail', () => {
    const gone = { ...manager('gone'), runMissing: true };
    expect(managersForMenuBar([manager('here'), gone], {}).map((m) => m.key)).toEqual(['here']);
  });

  it('keeps it in Quick Access, where the tile can say "Folder missing"', () => {
    const gone = { ...manager('gone'), runMissing: true };
    expect(managersForQuickAccess([gone], {}).map((m) => m.key)).toEqual(['gone']);
  });
});
