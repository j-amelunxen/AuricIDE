import type { AgentEvent } from './events/types';
import type { ConsoleAgentState } from './consoleState';

/** Strips a known verb prefix off an event label to recover its subject. */
function withoutPrefix(label: string, prefix: string): string {
  return label.startsWith(prefix) ? label.slice(prefix.length) : label;
}

/** Present-continuous phrasing for a working agent's newest event. */
function describeWorking(lastEvent: AgentEvent | undefined, currentActivity: string | undefined) {
  if (!lastEvent) return currentActivity ?? 'Starting…';
  switch (lastEvent.kind) {
    case 'edit':
      return `Editing ${lastEvent.path ?? withoutPrefix(lastEvent.label, 'Edited ')}`;
    case 'read':
      return `Reading ${lastEvent.path ?? withoutPrefix(lastEvent.label, 'Read ')}`;
    case 'run':
      return `Running ${withoutPrefix(lastEvent.label, 'Ran ')}`;
    default:
      return currentActivity ?? lastEvent.label;
  }
}

export interface DescribeRightNowInput {
  state: ConsoleAgentState;
  lastEvent?: AgentEvent;
  /** The raw newest-output line, used when no structured event exists yet. */
  currentActivity?: string;
  /** Pre-formatted silence duration (e.g. "6m"), required only while stalled. */
  quietFor?: string;
}

/**
 * The console card's "right now" line: one sentence answering "what is this
 * agent doing at this exact moment", distinct from `currentTask` (the fixed
 * instruction it started with) and from the phase chip (its coarse bucket).
 */
export function describeRightNow({
  state,
  lastEvent,
  currentActivity,
  quietFor,
}: DescribeRightNowInput): string {
  switch (state) {
    case 'error':
      return `Failed · ${lastEvent?.label ?? currentActivity ?? 'see logs'}`;
    case 'done':
      return `Done · ${lastEvent?.label ?? currentActivity ?? 'finished'}`;
    case 'stalled':
      return `No output for ${quietFor ?? 'a while'} · last: ${
        lastEvent?.label ?? currentActivity ?? 'unknown'
      }`;
    case 'yours':
      return lastEvent?.kind === 'ask'
        ? `Waiting on permission: ${withoutPrefix(lastEvent.label, 'Permission requested: ')}`
        : 'Waiting on you';
    case 'working':
      return describeWorking(lastEvent, currentActivity);
  }
}
