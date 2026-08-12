import { describe, expect, it } from 'vitest';
import { parseTheme, parseThemeJson } from './schema';

const valid = {
  schemaVersion: 1,
  id: 'rose',
  name: 'Rose',
  swatch: '#ff4d6d',
  tokens: { primary: '#ff4d6d', primaryLight: '#ff8fa3' },
};

describe('parseTheme', () => {
  it('accepts a minimal valid theme', () => {
    const result = parseTheme(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.theme.id).toBe('rose');
      expect(result.theme.tokens.primary).toBe('#ff4d6d');
      expect(result.theme.tokens.primaryLight).toBe('#ff8fa3');
    }
  });

  it('rejects missing primary', () => {
    const result = parseTheme({
      ...valid,
      tokens: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/primary/i);
  });

  it('rejects bad id', () => {
    const result = parseTheme({ ...valid, id: 'Not Valid!' });
    expect(result.ok).toBe(false);
  });

  it('rejects schemaVersion above supported', () => {
    const result = parseTheme({ ...valid, schemaVersion: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/schemaVersion/i);
  });

  it('warns on unknown top-level and token keys without failing', () => {
    const result = parseTheme({
      ...valid,
      futureField: true,
      tokens: { ...valid.tokens, neonExtra: '#fff' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.includes('futureField'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('neonExtra'))).toBe(true);
    }
  });

  it('parses JSON strings', () => {
    expect(parseThemeJson(JSON.stringify(valid)).ok).toBe(true);
    expect(parseThemeJson('{ not json').ok).toBe(false);
  });
});
