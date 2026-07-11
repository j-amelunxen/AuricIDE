import { describe, expect, it } from 'vitest';
import { analyzeText } from './highlighter';

describe('analyzeText', () => {
  describe('PascalCase words are not highlighted', () => {
    // In technical markdown almost every noun is PascalCase — colouring the
    // word class painted entire READMEs. Removed; prose reads as prose.
    it('"The CustomerSupportBot is running" → no variable-hash spans', () => {
      const result = analyzeText('The CustomerSupportBot is running');
      expect(result.filter((s) => (s.type as string) === 'variable-hash')).toHaveLength(0);
    });

    it('"IntentClassifier calls DataPipeline" → no spans at all', () => {
      expect(analyzeText('IntentClassifier calls DataPipeline')).toHaveLength(0);
    });
  });

  describe('plain verbs are not highlighted', () => {
    // Verb/action highlighting was removed: colouring every verb in prose is
    // noise. (Negation highlighting was removed too, see below.)
    it('"create a new file and deploy it" → produces no action-typed spans', () => {
      const result = analyzeText('create a new file and deploy it');
      const actions = result.filter((s) => (s.type as string) === 'action');
      expect(actions).toHaveLength(0);
    });
  });

  describe('negation is not highlighted', () => {
    it('"Do NOT deploy" → produces no negated span', () => {
      const result = analyzeText('Do NOT deploy');
      const negated = result.filter((s) => (s.type as string) === 'negated');
      expect(negated).toHaveLength(0);
    });
  });

  describe('keyword detection (structural)', () => {
    it('detects TODO keyword', () => {
      const result = analyzeText('TODO fix this later');
      const keywords = result.filter((s) => s.type === 'keyword');
      expect(keywords).toHaveLength(1);
      expect(keywords[0].from).toBe(0);
      expect(keywords[0].to).toBe(4);
    });

    it('detects FIXME keyword', () => {
      const result = analyzeText('FIXME broken logic');
      const keywords = result.filter((s) => s.type === 'keyword');
      expect(keywords).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for empty string', () => {
      expect(analyzeText('')).toEqual([]);
    });

    it('returns empty array for whitespace-only input', () => {
      expect(analyzeText('   \n\t  ')).toEqual([]);
    });

    it('does not produce overlapping spans', () => {
      const result = analyzeText('the DataPipeline handled classification');
      for (let i = 0; i < result.length; i++) {
        for (let j = i + 1; j < result.length; j++) {
          const a = result[i];
          const b = result[j];
          const overlaps = a.from < b.to && b.from < a.to;
          expect(overlaps).toBe(false);
        }
      }
    });

    it('spans are sorted by from position', () => {
      const result = analyzeText('the classification in DataPipeline was a success');
      for (let i = 1; i < result.length; i++) {
        expect(result[i].from).toBeGreaterThanOrEqual(result[i - 1].from);
      }
    });
  });
});
