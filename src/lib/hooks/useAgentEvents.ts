import { useEffect } from 'react';
import { createOutputBatcher, type OutputBatch } from '../agents/outputBatcher';
import {
  onAgentOutput,
  onAgentStatus,
  type AgentOutputEvent,
  type AgentStatusEvent,
} from '../tauri/agentEvents';

export function useAgentEvents(
  onOutput: (event: AgentOutputEvent) => void,
  onStatus: (event: AgentStatusEvent) => void
): void {
  useEffect(() => {
    const unsubOutput = onAgentOutput(onOutput);
    const unsubStatus = onAgentStatus(onStatus);

    return () => {
      unsubOutput();
      unsubStatus();
    };
  }, [onOutput, onStatus]);
}

/**
 * Agent events with output delivered in per-frame batches (`outputBatcher.ts`).
 *
 * A status event first hands over whatever output is still pending: the last
 * chunks before an exit belong in the log before the exit is applied, because
 * the failure toast and inbox record read the log's tail. Going hidden
 * hands it over too: a parked frame would otherwise hold it until a throttled
 * timer fires.
 */
export function useBatchedAgentEvents(
  onBatch: (batch: OutputBatch) => void,
  onStatus: (event: AgentStatusEvent) => void
): void {
  useEffect(() => {
    const batcher = createOutputBatcher(onBatch);
    const unsubOutput = onAgentOutput((event) => batcher.push(event.agentId, event.line));
    const unsubStatus = onAgentStatus((event) => {
      batcher.flush();
      onStatus(event);
    });
    const onVisibility = () => batcher.flush();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubOutput();
      unsubStatus();
      document.removeEventListener('visibilitychange', onVisibility);
      batcher.flush();
    };
  }, [onBatch, onStatus]);
}
