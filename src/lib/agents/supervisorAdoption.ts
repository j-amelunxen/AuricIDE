import type { AgentInfo } from '@/lib/tauri/agents';
import { subscribeToTauriEvent } from '@/lib/tauri/subscribe';
import fixtures from './agentControl.fixtures.json';
import { adoptSupervisorChildren } from './supervisorFamily';

/** Emitted by Rust after a resumed supervisor took over its run folder's children. */
export const SUPERVISOR_CHILDREN_ADOPTED_EVENT = fixtures.supervisors.resumeAdoptsChildren.event;

interface ChildrenAdoptedEvent {
  toId: string;
  fromIds: string[];
}

interface AgentListStore {
  getState: () => { agents: AgentInfo[] };
  setState: (patch: { agents: AgentInfo[] }) => void;
}

/**
 * Keeps the card list's `spawnedByAgentId` in step with Rust when a resumed
 * supervisor adopts the children of its run folder, so they join its tab
 * family instead of staying orphaned under the old id. Main window only: in
 * the agent window the roster is the one writer of `agents`.
 */
export function installSupervisorAdoption(store: AgentListStore): () => void {
  return subscribeToTauriEvent<ChildrenAdoptedEvent>(
    SUPERVISOR_CHILDREN_ADOPTED_EVENT,
    ({ toId, fromIds }) => {
      const { agents } = store.getState();
      const adopted = adoptSupervisorChildren(agents, toId, fromIds);
      if (adopted !== agents) store.setState({ agents: adopted });
    },
    '[Browser mode] Supervisor adoption listener not available'
  );
}
