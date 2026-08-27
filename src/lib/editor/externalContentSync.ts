import { Annotation, type Transaction } from '@codemirror/state';

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
