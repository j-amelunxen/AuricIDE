import { AGENT_WINDOW_RUST_EVENTS, type AgentWindowMessages } from '../agents/agentWindow.contract';
import { subscribeToTauriEvent } from './subscribe';

export interface AgentOutputEvent {
  agentId: string;
  stream: 'stdout' | 'stderr';
  line: string;
  timestamp: number;
  repoPath?: string;
  /**
   * Raw UTF-8 bytes this agent has emitted up to and including this batch,
   * counted in Rust. What lets a second window tell which batches a screen
   * snapshot already holds (`docs/design-agent-window.md`, rule 3).
   */
  endOffset: number;
}

export type AgentPtyResizedEvent = AgentWindowMessages['ptyResized'];

export interface AgentStatusEvent {
  agentId: string;
  status: 'running' | 'idle' | 'queued' | 'error';
  exitCode: number | null;
  repoPath?: string;
}

export function onAgentOutput(
  callback: (event: AgentOutputEvent) => void,
  /** Called once the listener is registered — batches emitted from then on arrive. */
  onListening?: () => void
): () => void {
  return subscribeToTauriEvent(
    AGENT_WINDOW_RUST_EVENTS.agentOutput,
    callback,
    '[Browser mode] Agent output listener not available',
    onListening
  );
}

export function onAgentStatus(callback: (event: AgentStatusEvent) => void): () => void {
  return subscribeToTauriEvent(
    'agent-status',
    callback,
    '[Browser mode] Agent status listener not available'
  );
}

/**
 * An agent PTY changed size — emitted by Rust on a real change only, to every
 * window, the one that asked for it included.
 */
export function onAgentPtyResized(callback: (event: AgentPtyResizedEvent) => void): () => void {
  return subscribeToTauriEvent(
    AGENT_WINDOW_RUST_EVENTS.ptyResized,
    callback,
    '[Browser mode] Agent PTY resize listener not available'
  );
}
