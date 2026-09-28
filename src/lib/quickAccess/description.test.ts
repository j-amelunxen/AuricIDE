import { describe, expect, it } from 'vitest';
import { DESCRIPTION_MAX_CHARS, normalizeProjectDescription } from './description';

describe('normalizeProjectDescription', () => {
  it('trims and keeps inner line breaks', () => {
    expect(normalizeProjectDescription('  Portal.\nAsk first.  ')).toBe('Portal.\nAsk first.');
  });

  it('treats empty and blank as cleared', () => {
    expect(normalizeProjectDescription('')).toBeNull();
    expect(normalizeProjectDescription('   \n ')).toBeNull();
    expect(normalizeProjectDescription(null)).toBeNull();
  });

  it('cuts at the limit by characters, not UTF-16 units', () => {
    const long = '✓'.repeat(DESCRIPTION_MAX_CHARS - 1) + '🦀🦀';
    const cut = normalizeProjectDescription(long)!;
    expect(Array.from(cut)).toHaveLength(DESCRIPTION_MAX_CHARS);
    expect(cut.endsWith('🦀')).toBe(true);
  });
});
