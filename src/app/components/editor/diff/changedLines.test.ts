import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { changedLinesExtension } from './changedLines';

function markedLines(view: EditorView): number[] {
  const marked: number[] = [];
  for (let i = 1; i <= view.state.doc.lines; i++) {
    const from = view.state.doc.line(i).from;
    let hit = false;
    for (const set of view.state.facet(EditorView.decorations)) {
      const value = typeof set === 'function' ? set(view) : set;
      value.between(from, from, () => {
        hit = true;
      });
    }
    if (hit) marked.push(i);
  }
  return marked;
}

describe('changedLinesExtension', () => {
  it('marks the given lines and ignores numbers outside the document', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: 'a\nb\nc', extensions: [changedLinesExtension([2, 9])] }),
    });
    expect(markedLines(view)).toEqual([2]);
  });

  it('moves a mark along when lines are inserted above it', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: 'a\nb\nc', extensions: [changedLinesExtension([2])] }),
    });
    view.dispatch({ changes: { from: 0, insert: 'new\n' } });
    expect(markedLines(view)).toEqual([3]);
  });
});
