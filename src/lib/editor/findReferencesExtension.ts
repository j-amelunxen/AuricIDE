import { Facet } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';
import { EditorView } from '@codemirror/view';
import type { ReferenceResult } from '@/lib/refactoring/findReferences';
import { ENTITY_REGEX } from '@/lib/nlp/patterns';

export type ShowReferencesCallback = (
  query: string,
  queryType: 'heading' | 'entity' | 'wikilink',
  results: ReferenceResult[]
) => void;

export const showReferencesFacet = Facet.define<ShowReferencesCallback, ShowReferencesCallback>({
  combine: (values) => values[0] ?? (() => {}),
});

/**
 * Get the word at the cursor position. Returns the word and its boundaries.
 */
function getWordAtCursor(view: EditorView): { word: string; from: number; to: number } | null {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const lineText = line.text;
  const col = pos - line.from;

  // Find word boundaries around cursor
  let start = col;
  let end = col;

  while (start > 0 && /\w/.test(lineText[start - 1])) start--;
  while (end < lineText.length && /\w/.test(lineText[end])) end++;

  if (start === end) return null;

  return {
    word: lineText.slice(start, end),
    from: line.from + start,
    to: line.from + end,
  };
}

/**
 * Determine query type from cursor context:
 * - If the line starts with #, it's a heading
 * - If the word matches ENTITY_REGEX, it's an entity
 * - Otherwise treat it as a wikilink target
 */
function determineQueryType(
  view: EditorView
): { query: string; queryType: 'heading' | 'entity' | 'wikilink' } | null {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const lineText = line.text;

  // Check if the line is a heading
  const headingMatch = /^(#{1,6})\s+(.*)$/.exec(lineText);
  if (headingMatch) {
    return { query: headingMatch[2].trim(), queryType: 'heading' };
  }

  // Get word at cursor
  const wordInfo = getWordAtCursor(view);
  if (!wordInfo) return null;

  // Check if the word matches ENTITY_REGEX
  ENTITY_REGEX.lastIndex = 0;
  if (ENTITY_REGEX.test(wordInfo.word)) {
    return { query: wordInfo.word, queryType: 'entity' };
  }

  // Default to wikilink
  return { query: wordInfo.word, queryType: 'wikilink' };
}

function runFindReferences(view: EditorView): boolean {
  const callback = view.state.facet(showReferencesFacet);
  const info = determineQueryType(view);

  if (info) {
    callback(info.query, info.queryType, []);
  }

  return true;
}

export const findReferencesKeymap: KeyBinding[] = [
  { key: 'Alt-F7', run: runFindReferences },
  { key: 'Shift-F12', run: runFindReferences },
];
