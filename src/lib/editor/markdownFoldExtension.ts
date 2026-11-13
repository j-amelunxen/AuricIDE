import { type EditorState, type Extension } from '@codemirror/state';
import { foldGutter, foldKeymap, foldService } from '@codemirror/language';
import { keymap } from '@codemirror/view';
import { extractHeadings, matchHeadingLine } from '../markdown/markdownHeadingParser';

/**
 * Compute the fold range for a heading line.
 * A heading at level N folds from end-of-heading-line to just before
 * the next heading at level <= N (or EOF).
 */
export function getMarkdownFoldRange(
  state: EditorState,
  lineFrom: number,
  lineTo: number
): { from: number; to: number } | null {
  const doc = state.doc.toString();
  const line = state.doc.lineAt(lineFrom);
  const lineText = line.text;

  const match = matchHeadingLine(lineText);
  if (!match) return null;

  const level = match.level;
  const headings = extractHeadings(doc);

  const idx = headings.findIndex((h) => h.from === lineFrom);
  if (idx === -1) return null;

  // Find the next heading at level <= this level (fold boundary)
  let foldEnd = doc.length;
  for (let j = idx + 1; j < headings.length; j++) {
    if (headings[j].level <= level) {
      foldEnd = headings[j].from - 1;
      break;
    }
  }

  const foldFrom = lineTo;

  if (foldFrom >= foldEnd) return null;

  return { from: foldFrom, to: foldEnd };
}

const markdownFoldService = foldService.of((state, lineFrom, lineTo) => {
  return getMarkdownFoldRange(state, lineFrom, lineTo);
});

export const markdownFoldExtension: Extension[] = [
  markdownFoldService,
  foldGutter({ openText: '\u25BE', closedText: '\u25B8' }),
  keymap.of(foldKeymap),
];
