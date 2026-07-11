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

  describe('entity detection (wink NER) — facts you scan for', () => {
    it('"July 20, 2024" → entity (DATE)', () => {
      const spans = analyzeWithWink('Meet on July 20, 2024 for the review');
      const entities = spansOfType(spans, 'entity');
      expect(entities.length).toBeGreaterThanOrEqual(1);
    });

    it('"50000 USD" → entity (MONEY)', () => {
      const spans = analyzeWithWink('approved for 50000 USD last month');
      const entities = spansOfType(spans, 'entity');
      const money = entities.find((s) =>
        'approved for 50000 USD last month'.substring(s.from, s.to).includes('USD')
      );
      expect(money).toBeDefined();
    });
  });

  describe('noise entity types are not highlighted', () => {
    // ORDINAL/CARDINAL/DURATION marked words like "first" in "Markdown-first
    // editor" — a hint that answers no question is noise (Apple: cut it).
    it('"the first run" → "first" (ORDINAL) is not marked', () => {
      const spans = analyzeWithWink('the first run of the Markdown-first editor');
      expect(spansOfType(spans, 'entity')).toHaveLength(0);
    });

    it('"three weeks" (DURATION) and bare numbers (CARDINAL) are not marked', () => {
      const spans = analyzeWithWink('it took three weeks and 500 attempts');
      expect(spansOfType(spans, 'entity')).toHaveLength(0);
    });
  });

  describe('proper nouns and PascalCase are not highlighted', () => {
    // In technical markdown every third word is PascalCase or a proper noun
    // (Rust, CodeMirror, Tauri, …). Colouring the lot painted whole READMEs —
    // recognising a word class adds no information for the reader. Removed.
    it('"The UserService handles requests" → no span for "UserService"', () => {
      const spans = analyzeWithWink('The UserService handles requests');
      const userService = spans.find(
        (s) => 'The UserService handles requests'.substring(s.from, s.to) === 'UserService'
      );
      expect(userService).toBeUndefined();
    });

    it('never emits variable-hash spans', () => {
      const spans = analyzeWithWink('CodeMirror renders Markdown while Tauri talks to Rust');
      expect(spans.filter((s) => (s.type as string) === 'variable-hash')).toHaveLength(0);
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
