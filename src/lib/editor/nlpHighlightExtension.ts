import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { analyzeText } from '@/lib/nlp/highlighter';

// Static decorations for fixed categories
const semanticDecorations = {
  entity: Decoration.mark({ class: 'cm-semantic-entity' }),
  keyword: Decoration.mark({ class: 'cm-semantic-keyword' }),

  // Prompt Framework
  'prompt-directive': Decoration.mark({ class: 'cm-semantic-prompt-directive' }),
  'prompt-context': Decoration.mark({ class: 'cm-semantic-prompt-context' }),
  'prompt-constraint': Decoration.mark({ class: 'cm-semantic-prompt-constraint' }),
};

function buildDecorations(view: EditorView): DecorationSet {
  const { doc } = view.state;
  const builder: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    const text = doc.sliceString(from, to);
    const spans = analyzeText(text);

    for (const span of spans) {
      const decoration = semanticDecorations[span.type];
      if (decoration) {
        builder.push(decoration.range(from + span.from, from + span.to));
      }
    }
  }

  return Decoration.set(builder, true);
}

export const nlpHighlightExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
