import { history } from '@codemirror/commands';
import {
  Annotation,
  Compartment,
  Transaction,
  type EditorState,
  type Extension,
  type TransactionSpec,
} from '@codemirror/state';

/**
 * Marks a transaction that mirrors the buffer from outside the editor — a tab
 * switch handing over the next file's text, a refactoring that rewrote the
 * file on disk — as opposed to the user typing.
 *
 * The distinction matters because `onChange` feeds the autosave: a replacement
 * reported as an edit marks the tab dirty and writes the file back untouched,
 * which bumps its mtime and makes the explorer glow "modified" on every open.
 */
export const externalContentSync = Annotation.define<boolean>();

/**
 * True when every document-changing transaction in the update is an external
 * sync. One unannotated change among them is a real edit and must be reported.
 */
export function isExternalContentSync(update: {
  transactions: readonly Pick<Transaction, 'docChanged' | 'annotation'>[];
}): boolean {
  const changing = update.transactions.filter((tr) => tr.docChanged);
  return changing.length > 0 && changing.every((tr) => tr.annotation(externalContentSync));
}

// History sits in its own compartment so an external swap can drop it: a state
// field only restarts empty when it leaves the configuration and comes back.
const historyCompartment = new Compartment();

/** The editor's undo history, in the compartment `externalContentReplacement` resets. */
export function editorHistory(): Extension {
  return historyCompartment.of(history());
}

/**
 * The transactions that swap the whole buffer for `content` from outside the
 * editor, to be dispatched in order. The one editor serves every tab, so undo
 * must not reach across a swap: the swap itself would restore the previous
 * file's text, and earlier events mapped through it still apply — a deletion's
 * inverse is an insertion and would re-insert the previous file's text. Either
 * arrives as an unannotated change, which autosave writes to disk. So the swap
 * stays out of the history, and the history is emptied with it.
 */
export function externalContentReplacement(state: EditorState, content: string): TransactionSpec[] {
  return [
    {
      changes: { from: 0, to: state.doc.length, insert: content },
      annotations: [externalContentSync.of(true), Transaction.addToHistory.of(false)],
      effects: historyCompartment.reconfigure([]),
    },
    { effects: historyCompartment.reconfigure(history()) },
  ];
}
