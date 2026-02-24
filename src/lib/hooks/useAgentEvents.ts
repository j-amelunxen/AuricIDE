import { useEffect } from 'react';
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
