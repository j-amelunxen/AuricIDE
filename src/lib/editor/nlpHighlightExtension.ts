import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { analyzeText } from '@/lib/nlp/highlighter';

// Static decorations for fixed categories
const semanticDecorations = {
  entity: Decoration.mark({ class: 'cm-semantic-entity' }),
  action: Decoration.mark({ class: 'cm-semantic-action' }),
  keyword: Decoration.mark({ class: 'cm-semantic-keyword' }),
  negated: Decoration.mark({ class: 'cm-semantic-negated' }),

  // Prompt Framework
  'prompt-directive': Decoration.mark({ class: 'cm-semantic-prompt-directive' }),
  'prompt-context': Decoration.mark({ class: 'cm-semantic-prompt-context' }),
  'prompt-constraint': Decoration.mark({ class: 'cm-semantic-prompt-constraint' }),
  'variable-hash': null, // Dynamic, handled separately
};

function buildDecorations(view: EditorView): DecorationSet {
  const { doc } = view.state;
  const builder: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    const text = doc.sliceString(from, to);
    const spans = analyzeText(text);

    for (const span of spans) {
      if (span.type === 'variable-hash' && span.hashColor) {
        // Dynamic decoration for hashed variables
        builder.push(
          Decoration.mark({
            attributes: {
              style: `color: ${span.hashColor}; font-weight: bold; text-shadow: 0 0 5px ${span.hashColor}40;`,
            },
          }).range(from + span.from, from + span.to)
        );
      } else {
        const decoration = semanticDecorations[span.type];
        if (decoration) {
          builder.push(decoration.range(from + span.from, from + span.to));
        }
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
