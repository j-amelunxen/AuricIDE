/**
 * The user's own sentence about a starred project, read by agents choosing
 * where to work (`list_projects`, `descriptionSource: 'user'`). The twin limit
 * lives in Rust with the starred record: both sides trim, cut at 300
 * characters, then trim the cut. Empty clears it, and the project falls back
 * to a description derived from its README.
 */
export const DESCRIPTION_MAX_CHARS = 300;

export function normalizeProjectDescription(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = Array.from(raw.trim()).slice(0, DESCRIPTION_MAX_CHARS).join('').trim();
  return text.length > 0 ? text : null;
}
