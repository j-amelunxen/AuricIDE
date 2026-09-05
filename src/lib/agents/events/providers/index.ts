import { createClaudeMatcher } from './claude';
import { matchCodexLine } from './codex';
import { matchGenericLine } from './generic';

import type { LineMatcher } from './types';
export type { LineMatcher };

/**
 * Picks the line matcher for a provider id, falling back to the
 * provider-agnostic one for any CLI without a dedicated TUI parser. Matched
 * by family rather than exact id — `claude-code`, `my-claude-wrapper`, and
 * plain `claude` all run the same TUI, and the id comparison is
 * case-insensitive. Returns a fresh matcher instance each call — Claude's
 * needs a sliver of per-agent memory (see `createClaudeMatcher`), so callers
 * must not share one matcher across agents.
 */
export function resolveMatcher(providerId: string): LineMatcher {
  const id = providerId.toLowerCase();
  if (id.includes('claude')) return createClaudeMatcher();
  if (id.includes('codex')) return matchCodexLine;
  return matchGenericLine;
}
