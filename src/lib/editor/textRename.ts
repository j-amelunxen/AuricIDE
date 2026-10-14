/**
 * Text-level rename for the unlocked diff editor. There is no language server
 * behind it: it replaces whole identifiers in one file, nothing more.
 */
const IDENT = /^[A-Za-z_$][\w$]*$/;
const WORD_CHAR = /[\w$]/;

export function isIdentifier(text: string): boolean {
  return IDENT.test(text);
}

function wordPattern(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g');
}

export function countWordMatches(content: string, word: string): number {
  if (!word) return 0;
  return content.match(wordPattern(word))?.length ?? 0;
}

/** Start/end offsets of every whole-word hit, for edits that keep the rest of the document's marks. */
export function wordMatchRanges(
  content: string,
  word: string
): Array<{ from: number; to: number }> {
  if (!word) return [];
  return [...content.matchAll(wordPattern(word))].map((m) => ({
    from: m.index,
    to: m.index + m[0].length,
  }));
}

export function renameWord(content: string, from: string, to: string): string {
  if (!isIdentifier(to)) throw new Error(`"${to}" is not a valid identifier`);
  if (!from) return content;
  return content.replace(wordPattern(from), to);
}

/** The identifier touching `pos` (before or after the caret), or null. */
export function wordAt(content: string, pos: number): string | null {
  let start = pos;
  let end = pos;
  while (start > 0 && WORD_CHAR.test(content[start - 1])) start--;
  while (end < content.length && WORD_CHAR.test(content[end])) end++;
  return start === end ? null : content.slice(start, end);
}
