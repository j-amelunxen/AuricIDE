import type { AgentEvent } from './types';

/**
 * The files an agent has actually changed, in the order it first touched
 * each one. Reads are deliberately excluded — this answers "what did it
 * write", not "what did it look at".
 */
export function filesTouched(events: AgentEvent[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const event of events) {
    if (event.kind !== 'edit' || !event.path || seen.has(event.path)) continue;
    seen.add(event.path);
    paths.push(event.path);
  }
  return paths;
}
