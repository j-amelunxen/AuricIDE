import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '../tauri/agents';
import fixtures from './agentControl.fixtures.json';

type Handler = (payload: unknown) => void;
const listeners = new Map<string, Handler>();
const unsubscribe = vi.fn();
vi.mock('@/lib/tauri/subscribe', () => ({
  subscribeToTauriEvent: (name: string, handler: Handler) => {
    listeners.set(name, handler);
    return unsubscribe;
  },
}));

const { installSupervisorAdoption } = await import('./supervisorAdoption');

const agent = (id: string, spawnedByAgentId: string | null): AgentInfo => ({
  id,
  name: id,
  status: 'running',
  model: 'm',
  provider: 'claude',
  startedAt: 0,
  spawnedByAgentId,
});

describe('installSupervisorAdoption', () => {
  it("rewrites the children's supervisor when Rust reports an adoption", () => {
    let agents = [agent('child', 'sup-old'), agent('other', 'sup-x')];
    const store = {
      getState: () => ({ agents }),
      setState: vi.fn((patch: { agents: AgentInfo[] }) => {
        agents = patch.agents;
      }),
    };
    const stop = installSupervisorAdoption(store);

    const { name, payload } = fixtures.supervisors.adoptedEvent;
    agents = [agent('child', payload.fromIds[0]), agent('other', 'sup-x')];
    listeners.get(name)?.(payload);

    expect(agents.map((a) => a.spawnedByAgentId)).toEqual([payload.toId, 'sup-x']);
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('writes nothing when no listed agent was a child of those supervisors', () => {
    const store = { getState: () => ({ agents: [agent('a', null)] }), setState: vi.fn() };
    installSupervisorAdoption(store);
    listeners.get(fixtures.supervisors.resumeAdoptsChildren.event)?.({
      toId: 'sup-new',
      fromIds: ['sup-old'],
    });
    expect(store.setState).not.toHaveBeenCalled();
  });
});
