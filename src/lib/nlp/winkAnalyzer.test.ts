import { describe, expect, it } from 'vitest';
import { analyzeWithWink } from './winkAnalyzer';
import type { HighlightSpan } from './spanCollector';

function spansOfType(spans: HighlightSpan[], type: HighlightSpan['type']): HighlightSpan[] {
  return spans.filter((s) => s.type === type);
}

describe('analyzeWithWink', () => {
  describe('action detection (POS=VERB)', () => {
    it('"run the tests" → "run" is action (VERB)', () => {
      const spans = analyzeWithWink('run the tests');
      const actions = spansOfType(spans, 'action');
      expect(actions.length).toBeGreaterThanOrEqual(1);
      const runAction = actions.find(
        (s) => 'run the tests'.substring(s.from, s.to).toLowerCase() === 'run'
      );
      expect(runAction).toBeDefined();
    });

    it('"create a new file and deploy it" → detects action verbs', () => {
      const spans = analyzeWithWink('create a new file and deploy it');
      const actions = spansOfType(spans, 'action');
      expect(actions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('context-aware classification', () => {
    it('"the first run" → "run" is NOT action (NOUN usage)', () => {
      const spans = analyzeWithWink('the first run');
      const actions = spansOfType(spans, 'action');
      const runAction = actions.find(
        (s) => 'the first run'.substring(s.from, s.to).toLowerCase() === 'run'
      );
      expect(runAction).toBeUndefined();
    });
  });

  describe('negation detection', () => {
    it('"Do NOT deploy" → "deploy" is negated', () => {
      const spans = analyzeWithWink('Do NOT deploy');
      const negated = spansOfType(spans, 'negated');
      expect(negated.length).toBeGreaterThanOrEqual(1);
      const deploy = negated.find(
        (s) => 'Do NOT deploy'.substring(s.from, s.to).toLowerCase() === 'deploy'
      );
      expect(deploy).toBeDefined();
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
