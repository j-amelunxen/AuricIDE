import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { canEndAgent, endAgentThenOfferMerge } from './endAgent';

const running: AgentInfo = {
  id: 'agent-1',
  name: 'Writer',
  model: 'model',
  provider: 'claude',
  status: 'running',
  startedAt: 1000,
};
const finished: AgentInfo = { ...running, id: 'agent-2', status: 'idle' };

describe('endAgentThenOfferMerge', () => {
  it('offers the merge only once the kill has settled', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const onKill = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push('killed');
            resolve();
          };
        })
    );
    const offerMerge = vi.fn(async () => {
      order.push('offered');
    });

    const done = endAgentThenOfferMerge(running, { onKill, offerMerge });
    await Promise.resolve();
    expect(onKill).toHaveBeenCalledWith('agent-1');
    expect(offerMerge).not.toHaveBeenCalled();

    release();
    await done;
    expect(order).toEqual(['killed', 'offered']);
    expect(offerMerge).toHaveBeenCalledWith(running);
  });

  it('dismisses a finished agent instead of killing it', async () => {
    const onKill = vi.fn();
    const onDismiss = vi.fn();
    const offerMerge = vi.fn(async () => {});

    await endAgentThenOfferMerge(finished, { onKill, onDismiss, offerMerge });

    expect(onDismiss).toHaveBeenCalledWith('agent-2');
    expect(onKill).not.toHaveBeenCalled();
    expect(offerMerge).toHaveBeenCalledWith(finished);
  });

  it('does nothing, merge offer included, without a handler for that ending', async () => {
    const offerMerge = vi.fn(async () => {});

    await endAgentThenOfferMerge(finished, { onKill: vi.fn(), offerMerge });

    expect(offerMerge).not.toHaveBeenCalled();
    expect(canEndAgent(finished, { onKill: vi.fn() })).toBe(false);
    expect(canEndAgent(running, { onKill: vi.fn() })).toBe(true);
    expect(canEndAgent(running, { onDismiss: vi.fn() })).toBe(false);
  });
});
