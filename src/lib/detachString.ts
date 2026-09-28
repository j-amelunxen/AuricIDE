/**
 * A copy of `s` that does not share storage with the text it was cut from.
 *
 * V8 and JavaScriptCore both represent a substring as a view onto its parent,
 * so keeping a short slice of a large text keeps the whole text alive. Use this
 * for anything sliced out of a file's content and held beyond the call — an
 * index entry, a cache. The concatenation forces a fresh flat string; strings
 * below the engines' view threshold are copied anyway.
 */
export function detachString(s: string): string {
  return s.length < 13 ? s : (' ' + s).slice(1);
}
