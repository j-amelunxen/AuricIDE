import { matchHeadingLine } from '@/lib/markdown/markdownHeadingParser';
import { Facet } from '@codemirror/state';
import { keymap, type KeyBinding } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export type RenameHeadingCallback = (headingTitle: string, lineNumber: number) => void;

export const renameHeadingCallbackFacet = Facet.define<
  RenameHeadingCallback,
  RenameHeadingCallback
>({
  combine: (values) => values[0] ?? (() => {}),
});

const renameHeadingKeyBinding: KeyBinding = {
  key: 'F2',
  run: (view) => {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const match = matchHeadingLine(line.text);

    if (!match) return false;

    const title = match.title;
    const callback = view.state.facet(renameHeadingCallbackFacet);
    callback(title, line.number);

    return true;
  },
};

export const renameHeadingExtension: Extension = keymap.of([renameHeadingKeyBinding]);
