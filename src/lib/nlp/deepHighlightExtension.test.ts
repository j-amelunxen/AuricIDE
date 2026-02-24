import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  deepDecorationField,
  buildNerDecorations,
  buildIntentDecorations,
} from './deepHighlightExtension';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deepHighlightExtension', () => {
  describe('deepDecorationField', () => {
    it('starts with empty decoration set', () => {
      const state = EditorState.create({
        doc: 'Hello world',
        extensions: [deepDecorationField],
      });
      const decos = state.field(deepDecorationField);
      expect(decos.size).toBe(0);
    });
  });

  describe('buildNerDecorations', () => {
    it('returns empty set for empty entities', () => {
      const decos = buildNerDecorations([], 0);
      expect(decos.size).toBe(0);
    });

    it('filters out entities with low confidence', () => {
      const decos = buildNerDecorations(
        [{ entity_group: 'PER', score: 0.3, word: 'maybe', start: 0, end: 5 }],
        0
      );
      expect(decos.size).toBe(0);
    });
  });

  describe('buildIntentDecorations', () => {
    it('creates line decoration for top intent', () => {
      const decos = buildIntentDecorations(
        {
          labels: ['instruction', 'explanation', 'warning', 'question', 'context'],
          scores: [0.85, 0.07, 0.04, 0.02, 0.02],
        },
        0
      );
      expect(decos.size).toBe(1);
    });

    it('returns empty set if no clear intent (top score < 0.5)', () => {
      const decos = buildIntentDecorations(
        {
          labels: ['instruction', 'explanation', 'warning', 'question', 'context'],
          scores: [0.3, 0.25, 0.2, 0.15, 0.1],
        },
        0
      );
      expect(decos.size).toBe(0);
    });
  });
});
