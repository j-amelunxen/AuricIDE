import { describe, expect, it } from 'vitest';
import { analyzeText } from './highlighter';

describe('analyzeText', () => {
  describe('entity detection (PascalCase via wink-nlp)', () => {
    it('detects a PascalCase entity like "CustomerSupportBot"', () => {
      const result = analyzeText('The CustomerSupportBot is running');
      const entities = result.filter((s) => s.type === 'variable-hash');
      expect(entities).toHaveLength(1);
      expect(entities[0].from).toBe(4);
      expect(entities[0].to).toBe(22);
    });

    it('detects multiple entities in one text', () => {
      const result = analyzeText('IntentClassifier calls DataPipeline');
      const entities = result.filter((s) => s.type === 'variable-hash');
      expect(entities).toHaveLength(2);
    });

    it('returns correct from and to positions', () => {
      const text = 'Hello WorldBuilder!';
      const result = analyzeText(text);
      const entities = result.filter((s) => s.type === 'variable-hash');
      expect(entities).toHaveLength(1);
      expect(text.substring(entities[0].from, entities[0].to)).toBe('WorldBuilder');
    });

    it('detects two-part PascalCase like "DataStore"', () => {
      const result = analyzeText('Use DataStore for persistence');
      const matched = result.filter(
        (s) => s.type === 'variable-hash' && s.from === 4
      );
      expect(matched).toHaveLength(1);
      expect(matched[0].to).toBe(13);
    });
  });

  describe('action detection (wink-nlp POS)', () => {
    it('detects action verbs contextually', () => {
      const result = analyzeText('create a new file and deploy it');
      const actions = result.filter((s) => s.type === 'action');
      expect(actions.length).toBeGreaterThanOrEqual(2);
    });

    it('"run the tests" → "run" is action', () => {
      const result = analyzeText('run the tests');
      const actions = result.filter((s) => s.type === 'action');
      const runAction = actions.find(
        (s) => 'run the tests'.substring(s.from, s.to).toLowerCase() === 'run'
      );
      expect(runAction).toBeDefined();
    });

    it('"the first run" → "run" is NOT action (noun usage)', () => {
      const result = analyzeText('the first run');
      const actions = result.filter((s) => s.type === 'action');
      const runAction = actions.find(
        (s) => 'the first run'.substring(s.from, s.to).toLowerCase() === 'run'
      );
      expect(runAction).toBeUndefined();
    });
  });

  describe('negation detection (wink-nlp)', () => {
    it('"Do NOT deploy" → "deploy" is negated', () => {
      const result = analyzeText('Do NOT deploy');
      const negated = result.filter((s) => s.type === 'negated');
      expect(negated.length).toBeGreaterThanOrEqual(1);
      const deploy = negated.find(
        (s) => 'Do NOT deploy'.substring(s.from, s.to).toLowerCase() === 'deploy'
      );
      expect(deploy).toBeDefined();
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
