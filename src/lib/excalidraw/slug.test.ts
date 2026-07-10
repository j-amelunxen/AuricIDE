import { describe, expect, it } from 'vitest';
import { slugifySceneName } from './slug';

describe('slugifySceneName', () => {
  it('lowercases and hyphenates plain names', () => {
    expect(slugifySceneName('Checkout Flow')).toBe('checkout-flow');
  });

  it('transliterates German umlauts and sharp s', () => {
    expect(slugifySceneName('Deploy Pipeline Übersicht')).toBe('deploy-pipeline-uebersicht');
    expect(slugifySceneName('Größenmaße')).toBe('groessenmasse');
  });

  it('strips other diacritics', () => {
    expect(slugifySceneName('Café Menü')).toBe('cafe-menue');
  });

  it('collapses runs of separators and trims edges', () => {
    expect(slugifySceneName('  a -- b !! c  ')).toBe('a-b-c');
  });

  it('falls back to "diagram" for names with no usable characters', () => {
    expect(slugifySceneName('///!!!')).toBe('diagram');
    expect(slugifySceneName('')).toBe('diagram');
  });
});
