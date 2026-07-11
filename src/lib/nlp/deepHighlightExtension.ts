import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import type { NerEntity, ClassifyResult } from './deepAnalysisWorker';
import { DeepWorkerClient } from './deepWorkerClient';

// ── One calm treatment for every NER group ──
// The model is a whisper, not a rainbow: PER/ORG/LOC/MISC all share a single
// quiet class. The specific group still surfaces in the hover title. Colouring
// four entity kinds four ways competed with the heuristic layer for attention.
const NER_CLASS = 'cm-semantic-deep-entity';
const VALID_NER_GROUPS = new Set(['PER', 'ORG', 'LOC', 'MISC']);

// ── Intent → CSS class mapping for line decorations ──
const INTENT_CLASS_MAP: Record<string, string> = {
  instruction: 'cm-intent-instruction',
  explanation: 'cm-intent-explanation',
  warning: 'cm-intent-warning',
  question: 'cm-intent-question',
  context: 'cm-intent-context',
};

// Thresholds raised: an unreliable model must not guess *loudly*. Fewer, more
// confident hints beat a wall of maybes (Apple Responsibility §3).
const MIN_NER_CONFIDENCE = 0.7;
const MIN_INTENT_CONFIDENCE = 0.6;
const DEBOUNCE_MS = 300;
const INTENT_LABELS = ['instruction', 'explanation', 'warning', 'question', 'context'];

// ── State Effects ──
export const setDeepNerDecorations = StateEffect.define<DecorationSet>();
const setDeepIntentDecorations = StateEffect.define<DecorationSet>();

// ── State Fields: NER and intent are kept SEPARATE ──
// Previously both shared one field whose update did `result = e.value` for
// either effect, so an intent dispatch wiped the NER decorations (and vice
// versa) — the two could never render together. Two fields, each its own
// decoration provider, lets both survive.
export const deepNerField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    let result = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setDeepNerDecorations)) result = e.value;
    }
    return result;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const deepIntentField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    let result = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setDeepIntentDecorations)) result = e.value;
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

    if (!VALID_NER_GROUPS.has(entity.entity_group)) continue;

    const from = offset + entity.start;
    const to = offset + entity.end;

    if (from >= to) continue;

    ranges.push(
      Decoration.mark({
        class: NER_CLASS,
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

/**
 * Choose the paragraph whose intent is worth classifying: the first line of
 * real prose. Markdown headings are titles, not intents — classifying
 * "# Project Kickoff" asks the model a meaningless question.
 */
export function pickIntentParagraph(text: string): { text: string; offset: number } | null {
  let offset = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 10 && !trimmed.startsWith('#')) {
      return { text: line, offset };
    }
    offset += line.length + 1;
  }
  return null;
}

// ── View Plugin: triggers async analysis ──

function createDefaultClient(): DeepWorkerClient | null {
  try {
    const worker = new Worker(new URL('./deepAnalysisWorker.ts', import.meta.url), {
      type: 'module',
    });
    return new DeepWorkerClient(worker);
  } catch {
    // Worker may fail to load in non-browser environments
    return null;
  }
}

export class DeepAnalysisPlugin {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private analyzing = false;
  private dirty = false;

  constructor(
    private view: EditorView,
    private client: DeepWorkerClient | null = createDefaultClient()
  ) {
    // Preload the models while the user is still reading — the first analysis
    // should not also pay the download/compile cost (response, not latency).
    this.client?.warmup();
    this.scheduleAnalysis();
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
      void this.analyzeAsync();
    }, DEBOUNCE_MS);
  }

  private async analyzeAsync(): Promise<void> {
    if (!this.client) return;
    if (this.analyzing) {
      // A run is already awaiting the model; remember to go again with the
      // fresh document instead of silently dropping this analysis.
      this.dirty = true;
      return;
    }
    this.analyzing = true;

    try {
      const analyzedDoc = this.view.state.doc;

      for (const { from, to } of this.view.visibleRanges) {
        const text = analyzedDoc.sliceString(from, to);
        if (!text.trim()) continue;

        try {
          const entities = await this.client.runNER(text);
          // The model may answer seconds later; offsets from an outdated
          // document must not be dispatched into the current one.
          if (this.view.state.doc !== analyzedDoc) return;
          this.view.dispatch({
            effects: setDeepNerDecorations.of(buildNerDecorations(entities, from)),
          });
        } catch {
          // Model unavailable (offline, download failed) — stay quiet.
        }

        // Intent classification on the first substantial prose paragraph
        const paragraph = pickIntentParagraph(text);
        if (paragraph) {
          try {
            const result = await this.client.runClassify(paragraph.text, INTENT_LABELS);
            if (this.view.state.doc !== analyzedDoc) return;
            // Line decorations must anchor exactly at a line start.
            const lineFrom = analyzedDoc.lineAt(from + paragraph.offset).from;
            this.view.dispatch({
              effects: setDeepIntentDecorations.of(buildIntentDecorations(result, lineFrom)),
            });
          } catch {
            // Model unavailable — stay quiet.
          }
        }
      }
    } finally {
      this.analyzing = false;
      if (this.dirty) {
        this.dirty = false;
        this.scheduleAnalysis();
      }
    }
  }

  destroy() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.client?.dispose();
    this.client = null;
  }
}

const deepAnalysisPlugin = ViewPlugin.fromClass(DeepAnalysisPlugin);

export const deepHighlightExtension = [deepNerField, deepIntentField, deepAnalysisPlugin];
