import { describe, expect, it } from 'vitest';
import {
  initialBadgeColor,
  normalizeProjectBadge,
  parseQuickAccessSort,
  sortQuickAccessProjects,
  suggestedBadgeColor,
  usedBadges,
} from './badge';

describe('normalizeProjectBadge', () => {
  it('trims and keeps a short mark', () => {
    expect(normalizeProjectBadge({ text: '  fe  ', color: 'green' })).toEqual({
      text: 'fe',
      color: 'green',
    });
  });

  it('collapses whitespace, then caps at six characters, then trims the cut', () => {
    // "abcde fghi" cuts on the space between the words. The space must not survive.
    expect(normalizeProjectBadge({ text: 'abcde fghi', color: 'blue' })?.text).toBe('abcde');
    expect(normalizeProjectBadge({ text: 'lane-twelve', color: 'blue' })?.text).toBe('lane-t');
  });

  it('counts letters, not bytes', () => {
    expect(normalizeProjectBadge({ text: 'überlang', color: 'blue' })?.text).toBe('überla');
  });

  it('clears on empty text', () => {
    expect(normalizeProjectBadge({ text: '   ', color: 'blue' })).toBeNull();
    expect(normalizeProjectBadge(null)).toBeNull();
    expect(normalizeProjectBadge(undefined)).toBeNull();
  });

  it('fills a blank colour and keeps one it does not recognise', () => {
    expect(normalizeProjectBadge({ text: 'fe', color: '   ' })?.color).toBe('blue');
    expect(normalizeProjectBadge({ text: 'fe', color: 'teal' })?.color).toBe('teal');
  });
});

describe('badge colour suggestion', () => {
  it('starts at blue and skips colours other tiles already use', () => {
    expect(suggestedBadgeColor([])).toBe('blue');
    expect(suggestedBadgeColor(['blue'])).toBe('green');
    expect(suggestedBadgeColor(['blue', 'green', 'purple', 'orange', 'yellow', 'red'])).toBe(
      'blue'
    );
  });

  it('keeps the colour this tile already has', () => {
    expect(initialBadgeColor('green', ['green'])).toBe('green');
    expect(initialBadgeColor('teal', ['blue'])).toBe('green');
    expect(initialBadgeColor(undefined, [])).toBe('blue');
  });
});

describe('usedBadges', () => {
  it('keeps one chip per text and skips tiles with none', () => {
    expect(
      usedBadges([
        { badge: { text: 'FE', color: 'blue' } },
        { badge: { text: 'fe', color: 'red' } },
        {},
        { badge: { text: 'qa', color: 'green' } },
      ]).map((badge) => badge.text)
    ).toEqual(['FE', 'qa']);
  });
});

describe('sortQuickAccessProjects', () => {
  const projects = [
    { path: '/wt/zeta', name: 'zeta', badge: { text: 'qa', color: 'green' } },
    { path: '/wt/alpha', name: 'alpha' },
    { path: '/wt/mu', name: 'mu', badge: { text: 'FE', color: 'blue' } },
    { path: '/wt/api', name: 'auricide', badge: { text: 'api', color: 'purple' } },
    { path: '/wt/fe', name: 'auricide', badge: { text: 'fe', color: 'blue' } },
  ];

  it('sorts by name and breaks equal names on the path', () => {
    expect(sortQuickAccessProjects(projects, 'name').map((p) => p.path)).toEqual([
      '/wt/alpha',
      '/wt/api',
      '/wt/fe',
      '/wt/mu',
      '/wt/zeta',
    ]);
  });

  it('groups by badge and leaves unmarked tiles after them', () => {
    expect(sortQuickAccessProjects(projects, 'badge').map((p) => p.path)).toEqual([
      '/wt/api',
      '/wt/fe',
      '/wt/mu',
      '/wt/zeta',
      '/wt/alpha',
    ]);
  });

  it('treats an unreadable stored sort as name order', () => {
    expect(parseQuickAccessSort(null)).toBe('name');
    expect(parseQuickAccessSort('nope')).toBe('name');
    expect(parseQuickAccessSort('badge')).toBe('badge');
  });
});
