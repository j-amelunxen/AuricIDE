import { formatAgentDuration } from '@/lib/agents/duration';

/** "3h ago", not "3h 0m ago": a session note's age needs no zero remainder. */
export function formatSessionAge(ms: number): string {
  return `${formatAgentDuration(ms).replace(/ 0[mh]$/, '')} ago`;
}
