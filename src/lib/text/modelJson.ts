/**
 * The JSON a model reply carries, as text: markdown fences (any case) and prose
 * around it are dropped, the span runs from the first opener to the last
 * matching closer. `arrays` also accepts a top-level array. Callers parse and
 * word their own errors; `none` and `unterminated` say which way it failed.
 */
export function sliceModelJson(
  raw: string,
  { arrays = false }: { arrays?: boolean } = {}
): { ok: true; text: string } | { ok: false; reason: 'none' | 'unterminated' } {
  const cleaned = raw.replace(/```(?:json)?/gi, '');
  const start = arrays ? cleaned.search(/[[{]/) : cleaned.indexOf('{');
  if (start === -1) return { ok: false, reason: 'none' };
  const end = cleaned.lastIndexOf(cleaned[start] === '{' ? '}' : ']');
  if (end <= start) return { ok: false, reason: 'unterminated' };
  return { ok: true, text: cleaned.slice(start, end + 1) };
}
