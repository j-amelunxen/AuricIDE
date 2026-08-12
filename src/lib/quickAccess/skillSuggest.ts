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
