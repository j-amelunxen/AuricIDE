/** Longest derived name before it is elided. */
export const AGENT_NAME_MAX_CHARS = 34;

/**
 * Openers that carry no information about the work. Trimmed so "Please fix the
 * login redirect" becomes "Fix the login redirect" rather than a column of
 * agents all starting with the same word.
 */
const POLITE_OPENERS = /^(please|bitte|can you|could you|kannst du|könntest du|hey|hi)\s+/i;

/** The stand-in the spawn dialog sends when deployed with an empty prompt. */
const PLACEHOLDER_TASK = /^wait$/i;

/** A name worth showing has at least one letter or digit. */
const HAS_WORDS = /[\p{L}\p{N}]/u;

function fallbackName(repoName?: string): string {
  return repoName ? `Agent (${repoName})` : 'Agent';
}

/**
 * A short, human-readable name for a new agent, taken from the instruction it
 * is being started with. Every agent in a repo used to be called
 * "Agent (repo)", which makes a fleet of five unreadable; the first words of
 * the task are what the person actually remembers it by.
 */
export function deriveAgentName(task: string, repoName?: string): string {
  const firstLine = task.split('\n')[0].replace(/\s+/g, ' ').trim();
  if (!firstLine || !HAS_WORDS.test(firstLine) || PLACEHOLDER_TASK.test(firstLine)) {
    return fallbackName(repoName);
  }

  const withoutOpener = firstLine.replace(POLITE_OPENERS, '').trim();
  const base = withoutOpener || firstLine;
  const capitalised = base.charAt(0).toUpperCase() + base.slice(1);

  if (capitalised.length <= AGENT_NAME_MAX_CHARS) return capitalised;

  // Cut back to the last whole word so the name never ends mid-word.
  const clipped = capitalised.slice(0, AGENT_NAME_MAX_CHARS);
  const lastSpace = clipped.lastIndexOf(' ');
  const trimmed = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
  return `${trimmed.replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * Disambiguates a name against the fleet, so two agents started from the same
 * instruction don't end up indistinguishable.
 */
export function uniqueAgentName(name: string, existingNames: string[]): string {
  const taken = new Set(existingNames);
  if (!taken.has(name)) return name;

  let suffix = 2;
  while (taken.has(`${name} ${suffix}`)) suffix++;
  return `${name} ${suffix}`;
}
