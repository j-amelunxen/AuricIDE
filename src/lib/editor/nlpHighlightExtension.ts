import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { createVisibleRangeAnalyzer } from './visibleRangeSpans';

// Static decorations for fixed categories
const semanticDecorations = {
  entity: Decoration.mark({ class: 'cm-semantic-entity' }),
  keyword: Decoration.mark({ class: 'cm-semantic-keyword' }),

  // Prompt Framework
  'prompt-directive': Decoration.mark({ class: 'cm-semantic-prompt-directive' }),
  'prompt-context': Decoration.mark({ class: 'cm-semantic-prompt-context' }),
  'prompt-constraint': Decoration.mark({ class: 'cm-semantic-prompt-constraint' }),
};

function buildDecorations(
  view: EditorView,
  analyze: ReturnType<typeof createVisibleRangeAnalyzer>
): DecorationSet {
  const { doc } = view.state;
  const builder: Range<Decoration>[] = [];
  const ranges = view.visibleRanges;
  const spansPerRange = analyze(ranges.map(({ from, to }) => doc.sliceString(from, to)));

  for (let i = 0; i < ranges.length; i++) {
    const { from } = ranges[i];
    for (const span of spansPerRange[i]) {
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
    private readonly analyze = createVisibleRangeAnalyzer();

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view, this.analyze);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view, this.analyze);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
