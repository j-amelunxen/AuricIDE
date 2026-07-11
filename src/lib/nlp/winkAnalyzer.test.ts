import { describe, expect, it } from 'vitest';
import { analyzeWithWink } from './winkAnalyzer';
import type { HighlightSpan } from './spanCollector';

function spansOfType(spans: HighlightSpan[], type: HighlightSpan['type']): HighlightSpan[] {
  return spans.filter((s) => s.type === type);
}

describe('analyzeWithWink', () => {
  describe('plain verbs are not highlighted', () => {
    // Colouring every verb in prose is noise, not signal — the feature was
    // intentionally removed (as was negation highlighting, see below).
    it('"run the tests" → produces no verb/action span for "run"', () => {
      const spans = analyzeWithWink('run the tests');
      const runSpan = spans.find(
        (s) => 'run the tests'.substring(s.from, s.to).toLowerCase() === 'run'
      );
      expect(runSpan).toBeUndefined();
    });
  });

  describe('negation is not highlighted', () => {
    // wink's negation flag marks the whole grammatical scope, which struck
    // through half a paragraph of un-negated words in real prose. Removed.
    it('"Do NOT deploy" → produces no negated span', () => {
      const spans = analyzeWithWink('Do NOT deploy');
      const negated = spans.filter((s) => (s.type as string) === 'negated');
      expect(negated).toHaveLength(0);
    });
  });

  describe('entity detection (wink NER)', () => {
    it('"July 20, 2024" → entity (DATE)', () => {
      const spans = analyzeWithWink('Meet on July 20, 2024 for the review');
      const entities = spansOfType(spans, 'entity');
      expect(entities.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('proper noun detection (POS=PROPN)', () => {
    it('PascalCase "UserService" → variable-hash with stable color', () => {
      const spans = analyzeWithWink('The UserService handles requests');
      const hashed = spansOfType(spans, 'variable-hash');
      const userService = hashed.find(
        (s) => 'The UserService handles requests'.substring(s.from, s.to) === 'UserService'
      );
      expect(userService).toBeDefined();
      expect(userService!.hashColor).toBeDefined();
      expect(userService!.hashColor).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('hash color is stable across calls', () => {
      const spans1 = analyzeWithWink('UserService is running');
      const spans2 = analyzeWithWink('UserService is great');
      const hash1 = spansOfType(spans1, 'variable-hash').find(
        (s) => 'UserService is running'.substring(s.from, s.to) === 'UserService'
      );
      const hash2 = spansOfType(spans2, 'variable-hash').find(
        (s) => 'UserService is great'.substring(s.from, s.to) === 'UserService'
      );
      expect(hash1?.hashColor).toBe(hash2?.hashColor);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for empty string', () => {
      expect(analyzeWithWink('')).toEqual([]);
    });

    it('returns empty array for whitespace-only input', () => {
      expect(analyzeWithWink('   \n\t  ')).toEqual([]);
    });

    it('spans do not overlap', () => {
      const spans = analyzeWithWink('Do NOT deploy the UserService to production');
      for (let i = 0; i < spans.length; i++) {
        for (let j = i + 1; j < spans.length; j++) {
          const a = spans[i];
          const b = spans[j];
          const overlaps = a.from < b.to && b.from < a.to;
          expect(overlaps).toBe(false);
        }
      }
    });

    it('spans are sorted by from position', () => {
      const spans = analyzeWithWink('create the DataPipeline and deploy it now');
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i].from).toBeGreaterThanOrEqual(spans[i - 1].from);
      }
    });
  });
});
