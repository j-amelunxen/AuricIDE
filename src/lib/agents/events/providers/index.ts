import type { AgentEvent } from '../types';
import { createClaudeMatcher } from './claude';
import { matchCodexLine } from './codex';
import { matchGenericLine } from './generic';

/** Classifies one already-clean (ANSI-stripped) line of agent output. */
export type LineMatcher = (line: string) => Omit<AgentEvent, 'at'> | null;

/**
 * Picks the line matcher for a provider id, falling back to the
 * provider-agnostic one for any CLI without a dedicated TUI parser.
 * Returns a fresh matcher instance each call — Claude's needs a sliver of
 * per-agent memory (see `createClaudeMatcher`), so callers must not share one
 * matcher across agents.
 */
export function resolveMatcher(providerId: string): LineMatcher {
  switch (providerId) {
    case 'claude':
      return createClaudeMatcher();
    case 'codex':
      return matchCodexLine;
    default:
      return matchGenericLine;
  }
}
