/** A token is worth showing as a path once it contains a separator or ends in an extension. */
const PATH_CHARS = /^[\w./@$-]+$/;
const HAS_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;

/** Strips the quotes/parens/punctuation a tool call or shell line wraps a path in. */
function stripEnclosing(token: string): string {
  return token.replace(/^[("'`]+/, '').replace(/[)"'`,:;.]+$/, '');
}

/**
 * The first path-shaped token in a line of tool output — a file argument
 * printed with `/` in it, or a bare filename with a recognisable extension.
 * Returns undefined when nothing in the line looks like a path, which is the
 * common case for shell commands and search patterns.
 */
export function extractPath(text: string): string | undefined {
  for (const raw of text.split(/\s+/)) {
    const token = stripEnclosing(raw);
    if (!token || !PATH_CHARS.test(token)) continue;
    if (token.includes('/') || HAS_EXTENSION.test(token)) return token;
  }
  return undefined;
}

/** Longest a note label may run before it is elided — a feed row, not a paragraph. */
export const NOTE_MAX_CHARS = 120;

/** Collapses internal whitespace and elides text past `NOTE_MAX_CHARS`. */
export function truncateLabel(text: string, max = NOTE_MAX_CHARS): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}
