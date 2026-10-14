import { RangeSetBuilder, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/**
 * Keeps the diff's green background on the lines the patch added. The marks are
 * mapped through every edit, so a line stays marked while it is typed in.
 */
export function changedLinesExtension(lineNumbers: readonly number[]): Extension {
  return [
    StateField.define<DecorationSet>({
      create(state) {
        const changedLine = Decoration.line({ class: 'cm-diff-changed-line' });
        const builder = new RangeSetBuilder<Decoration>();
        const sorted = [...new Set(lineNumbers)].sort((a, b) => a - b);
        for (const no of sorted) {
          if (no >= 1 && no <= state.doc.lines)
            builder.add(state.doc.line(no).from, state.doc.line(no).from, changedLine);
        }
        return builder.finish();
      },
      update(value, tr) {
        return value.map(tr.changes);
      },
      provide: (field) => EditorView.decorations.from(field),
    }),
    EditorView.theme({
      '.cm-diff-changed-line': { backgroundColor: 'rgba(34, 197, 94, 0.14)' },
    }),
  ];
}
