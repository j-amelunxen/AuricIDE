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
    it('analyzeText leaves PascalCase prose alone (no variable-hash spans)', () => {
      const spans = analyzeText('Using DataPipeline for processing');
      expect(spans.filter((s) => (s.type as string) === 'variable-hash')).toHaveLength(0);
    });

    it('analyzeText no longer emits action spans for plain verbs', () => {
      const spans = analyzeText('create and deploy the app');
      const actions = spans.filter((s) => (s.type as string) === 'action');
      expect(actions).toHaveLength(0);
    });

    it('analyzeText still marks actionable keywords in mixed content', () => {
      const spans = analyzeText('TODO: let the CustomerSupportBot handle classification');
      const types = spans.map((s) => s.type);
      expect(types).toContain('keyword');
      expect(types).not.toContain('variable-hash');
    });
  });
});
