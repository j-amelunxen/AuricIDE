import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { externalContentSync, isExternalContentSync } from './externalContentSync';

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
