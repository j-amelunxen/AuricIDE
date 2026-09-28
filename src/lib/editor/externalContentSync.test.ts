import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from '@codemirror/state';
import { undo } from '@codemirror/commands';
import {
  editorHistory,
  externalContentReplacement,
  externalContentSync,
  isExternalContentSync,
} from './externalContentSync';

function replaceAll(state: EditorState, insert: string, external: boolean) {
  return state.update({
    changes: { from: 0, to: state.doc.length, insert },
    annotations: external ? externalContentSync.of(true) : [],
  });
}

describe('isExternalContentSync', () => {
  it('recognises a buffer replacement that mirrors content from outside the editor', () => {
    const state = EditorState.create({ doc: 'file A' });
    const tr = replaceAll(state, 'file B', true);
    expect(tr.docChanged).toBe(true);
    expect(isExternalContentSync({ transactions: [tr] })).toBe(true);
  });

  it('treats an unannotated document change as a user edit', () => {
    const state = EditorState.create({ doc: 'file A' });
    const tr = replaceAll(state, 'file A, edited', false);
    expect(isExternalContentSync({ transactions: [tr] })).toBe(false);
  });

  it('is a user edit as soon as one document-changing transaction is unannotated', () => {
    const state = EditorState.create({ doc: 'file A' });
    const sync = replaceAll(state, 'file B', true);
    const typed = replaceAll(sync.state, 'file B!', false);
    expect(isExternalContentSync({ transactions: [sync, typed] })).toBe(false);
  });

  it('ignores annotated transactions that leave the document alone', () => {
    const state = EditorState.create({ doc: 'file A' });
    const selectionOnly = state.update({
      selection: { anchor: 2 },
      annotations: externalContentSync.of(true),
    });
    const typed = replaceAll(state, 'file A!', false);
    expect(isExternalContentSync({ transactions: [selectionOnly, typed] })).toBe(false);
  });

  it('is not a sync when nothing changed the document', () => {
    expect(isExternalContentSync({ transactions: [] })).toBe(false);
  });
});

// One editor serves every tab; a tab switch replaces the whole buffer. When
// that replacement entered the undo history, Cmd+Z after switching A → B put
// A's text into B, reported it as a user edit, and autosave wrote it to B.
describe('externalContentReplacement', () => {
  function editorWith(doc: string) {
    let state = EditorState.create({ doc, extensions: [editorHistory()] });
    const userEdits: string[] = [];
    const apply = (tr: Transaction) => {
      state = tr.state;
      if (tr.docChanged && !isExternalContentSync({ transactions: [tr] })) {
        userEdits.push(tr.state.doc.toString());
      }
    };
    return {
      get doc() {
        return state.doc.toString();
      },
      userEdits,
      switchTo: (content: string) => {
        for (const spec of externalContentReplacement(state, content)) apply(state.update(spec));
      },
      edit: (from: number, to: number, insert: string) =>
        apply(state.update({ changes: { from, to, insert }, userEvent: 'input' })),
      type: (insert: string) =>
        apply(state.update({ changes: { from: state.doc.length, insert }, userEvent: 'input' })),
      undo: () => undo({ state, dispatch: apply }),
    };
  }

  it('keeps a tab switch out of the undo history', () => {
    const editor = editorWith('file A');
    editor.switchTo('file B');
    expect(editor.undo()).toBe(false);
    expect(editor.doc).toBe('file B');
    expect(editor.userEdits).toEqual([]);
  });

  it('does not replay edits made in the previous file onto the next one', () => {
    const editor = editorWith('file A');
    editor.type(' edited');
    editor.switchTo('file B');
    editor.undo();
    expect(editor.doc).toBe('file B');
    expect(editor.userEdits).toEqual(['file A edited']);
  });

  // Earlier events are not dropped by keeping the swap out of history: they are
  // mapped through it. An insertion maps to nothing, but a deletion's inverse is
  // an insertion, and that survives the mapping into the next file.
  it('does not re-insert text deleted in the previous file', () => {
    const editor = editorWith('hello foo world');
    editor.edit(6, 10, '');
    editor.switchTo('file B content');
    expect(editor.undo()).toBe(false);
    expect(editor.doc).toBe('file B content');
    expect(editor.userEdits).toEqual(['hello world']);
  });

  it('does not replay a replace-style edit from the previous file', () => {
    const editor = editorWith('# Title\nsome   text');
    editor.edit(0, editor.doc.length, '# Title\n\nsome text\n');
    editor.switchTo('file B content');
    expect(editor.undo()).toBe(false);
    expect(editor.doc).toBe('file B content');
  });

  it('still undoes an edit made after the switch, and stops at the switched-in text', () => {
    const editor = editorWith('file A');
    editor.switchTo('file B');
    editor.type('!');
    expect(editor.undo()).toBe(true);
    expect(editor.doc).toBe('file B');
    expect(editor.undo()).toBe(false);
    expect(editor.doc).toBe('file B');
  });
});
