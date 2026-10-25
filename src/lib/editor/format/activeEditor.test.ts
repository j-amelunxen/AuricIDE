import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { applyFormattedText, registerActiveEditor } from './activeEditor';

function editor(doc: string, cursor: number, onChange?: (text: string) => void) {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [
        history(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange?.(update.state.doc.toString());
        }),
      ],
    }),
    parent: document.body,
  });
  registerActiveEditor(view, () => '/p/a.ts');
  return view;
}

afterEach(() => registerActiveEditor(null));

describe('applyFormattedText', () => {
  it('puts the formatted text in as an edit the editor reports, keeping the cursor', () => {
    const changes: string[] = [];
    const view = editor('let x=1\nlet y=2', 'let x=1\nlet y'.length, (t) => changes.push(t));
    expect(applyFormattedText('/p/a.ts', 'let x=1\nlet y=2', 'let x = 1;\nlet y = 2;\n')).toBe(
      true
    );
    expect(view.state.doc.toString()).toBe('let x = 1;\nlet y = 2;\n');
    expect(view.state.doc.sliceString(0, view.state.selection.main.head)).toBe('let x = 1;\nlet y');
    expect(changes).toEqual(['let x = 1;\nlet y = 2;\n']);
    view.destroy();
  });

  it('is one undo step', () => {
    const view = editor('a=1', 0);
    applyFormattedText('/p/a.ts', 'a=1', 'a = 1\n');
    undo(view);
    expect(view.state.doc.toString()).toBe('a=1');
    view.destroy();
  });

  it('refuses when the buffer changed while the formatter ran', () => {
    const view = editor('a=12', 0);
    expect(applyFormattedText('/p/a.ts', 'a=1', 'a = 1\n')).toBe(false);
    expect(view.state.doc.toString()).toBe('a=12');
    view.destroy();
  });

  it('refuses when the editor shows another file by now', () => {
    const view = editor('a=1', 0);
    expect(applyFormattedText('/p/other.ts', 'a=1', 'a = 1\n')).toBe(false);
    expect(view.state.doc.toString()).toBe('a=1');
    view.destroy();
  });

  it('refuses without an editor', () => {
    expect(applyFormattedText('/p/a.ts', 'a', 'b')).toBe(false);
  });
});
