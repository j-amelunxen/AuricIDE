import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { usageRow } from '@/lib/pm/usage/testRow';

vi.mock('@/lib/tauri/agentUsage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/agentUsage')>()),
  agentUsageLoad: vi.fn(async () => []),
}));

import { agentUsageLoad } from '@/lib/tauri/agentUsage';
import { TicketCost } from './TicketCost';

const PATH = '/proj';

function seed(rows: ReturnType<typeof usageRow>[]) {
  useStore.setState({
    rootPath: PATH,
    agentUsageRows: { [PATH]: rows },
    agentUsageStatus: { [PATH]: 'ready' },
  });
}

function stat(label: string): string | undefined {
  const term = screen.getAllByText(label).find((el) => el.tagName === 'DT');
  return term?.nextElementSibling?.textContent ?? undefined;
}

describe('TicketCost', () => {
  beforeEach(() => vi.mocked(agentUsageLoad).mockClear());
  afterEach(() => useStore.setState({ rootPath: null, agentUsageRows: {}, agentUsageStatus: {} }));

  it('says so quietly when the ticket has no runs, then fills in when runs arrive', () => {
    seed([]);
    render(<TicketCost ticketId="t1" />);
    expect(screen.getByText('No agent runs recorded yet.')).toBeDefined();

    act(() =>
      seed([
        usageRow({ ticketId: 't1', costUsd: 1.25, inputTokens: 3000, durationMs: 120_000 }),
        usageRow({ ticketId: 't1', costUsd: 0.75, outputTokens: 1000, durationMs: 60_000 }),
      ])
    );

    expect(screen.queryByText('No agent runs recorded yet.')).toBeNull();
    expect(stat('Total')).toBe('$2.00');
    expect(stat('Tokens')).toBe('4k');
    expect(stat('Agent time')).toBe('3m');
    expect(stat('Runs')).toBe('2');
  });

  it('counts only the runs of this ticket', () => {
    seed([usageRow({ ticketId: 't1', costUsd: 1 }), usageRow({ ticketId: 'other', costUsd: 50 })]);
    render(<TicketCost ticketId="t1" />);
    expect(stat('Total')).toBe('$1.00');
  });

  it('names the runs without a price instead of counting them as free', () => {
    seed([
      usageRow({ ticketId: 't1', costUsd: 2 }),
      usageRow({ ticketId: 't1', costUsd: null, costSource: 'none' }),
      usageRow({ ticketId: 't1', costUsd: null, costSource: 'none' }),
    ]);
    render(<TicketCost ticketId="t1" />);
    expect(stat('Total')).toBe('$2.00+ 2 runs without price');
  });

  it('shows a dash as the total when no run has a price', () => {
    seed([usageRow({ ticketId: 't1', costUsd: null, costSource: 'none' })]);
    render(<TicketCost ticketId="t1" />);
    expect(stat('Total')).toBe('—+ 1 run without price');
  });

  it('asks for the project usage when it was never loaded', () => {
    useStore.setState({ rootPath: PATH, agentUsageRows: {}, agentUsageStatus: {} });
    render(<TicketCost ticketId="t1" />);
    expect(agentUsageLoad).toHaveBeenCalledWith(PATH);
  });

  it('does not reload usage that is already loaded', () => {
    seed([]);
    render(<TicketCost ticketId="t1" />);
    expect(agentUsageLoad).not.toHaveBeenCalled();
  });
});
