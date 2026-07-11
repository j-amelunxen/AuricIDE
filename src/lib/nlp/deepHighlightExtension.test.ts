import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  deepNerField,
  deepIntentField,
  buildNerDecorations,
  buildIntentDecorations,
  pickIntentParagraph,
  DeepAnalysisPlugin,
} from './deepHighlightExtension';
import type { DeepWorkerClient } from './deepWorkerClient';
import type { NerEntity, ClassifyResult } from './deepAnalysisWorker';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deepHighlightExtension', () => {
  describe('deep decoration fields', () => {
    it('NER and intent fields both start empty and are independent', () => {
      const state = EditorState.create({
        doc: 'Hello world',
        extensions: [deepNerField, deepIntentField],
      });
      // Separate fields — an intent update must not clobber NER decorations.
      expect(state.field(deepNerField).size).toBe(0);
      expect(state.field(deepIntentField).size).toBe(0);
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

    it('returns empty set if no clear intent (top score below threshold)', () => {
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

  describe('pickIntentParagraph', () => {
    it('skips markdown headings and picks the first prose line', () => {
      const text = '# Project Kickoff\n\nTask: review the roadmap together.';
      const picked = pickIntentParagraph(text);
      expect(picked?.text).toBe('Task: review the roadmap together.');
      expect(picked?.offset).toBe(19);
    });

    it('skips short lines', () => {
      const text = 'ok\nfine\nThis line is long enough to classify.';
      const picked = pickIntentParagraph(text);
      expect(picked?.text).toBe('This line is long enough to classify.');
      expect(picked?.offset).toBe(8);
    });

    it('returns null when only headings and short lines exist', () => {
      expect(pickIntentParagraph('# One Heading\n## Another Heading\nok')).toBeNull();
    });
  });

  describe('DeepAnalysisPlugin', () => {
    const DOC = 'Angela Merkel visited Paris to sign the treaty.';

    interface FakeView {
      state: EditorState;
      visibleRanges: Array<{ from: number; to: number }>;
      dispatch: ReturnType<typeof vi.fn>;
    }

    function makeView(doc = DOC): FakeView {
      return {
        state: EditorState.create({ doc }),
        visibleRanges: [{ from: 0, to: doc.length }],
        dispatch: vi.fn(),
      };
    }

    class FakeClient {
      nerCalls: string[] = [];
      classifyCalls: string[] = [];
      warmupCalls = 0;
      disposed = false;
      nerImpl: (text: string) => Promise<NerEntity[]> = async () => [];
      classifyImpl: (text: string) => Promise<ClassifyResult> = async () => ({
        labels: [],
        scores: [],
      });

      warmup() {
        this.warmupCalls += 1;
      }

      runNER(text: string) {
        this.nerCalls.push(text);
        return this.nerImpl(text);
      }

      runClassify(text: string) {
        this.classifyCalls.push(text);
        return this.classifyImpl(text);
      }

      dispose() {
        this.disposed = true;
      }
    }

    function makePlugin(view: FakeView, client: FakeClient) {
      return new DeepAnalysisPlugin(
        view as unknown as EditorView,
        client as unknown as DeepWorkerClient
      );
    }

    it('warms the models up on construction, before the user pauses to type', () => {
      const client = new FakeClient();
      makePlugin(makeView(), client);
      expect(client.warmupCalls).toBe(1);
    });

    it('analyzes the visible range after the debounce and dispatches NER decorations', async () => {
      const view = makeView();
      const client = new FakeClient();
      client.nerImpl = async () => [
        { entity_group: 'PER', score: 0.99, word: 'Angela Merkel', start: 0, end: 13 },
      ];
      makePlugin(view, client);

      await vi.advanceTimersByTimeAsync(400);

      expect(client.nerCalls).toEqual([DOC]);
      expect(view.dispatch).toHaveBeenCalled();
    });

    it('stays alive after a worker error and analyzes the next change', async () => {
      const view = makeView();
      const client = new FakeClient();
      client.nerImpl = async () => {
        throw new Error('model download failed');
      };
      client.classifyImpl = async () => {
        throw new Error('model download failed');
      };
      const plugin = makePlugin(view, client);

      await vi.advanceTimersByTimeAsync(400);
      expect(client.nerCalls).toHaveLength(1);

      // Recover: the next doc change must trigger a fresh analysis, not hit a
      // permanently-stuck "analyzing" latch.
      client.nerImpl = async () => [];
      plugin.update({ docChanged: true } as never);
      await vi.advanceTimersByTimeAsync(400);

      expect(client.nerCalls).toHaveLength(2);
    });

    it('drops results that arrive for an outdated document', async () => {
      const view = makeView();
      const client = new FakeClient();
      let releaseNer: (entities: NerEntity[]) => void = () => {};
      client.nerImpl = () =>
        new Promise((resolve) => {
          releaseNer = resolve;
        });
      makePlugin(view, client);

      await vi.advanceTimersByTimeAsync(400);
      expect(client.nerCalls).toHaveLength(1);

      // Document changes while the model is still thinking.
      view.state = EditorState.create({ doc: 'Completely different text now.' });
      releaseNer([{ entity_group: 'PER', score: 0.99, word: 'Angela Merkel', start: 0, end: 13 }]);
      await vi.advanceTimersByTimeAsync(0);

      // Stale offsets must never be dispatched into the new document.
      expect(view.dispatch).not.toHaveBeenCalled();
    });

    it('re-analyzes when the document changed during an in-flight analysis', async () => {
      const view = makeView();
      const client = new FakeClient();
      let releaseNer: (entities: NerEntity[]) => void = () => {};
      client.nerImpl = () =>
        new Promise((resolve) => {
          releaseNer = resolve;
        });
      const plugin = makePlugin(view, client);

      await vi.advanceTimersByTimeAsync(400);
      expect(client.nerCalls).toHaveLength(1);

      // A change arrives while analysis #1 is awaiting the model; its debounce
      // fires while "analyzing" is still true.
      view.state = EditorState.create({ doc: 'Barack Obama met the press.' });
      plugin.update({ docChanged: true } as never);
      await vi.advanceTimersByTimeAsync(400);
      expect(client.nerCalls).toHaveLength(1); // still blocked by run #1

      client.nerImpl = async () => [];
      releaseNer([]);
      await vi.advanceTimersByTimeAsync(400);

      // Run #2 must have been rescheduled and see the new document.
      expect(client.nerCalls).toHaveLength(2);
      expect(client.nerCalls[1]).toBe('Barack Obama met the press.');
    });

    it('disposes the worker client on destroy', () => {
      const client = new FakeClient();
      const plugin = makePlugin(makeView(), client);
      plugin.destroy();
      expect(client.disposed).toBe(true);
    });
  });
});
