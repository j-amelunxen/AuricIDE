/**
 * The one CodeMirror view that serves every file tab, reachable from the save
 * handler.
 *
 * Formatted text has to go into the editor as an edit, not through the
 * `content` prop: a prop change is a whole-buffer swap that resets undo and
 * drops the cursor at the top, which is right for a tab switch and wrong for
 * a ⌘S that only moved some whitespace.
 */

import type { EditorView } from '@codemirror/view';
import { mapCursorThroughFormat, minimalReplacement } from './formatOnSave';

let activeView: EditorView | null = null;
// The editor serves every tab, so which file it shows is asked at apply time.
let activePath: () => string | undefined = () => undefined;

export function registerActiveEditor(
  view: EditorView | null,
  path: () => string | undefined = () => undefined
): void {
  activeView = view;
  activePath = path;
}

/**
 * Puts `after` into the editor as one undoable edit, provided the editor still
 * shows `path` and still holds `before` — text typed while the formatter ran
 * wins over the formatter.
 * True when applied. The edit is an ordinary change, so `onChange` marks the
 * tab dirty and schedules the write like any keystroke.
 */
export function applyFormattedText(path: string, before: string, after: string): boolean {
  const view = activeView;
  if (!view || activePath() !== path || view.state.doc.toString() !== before) return false;
  const cursor = mapCursorThroughFormat(before, after, view.state.selection.main.head);
  view.dispatch({
    changes: minimalReplacement(before, after),
    selection: { anchor: cursor },
    userEvent: 'input.format',
  });
  return true;
}
