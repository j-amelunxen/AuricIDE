import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import type { NerEntity, ClassifyResult } from './deepAnalysisWorker';

// ── NER entity type → CSS class mapping ──
const NER_CLASS_MAP: Record<string, string> = {
  PER: 'cm-semantic-deep-entity-per',
  ORG: 'cm-semantic-deep-entity-org',
  LOC: 'cm-semantic-deep-entity-loc',
  MISC: 'cm-semantic-deep-entity-misc',
};

// ── Intent → CSS class mapping for line decorations ──
const INTENT_CLASS_MAP: Record<string, string> = {
  instruction: 'cm-intent-instruction',
  explanation: 'cm-intent-explanation',
  warning: 'cm-intent-warning',
  question: 'cm-intent-question',
  context: 'cm-intent-context',
};

const MIN_NER_CONFIDENCE = 0.5;
const MIN_INTENT_CONFIDENCE = 0.5;
const DEBOUNCE_MS = 300;
const INTENT_LABELS = ['instruction', 'explanation', 'warning', 'question', 'context'];

// ── State Effects ──
export const setDeepNerDecorations = StateEffect.define<DecorationSet>();
const setDeepIntentDecorations = StateEffect.define<DecorationSet>();

// ── State Field: holds combined deep decorations ──
export const deepDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    let result = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setDeepNerDecorations) || e.is(setDeepIntentDecorations)) {
        // Merge: replace with new value (latest wins per effect type)
        result = e.value;
      }
    }
    return result;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Decoration builders (exported for testing) ──

/**
 * Build mark decorations from NER entities.
 * @param entities NER results from the worker
 * @param offset Character offset of the analyzed text within the document
 */
export function buildNerDecorations(entities: NerEntity[], offset: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];

  for (const entity of entities) {
    if (entity.score < MIN_NER_CONFIDENCE) continue;

    const cls = NER_CLASS_MAP[entity.entity_group];
    if (!cls) continue;

    const from = offset + entity.start;
    const to = offset + entity.end;

    if (from >= to) continue;

    ranges.push(
      Decoration.mark({
        class: cls,
        attributes: {
          title: `${entity.entity_group}: ${entity.word} (${(entity.score * 100).toFixed(0)}%)`,
        },
      }).range(from, to)
    );
  }

  ranges.sort((a, b) => a.from - b.from);
  return Decoration.set(ranges, true);
}

/**
 * Build a line decoration for paragraph intent classification.
 * @param result Classification result from the worker
 * @param lineFrom Start position of the line in the document
 */
export function buildIntentDecorations(result: ClassifyResult, lineFrom: number): DecorationSet {
  if (!result.labels.length || !result.scores.length) return Decoration.none;

  const topScore = result.scores[0];
  const topLabel = result.labels[0];

  if (topScore < MIN_INTENT_CONFIDENCE) return Decoration.none;

  const cls = INTENT_CLASS_MAP[topLabel];
  if (!cls) return Decoration.none;

  return Decoration.set([Decoration.line({ class: cls }).range(lineFrom)]);
}

// ── View Plugin: triggers async analysis ──
class DeepAnalysisPlugin {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private worker: Worker | null = null;
  private analyzing = false;
  private pendingNer: Map<string, (entities: NerEntity[]) => void> = new Map();
  private pendingClassify: Map<string, (result: ClassifyResult) => void> = new Map();
  private idCounter = 0;

  constructor(private view: EditorView) {
    this.initWorker();
    this.scheduleAnalysis();
  }

  private initWorker() {
    try {
      this.worker = new Worker(new URL('./deepAnalysisWorker.ts', import.meta.url), {
        type: 'module',
      });

      this.worker.onmessage = (event) => {
        const { status, task, id, output } = event.data;
        if (status === 'progress') return;

        if (status === 'complete' && task === 'ner') {
          const resolve = this.pendingNer.get(id);
          if (resolve) {
            this.pendingNer.delete(id);
            resolve(output as NerEntity[]);
          }
        }

        if (status === 'complete' && task === 'classify') {
          const resolve = this.pendingClassify.get(id);
          if (resolve) {
            this.pendingClassify.delete(id);
            resolve(output as ClassifyResult);
          }
        }
      };
    } catch {
      // Worker may fail to load in non-browser environments
      this.worker = null;
    }
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      this.scheduleAnalysis();
    }
  }

  private scheduleAnalysis() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.analyzeAsync();
    }, DEBOUNCE_MS);
  }

  private nextId(): string {
    return `deep-ext-${++this.idCounter}`;
  }

  private runNER(text: string): Promise<NerEntity[]> {
    return new Promise((resolve) => {
      const id = this.nextId();
      this.pendingNer.set(id, resolve);
      this.worker?.postMessage({ type: 'ner', text, id });
    });
  }

  private runClassify(text: string, labels: string[]): Promise<ClassifyResult> {
    return new Promise((resolve) => {
      const id = this.nextId();
      this.pendingClassify.set(id, resolve);
      this.worker?.postMessage({ type: 'classify', text, labels, id });
    });
  }

  private async analyzeAsync() {
    if (this.analyzing || !this.worker) return;
    this.analyzing = true;

    try {
      const { doc } = this.view.state;
      const visibleRanges = this.view.visibleRanges;

      for (const { from, to } of visibleRanges) {
        const text = doc.sliceString(from, to);
        if (!text.trim()) continue;

        // Run NER
        try {
          const entities = await this.runNER(text);
          const nerDecos = buildNerDecorations(entities, from);
          this.view.dispatch({ effects: setDeepNerDecorations.of(nerDecos) });
        } catch {
          // NER failed, skip
        }

        // Run intent classification on first paragraph
        const firstParagraph = text.split('\n').find((line) => line.trim().length > 10);
        if (firstParagraph) {
          const paraFrom = text.indexOf(firstParagraph);
          const docLineFrom = from + paraFrom;

          try {
            const result = await this.runClassify(firstParagraph, INTENT_LABELS);
            const intentDecos = buildIntentDecorations(result, docLineFrom);
            this.view.dispatch({ effects: setDeepIntentDecorations.of(intentDecos) });
          } catch {
            // Classification failed, skip
          }
        }
      }
    } finally {
      this.analyzing = false;
    }
  }

  destroy() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.worker?.terminate();
    this.worker = null;
  }
}

const deepAnalysisPlugin = ViewPlugin.fromClass(DeepAnalysisPlugin);

export const deepHighlightExtension = [deepDecorationField, deepAnalysisPlugin];
