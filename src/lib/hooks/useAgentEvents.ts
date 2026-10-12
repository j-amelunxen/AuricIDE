import { useEffect } from 'react';
import { createOutputBatcher, type OutputBatch, type OutputBatcher } from '../agents/outputBatcher';
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
 * How far each agent's output has come, by the offset Rust stamped on the
 * newest batch heard. One number per agent the session ever ran.
 */
const outputOffsets = new Map<string, number>();
/** The batcher of the mounted listener, so output can be flushed from outside React. */
let liveBatcher: OutputBatcher | null = null;

/** Bytes the agent has emitted as far as this window has heard; 0 if never. */
export function agentOutputOffset(agentId: string): number {
  return outputOffsets.get(agentId) ?? 0;
}

/**
 * Hand pending output to the store now. Afterwards the store, and with it the
 * agent's mirror, holds everything up to `agentOutputOffset(agentId)` — which
 * is what lets a screen snapshot name the offset it reaches without lying
 * about a batch still parked for the next frame.
 */
export function flushAgentOutput(): void {
  liveBatcher?.flush();
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
    liveBatcher = batcher;
    const unsubOutput = onAgentOutput((event) => {
      outputOffsets.set(event.agentId, event.endOffset);
      batcher.push(event.agentId, event.line);
    });
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
      if (liveBatcher === batcher) liveBatcher = null;
    };
  }, [onBatch, onStatus]);
}
