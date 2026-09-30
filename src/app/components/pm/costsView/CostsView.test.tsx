import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { usageRow } from '@/lib/pm/usage/testRow';
import type { PmTicket } from '@/lib/tauri/pm';
import { CostsView } from './CostsView';

const PATH = '/proj';
const NOW = '2026-09-30T12:00:00Z';

const ticket = (id: string, status: PmTicket['status'], epicId = 'e1') =>
  ({ id, name: id, epicId, status, goalId: null }) as PmTicket;

function seed(rows: ReturnType<typeof usageRow>[]) {
  useStore.setState({
    rootPath: PATH,
    agentUsageRows: { [PATH]: rows },
    agentUsageStatus: { [PATH]: 'ready' },
  });
}

function figure(label: string): string | undefined {
  return (
    screen.getAllByText(label).find((el) => el.nextElementSibling)?.nextElementSibling
      ?.textContent ?? undefined
  );
}

const recent = (overrides = {}) => usageRow({ finishedAt: '2026-09-29T10:00:00Z', ...overrides });

describe('CostsView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    useStore.setState({
      pmTickets: [ticket('t1', 'done'), ticket('t2', 'open', 'e2')],
      pmEpics: [
        { id: 'e1', name: 'Alpha' },
        { id: 'e2', name: 'Beta' },
      ] as never,
      goals: [],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    useStore.setState({
      rootPath: null,
      agentUsageRows: {},
      agentUsageStatus: {},
      pmTickets: [],
      pmEpics: [],
    });
  });

  it('starts empty and shows the totals once runs arrive after mount', () => {
    seed([]);
    render(<CostsView />);
    expect(screen.getByText('No agent runs recorded in this window.')).toBeDefined();
    expect(figure('Runs')).toBe('0');

    act(() =>
      seed([
        recent({ ticketId: 't1', costUsd: 3, inputTokens: 3000, durationMs: 120_000 }),
        recent({ ticketId: 't2', costUsd: 1, costSource: 'estimated', outputTokens: 1000 }),
      ])
    );

    expect(figure('Cost')).toBe('$4.00');
    expect(figure('Tokens')).toBe('4k');
    expect(figure('Agent time')).toBe('3m');
    expect(figure('Runs')).toBe('2');
    expect(figure('Estimated')).toBe('50 %');
  });

  it('never shows an unknown cost as $0.00 and counts the runs without a price', () => {
    seed([recent({ ticketId: 't1', costUsd: null, costSource: 'none' })]);
    render(<CostsView />);
    expect(figure('Cost')).toBe('—');
    expect(screen.getAllByText('+ 1 run without price').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('limits the figures to the chosen window', () => {
    seed([
      recent({ ticketId: 't1', costUsd: 1 }),
      recent({ ticketId: 't1', costUsd: 10, finishedAt: '2026-09-10T10:00:00Z' }),
      recent({ ticketId: 't1', costUsd: 100, finishedAt: '2026-06-01T10:00:00Z' }),
    ]);
    render(<CostsView />);
    expect(figure('Cost')).toBe('$11.00'); // 30d is the default

    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(figure('Cost')).toBe('$1.00');
    expect(screen.getByRole('button', { name: '7d' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(figure('Cost')).toBe('$111.00');
  });

  it('groups by the chosen key, costliest first', () => {
    seed([
      recent({ ticketId: 't1', costUsd: 1, provider: 'codex' }),
      recent({ ticketId: 't2', costUsd: 5, provider: 'claude' }),
    ]);
    render(<CostsView />);

    const rowsOf = () =>
      within(screen.getByRole('table'))
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent);

    fireEvent.click(screen.getByRole('button', { name: 'Epic' }));
    expect(rowsOf()[0]).toContain('Beta');
    expect(rowsOf()[0]).toContain('$5.00');
    expect(rowsOf()[1]).toContain('Alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Provider' }));
    expect(rowsOf()[0]).toContain('claude');

    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    expect(rowsOf().join()).toContain('Done');
  });

  it('names runs without a ticket "Unattributed" instead of a dash', () => {
    seed([recent({ ticketId: null, costUsd: 2 })]);
    render(<CostsView />);
    expect(within(screen.getByRole('table')).getByText('Unattributed')).toBeDefined();
  });

  it('reports how far the estimate is from the CLI figure', () => {
    seed([
      recent({ costUsd: 10, costSource: 'cli', estimateCostUsd: 11 }),
      recent({ costUsd: 10, costSource: 'cli', estimateCostUsd: 9.5 }),
    ]);
    render(<CostsView />);
    expect(
      screen.getByText('Estimates deviate by 7.5 % on average (median 7.5 %, n = 2 headless runs)')
    ).toBeDefined();
  });

  it('says there is no benchmark without a headless Claude run', () => {
    seed([recent({ costSource: 'estimated', costUsd: 1 })]);
    render(<CostsView />);
    expect(screen.getByText('No benchmark yet — needs a headless Claude run')).toBeDefined();
  });
});
