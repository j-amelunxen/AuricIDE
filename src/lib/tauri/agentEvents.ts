import { subscribeToTauriEvent } from './subscribe';

export interface AgentOutputEvent {
  agentId: string;
  stream: 'stdout' | 'stderr';
  line: string;
  timestamp: number;
  repoPath?: string;
}

export interface AgentStatusEvent {
  agentId: string;
  status: 'running' | 'idle' | 'queued' | 'error';
  exitCode: number | null;
  repoPath?: string;
}

export function onAgentOutput(callback: (event: AgentOutputEvent) => void): () => void {
  return subscribeToTauriEvent(
    'agent-output',
    callback,
    '[Browser mode] Agent output listener not available'
  );
}

export function onAgentStatus(callback: (event: AgentStatusEvent) => void): () => void {
  return subscribeToTauriEvent(
    'agent-status',
    callback,
    '[Browser mode] Agent status listener not available'
  );
}
