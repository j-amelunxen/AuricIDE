import type { AgentInfo } from '@/lib/tauri/agents';
import { agentAttention } from './attention';

/** What a Project Manager's tile shows: nothing running, working, or waiting for the human. */
export type ManagerStatus = 'idle' | 'running' | 'attention';

/** The running supervisor addressed by the manager's key, if there is one. */
export function liveSupervisorOfManager(
  live: AgentInfo[],
  managerKey: string
): AgentInfo | undefined {
  return live.find((agent) => agent.supervisorKey === managerKey);
}

/** Needs-input and stalled come from the one attention model; the tile adds no rule of its own. */
export function managerStatus(live: AgentInfo | undefined, now: number): ManagerStatus {
  if (!live) return 'idle';
  return agentAttention(live, now) === null ? 'running' : 'attention';
}

/** "Release Desk" -> "RD", "Inbox" -> "IN": up to two letters from the name's words. */
export function managerMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? words.slice(0, 2).map((word) => [...word][0])
      : [...(words[0] ?? '')].slice(0, 2);
  return letters.join('').toUpperCase();
}
