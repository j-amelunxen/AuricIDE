import { describe, expect, it } from 'vitest';
import { buildRegistryFromFiles, mergeThemes } from './registry';
import { BUILTIN_THEMES } from './builtins';
import { THEME_SCHEMA_VERSION } from './types';

describe('mergeThemes', () => {
  it('always includes builtins', () => {
    const { themes } = mergeThemes([]);
    expect(themes.length).toBe(BUILTIN_THEMES.length);
    expect(themes.every((t) => t.builtin)).toBe(true);
  });

  it('appends custom themes', () => {
    const { themes, skipped } = mergeThemes([
      {
        schemaVersion: THEME_SCHEMA_VERSION,
        id: 'rose',
        name: 'Rose',
        swatch: '#ff4d6d',
        tokens: { primary: '#ff4d6d' },
      },
    ]);
    expect(skipped).toHaveLength(0);
    expect(themes.some((t) => t.id === 'rose' && !t.builtin)).toBe(true);
  });

  it('skips customs that collide with reserved builtin ids', () => {
    const { themes, skipped } = mergeThemes([
      {
        schemaVersion: THEME_SCHEMA_VERSION,
        id: 'purple',
        name: 'Fake Purple',
        swatch: '#000000',
        tokens: { primary: '#000000' },
      },
    ]);
    expect(skipped).toHaveLength(1);
    expect(themes.find((t) => t.id === 'purple')?.name).toBe('Auric Purple');
  });
});

describe('buildRegistryFromFiles', () => {
  it('skips invalid JSON without throwing', () => {
    const { themes, skipped } = buildRegistryFromFiles([
      { path: 'themes/bad.json', content: '{ not json' },
      {
        path: 'themes/rose.json',
        content: JSON.stringify({
          schemaVersion: 1,
          id: 'rose',
          name: 'Rose',
          swatch: '#ff4d6d',
          tokens: { primary: '#ff4d6d' },
        }),
      },
    ]);
    expect(skipped.some((s) => s.source.includes('bad.json'))).toBe(true);
    expect(themes.some((t) => t.id === 'rose')).toBe(true);
  });
});
