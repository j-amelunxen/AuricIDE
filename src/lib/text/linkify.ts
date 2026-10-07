export type TextPart = { type: 'text' | 'link'; value: string };

// Only https (the opener capability allows nothing else). Anything else (http:, javascript:, file:, data:) must stay plain text:
// this regex is the boundary between "text a user typed" and "something we open".
const URL_PATTERN = /https:\/\/[^\s<>"'—]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/** Splits text into plain parts and https links, in order, without losing a character. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, '');
    const start = match.index;
    if (start > cursor) parts.push({ type: 'text', value: text.slice(cursor, start) });
    parts.push({ type: 'link', value: url });
    cursor = start + url.length;
  }
  if (cursor < text.length) parts.push({ type: 'text', value: text.slice(cursor) });
  return parts;
}

export function hasLinks(text: string): boolean {
  return splitLinks(text).some((p) => p.type === 'link');
}
