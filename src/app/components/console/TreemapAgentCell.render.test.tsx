import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';

const renders = vi.hoisted(() => ({ chip: 0 }));

vi.mock('./PhaseChip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./PhaseChip')>();
  return {
    ...actual,
    PhaseChip: (props: Parameters<typeof actual.PhaseChip>[0]) => {
      renders.chip++;
      return <actual.PhaseChip {...props} />;
    },
  };
});

import { TreemapAgentCell } from './TreemapAgentCell';
import { ConsoleAgentCard } from './ConsoleAgentCard';

const agent: AgentInfo = {
  id: 'a1',
  name: 'Writer',
  model: 'm',
  provider: 'claude',
  status: 'running',
  startedAt: Date.now(),
  lastActivityAt: Date.now(),
};

function stream() {
  act(() => {
    for (let i = 0; i < 5; i++) useStore.getState().appendAgentLog('a1', `working ${i}\r\n`);
  });
}

describe('console cells – output batches', () => {
  beforeEach(() => {
    renders.chip = 0;
    useStore.setState({ agentLogs: {}, agentLogMeta: {} });
  });

  it('a treemap cell of a working agent does not re-render per output batch', () => {
    render(
      <TreemapAgentCell
        agent={agent}
        events={[]}
        reviewed={false}
        width={300}
        height={200}
        onOpenTerminal={vi.fn()}
      />
    );
    const before = renders.chip;
    stream();
    expect(renders.chip).toBe(before);
  });

  it('a console card of a working agent does not re-render per output batch', () => {
    render(
      <ConsoleAgentCard
        agent={agent}
        events={[]}
        heartbeat={[]}
        heartbeatScaleMax={1}
        reviewed={false}
        onOpenTerminal={vi.fn()}
      />
    );
    const before = renders.chip;
    stream();
    expect(renders.chip).toBe(before);
  });

  it('a cell waiting on the user still redraws its prompt from new output', () => {
    const waiting = { ...agent, awaitingInput: true };
    const { getByTestId } = render(
      <TreemapAgentCell
        agent={waiting}
        events={[]}
        reviewed={false}
        width={300}
        height={200}
        onOpenTerminal={vi.fn()}
      />
    );
    const before = renders.chip;
    act(() => {
      useStore.getState().appendAgentLog('a1', 'Do you want to proceed?\r\n');
    });
    expect(renders.chip).toBeGreaterThan(before);
    expect(getByTestId('console-agent-card-a1')).toBeInTheDocument();
  });
});
