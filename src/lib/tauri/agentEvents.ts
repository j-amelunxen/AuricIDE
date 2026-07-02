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

function subscribeToAgentEvent<T>(
  eventName: string,
  callback: (payload: T) => void,
  unavailableWarning: string
): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;

  import('@tauri-apps/api/event')
    .then(({ listen }) => {
      if (disposed) return;
      listen<T>(eventName, (event) => {
        callback(event.payload);
      }).then((fn) => {
        if (disposed) {
          try {
            fn();
          } catch {
            /* already unregistered */
          }
        } else {
          unlisten = fn;
        }
      });
    })
    .catch(() => {
      console.warn(unavailableWarning);
    });

  return () => {
    if (disposed) return;
    disposed = true;
    if (unlisten) {
      try {
        unlisten();
      } catch {
        // Listener may already have been unregistered by Tauri
      }
      unlisten = null;
    }
  };
}

export function onAgentOutput(callback: (event: AgentOutputEvent) => void): () => void {
  return subscribeToAgentEvent(
    'agent-output',
    callback,
    '[Browser mode] Agent output listener not available'
  );
}

export function onAgentStatus(callback: (event: AgentStatusEvent) => void): () => void {
  return subscribeToAgentEvent(
    'agent-status',
    callback,
    '[Browser mode] Agent status listener not available'
  );
}
