import fuzzysort from 'fuzzysort';
import type { ProjectSkill } from '../tauri/projectSkills';

/**
 * How many suggestions a popup offers at once. Small on purpose: the list is
 * meant to be read in one glance and arrowed through, not scrolled. Anything
 * past this is reached by typing another character, which is faster anyway.
 */
export const SKILL_SUGGESTION_LIMIT = 8;

/** Project definitions first: they are the specific answer, user ones the generic. */
function projectFirst(skills: ProjectSkill[]): ProjectSkill[] {
  return [
    ...skills.filter((skill) => skill.scope === 'project'),
    ...skills.filter((skill) => skill.scope !== 'project'),
  ];
}

/**
 * The skills worth offering for what has been typed so far.
 *
 * An empty query — including the bare `/` that opens the popup — is not "no
 * matches" but "everything", so the field doubles as a browser for anyone who
 * cannot remember the name. A query is matched against both the invocation and
 * the human name, with gaps allowed, because people recall `/frontend:component`
 * as "component" about as often as they recall the namespace.
 */
export function suggestSkills(query: string, discovered: ProjectSkill[]): ProjectSkill[] {
  const needle = query.trim().replace(/^\//, '');
  if (needle.length === 0) return projectFirst(discovered).slice(0, SKILL_SUGGESTION_LIMIT);

  return fuzzysort
    .go(needle, discovered, {
      keys: ['invocation', 'name'],
      limit: SKILL_SUGGESTION_LIMIT,
    })
    .map((result) => result.obj);
}

export interface SkillToken {
  /** Index of the `/` that opens the token. */
  start: number;
  /** Cursor index — the query is `text.slice(start, end)`. */
  end: number;
  query: string;
  /** First index after the token, so a pick replaces the whole `/…` word. */
  tokenEnd: number;
}

function isTokenBoundary(char: string | undefined): boolean {
  return char === undefined || char === ' ' || char === '\n' || char === '\t';
}

/**
 * The `/skill` word the cursor is in, if any.
 *
 * A slash only counts at a word boundary — start of the field, after
 * whitespace, after a newline — so `http://…` and prose never open the list.
 * The query stops at the cursor; `tokenEnd` still covers the rest of the word
 * so picking a suggestion replaces `/cha|ngelog`, not just `/cha`.
 */
export function skillTokenAtCursor(text: string, cursor: number): SkillToken | null {
  const pos = Math.max(0, Math.min(cursor, text.length));
  let start = pos;
  while (start > 0 && !isTokenBoundary(text[start - 1])) start -= 1;
  if (pos === start || text[start] !== '/') return null;

  let tokenEnd = start + 1;
  while (tokenEnd < text.length && !isTokenBoundary(text[tokenEnd])) tokenEnd += 1;
  if (pos > tokenEnd) return null;

  return { start, end: pos, query: text.slice(start, pos), tokenEnd };
}

/**
 * Swap the token for a known invocation and leave a single trailing space,
 * so the next keystroke continues the prompt rather than extending the name.
 */
export function applySkillInvocation(
  text: string,
  token: SkillToken,
  invocation: string
): { text: string; cursor: number } {
  const afterRaw = text.slice(token.tokenEnd);
  const after = afterRaw.startsWith(' ') ? afterRaw.slice(1) : afterRaw;
  const insert = `${invocation} `;
  return {
    text: text.slice(0, token.start) + insert + after,
    cursor: token.start + insert.length,
  };
}
