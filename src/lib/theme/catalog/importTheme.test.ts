import { describe, expect, it, vi } from 'vitest';
import { importCustomTheme } from './importTheme';
import { THEME_SCHEMA_VERSION } from './types';

const validJson = JSON.stringify({
  schemaVersion: THEME_SCHEMA_VERSION,
  id: 'rose',
  name: 'Rose',
  swatch: '#ff4d6d',
  tokens: { primary: '#ff4d6d' },
});

describe('importCustomTheme', () => {
  it('writes a valid theme as <id>.json and returns the parsed theme', async () => {
    const write = vi.fn(async (content: string, filename: string) => {
      expect(content).toBe(validJson);
      expect(filename).toBe('rose.json');
      return { path: '/app/themes/rose.json' };
    });

    const result = await importCustomTheme(validJson, write);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.id).toBe('rose');
      expect(result.theme.name).toBe('Rose');
      expect(result.path).toBe('/app/themes/rose.json');
    }
    expect(write).toHaveBeenCalledOnce();
  });

  it('does not write invalid JSON', async () => {
    const write = vi.fn();
    const result = await importCustomTheme('{ not json', write);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid json/i);
    expect(write).not.toHaveBeenCalled();
  });

  it('does not write a theme that uses a reserved built-in id', async () => {
    const write = vi.fn();
    const json = JSON.stringify({
      schemaVersion: THEME_SCHEMA_VERSION,
      id: 'purple',
      name: 'Fake Purple',
      swatch: '#000000',
      tokens: { primary: '#000000' },
    });
    const result = await importCustomTheme(json, write);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/reserved|built-in/i);
    expect(write).not.toHaveBeenCalled();
  });

  it('does not write a theme missing required fields', async () => {
    const write = vi.fn();
    const result = await importCustomTheme(
      JSON.stringify({ schemaVersion: 1, id: 'nope', name: 'Nope' }),
      write
    );
    expect(result.ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('surfaces a write failure', async () => {
    const write = vi.fn(async () => {
      throw new Error('disk full');
    });
    const result = await importCustomTheme(validJson, write);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/disk full/i);
  });
});
