import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usageRow } from '@/lib/pm/usage/testRow';
import { UsageRunLog } from './UsageRunLog';

function bodyRows() {
  return screen.getAllByRole('row').slice(1);
}

describe('UsageRunLog', () => {
  it('has column headers and gains a line when a run arrives after mount', () => {
    const { rerender } = render(<UsageRunLog rows={[]} />);
    expect(screen.getByRole('columnheader', { name: 'Cost' })).toBeDefined();
    expect(bodyRows()).toHaveLength(0);

    rerender(<UsageRunLog rows={[usageRow({ costUsd: 1.5, inputTokens: 2000 })]} />);
    expect(bodyRows()).toHaveLength(1);
  });

  it('shows provider, model, tokens, cost, duration and outcome of a run', () => {
    render(
      <UsageRunLog
        rows={[
          usageRow({
            provider: 'claude',
            model: 'opus-x',
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 2000,
            cacheWriteTokens: 1000,
            costUsd: 1.5,
            durationMs: 125_000,
            outcome: 'error',
          }),
        ]}
      />
    );
    const row = within(bodyRows()[0]);
    expect(row.getByText(/claude · opus-x/)).toBeDefined();
    expect(row.getByText('4.5k')).toBeDefined();
    expect(row.getByText('$1.50')).toBeDefined();
    expect(row.getByText('2m')).toBeDefined();
    expect(row.getByText('error')).toBeDefined();
  });

  it('dates a run like the rest of the PM UI, in English', () => {
    render(<UsageRunLog rows={[usageRow({ startedAt: '2026-09-28T13:31:00' })]} />);
    expect(within(bodyRows()[0]).getByText('Sep 28, 1:31 PM')).toBeDefined();
  });

  it('badges a CLI cost as exact and a transcript cost as estimated', () => {
    render(
      <UsageRunLog
        rows={[usageRow({ costSource: 'cli' }), usageRow({ costSource: 'estimated' })]}
      />
    );
    expect(within(bodyRows()[0]).getByText('exact')).toBeDefined();
    expect(within(bodyRows()[1]).getByText('estimated')).toBeDefined();
  });

  it('flags a heuristic transcript match, and only then', () => {
    render(
      <UsageRunLog
        rows={[
          usageRow({ costSource: 'estimated', matchKind: 'heuristic' }),
          usageRow({ costSource: 'estimated', matchKind: 'exact' }),
        ]}
      />
    );
    expect(within(bodyRows()[0]).getByText('heuristic match')).toBeDefined();
    expect(within(bodyRows()[1]).queryByText('heuristic match')).toBeNull();
  });

  it('renders an unknown cost as a dash, never as $0.00', () => {
    render(<UsageRunLog rows={[usageRow({ costUsd: null, costSource: 'none' })]} />);
    const row = within(bodyRows()[0]);
    expect(row.getByText('—')).toBeDefined();
    expect(row.queryByText('$0.00')).toBeNull();
    expect(row.getByText('no data')).toBeDefined();
  });
});
