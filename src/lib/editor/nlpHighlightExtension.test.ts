import { describe, expect, it, vi } from 'vitest';

vi.mock('@codemirror/view', () => ({
  Decoration: {
    mark: () => ({ range: () => ({}) }),
    set: () => ({}),
  },
  ViewPlugin: {
    fromClass: () => ({ extension: true }),
  },
  EditorView: class {},
}));

import { nlpHighlightExtension } from './nlpHighlightExtension';
import { analyzeText } from '../nlp/highlighter';

describe('nlpHighlightExtension', () => {
  describe('exports', () => {
    it('exports nlpHighlightExtension as defined', () => {
      expect(nlpHighlightExtension).toBeDefined();
    });
  });

  describe('highlighter integration', () => {
    it('analyzeText returns variable-hash spans for PascalCase words', () => {
      const spans = analyzeText('Using DataPipeline for processing');
      const entities = spans.filter((s) => s.type === 'variable-hash');
      expect(entities).toHaveLength(1);
      expect(entities[0].from).toBe(6);
      expect(entities[0].to).toBe(18);
    });

    it('analyzeText returns action spans for action verbs', () => {
      const spans = analyzeText('create and deploy the app');
      const actions = spans.filter((s) => s.type === 'action');
      expect(actions.length).toBeGreaterThanOrEqual(2);
    });

    it('analyzeText handles mixed content correctly', () => {
      const spans = analyzeText('the CustomerSupportBot handles classification');
      expect(spans.length).toBeGreaterThanOrEqual(1);
      const types = spans.map((s) => s.type);
      expect(types).toContain('variable-hash');
    });
  });
});
