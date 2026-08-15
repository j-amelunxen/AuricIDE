import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useStore } from '@/lib/store';
import type { UsageSnapshot } from '@/lib/usage/types';

vi.mock('@/lib/tauri/usageLimits', () => ({
  usageLimitsRead: vi.fn(async () => []),
  usageLimitsRefresh: vi.fn(async () => []),
}));
vi.mock('@/lib/tauri/usageEvents', () => ({
  onUsageLimitsChanged: vi.fn(() => () => {}),
}));
// The shared clock caches its value at import time, so fake timers do not
// reach it. It has its own tests; pinning it here keeps these about rendering.
vi.mock('@/lib/hooks/useNow', () => ({ useNow: () => NOW_MS }));

import { CliQuotaChip } from './CliQuotaChip';

/** Fixed so the "read N ago" line does not drift with the wall clock. */
const OBSERVED_AT = 1_787_300_000;
/** 90 seconds after the reading was taken. */
const NOW_MS = (OBSERVED_AT + 90) * 1000;

function snapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    provider: 'codex',
    planLabel: 'plus',
    windows: [
      {
        limitId: 'codex',
        limitLabel: null,
        kind: '7d',
        label: '7 d',
        usedPercent: 40,
        resetsAt: OBSERVED_AT + 3600,
        windowMinutes: 10080,
      },
    ],
    credits: null,
    observedAt: OBSERVED_AT,
    source: 'app-server',
    ...overrides,
  };
}

function setSnapshots(snapshots: UsageSnapshot[]) {
  useStore.setState({ usageSnapshots: snapshots, usageStatus: 'ready' });
}

describe('CliQuotaChip', () => {
  afterEach(() => {
    useStore.setState({ usageSnapshots: [], usageStatus: 'idle' });
  });

  it('stays away when there is nothing to say', () => {
    setSnapshots([]);
    render(<CliQuotaChip />);
    expect(screen.queryByTestId('cli-quota-chip')).not.toBeInTheDocument();
  });

  it('stays away when a provider reported no window at all', () => {
    // An account with no quota to report must not be drawn as 0 % — that reads
    // as "plenty left" instead of "no statement".
    setSnapshots([snapshot({ windows: [] })]);
    render(<CliQuotaChip />);
    expect(screen.queryByTestId('cli-quota-chip')).not.toBeInTheDocument();
  });

  it('shows one short tag per provider that reported something', () => {
    setSnapshots([
      snapshot({ provider: 'claude', windows: [{ ...snapshot().windows[0], usedPercent: 12 }] }),
      snapshot(),
    ]);
    render(<CliQuotaChip />);
    expect(screen.getByTestId('cli-quota-chip')).toHaveTextContent('CC 12% · CX 40%');
  });

  it('leaves a provider without windows out of the chip entirely', () => {
    setSnapshots([snapshot(), snapshot({ provider: 'claude', windows: [] })]);
    render(<CliQuotaChip />);
    expect(screen.getByTestId('cli-quota-chip')).toHaveTextContent('CX 40%');
    expect(screen.getByTestId('cli-quota-chip')).not.toHaveTextContent('CC');
  });

  it('stays calm well below the limit and escalates with the worst window', () => {
    setSnapshots([snapshot()]);
    const { rerender } = render(<CliQuotaChip />);
    expect(screen.getByTestId('cli-quota-dot').className).toContain('bg-primary');

    setSnapshots([snapshot({ windows: [{ ...snapshot().windows[0], usedPercent: 70 }] })]);
    rerender(<CliQuotaChip />);
    expect(screen.getByTestId('cli-quota-dot').className).toContain('bg-amber-400');

    setSnapshots([snapshot({ windows: [{ ...snapshot().windows[0], usedPercent: 91 }] })]);
    rerender(<CliQuotaChip />);
    expect(screen.getByTestId('cli-quota-dot').className).toContain('bg-red-400');
  });

  it('opens the detail on hover and closes it again', () => {
    setSnapshots([snapshot()]);
    render(<CliQuotaChip />);
    expect(screen.queryByTestId('cli-quota-popover')).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId('cli-quota-chip').parentElement!);
    expect(screen.getByTestId('cli-quota-popover')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId('cli-quota-chip').parentElement!);
    expect(screen.queryByTestId('cli-quota-popover')).not.toBeInTheDocument();
  });

  it('always says how old a reading is', () => {
    // The Claude figure only updates while an agent runs, so a percentage with
    // no age beside it would be a claim the data cannot support.
    setSnapshots([snapshot()]);
    render(<CliQuotaChip />);
    fireEvent.mouseEnter(screen.getByTestId('cli-quota-chip').parentElement!);

    expect(screen.getByTestId('cli-quota-popover')).toHaveTextContent('read 1m ago');
  });

  it('shows the reset countdown, the plan and the credit balance verbatim', () => {
    setSnapshots([snapshot({ credits: { balance: '21979.6827500000', unlimited: false } })]);
    render(<CliQuotaChip />);
    fireEvent.mouseEnter(screen.getByTestId('cli-quota-chip').parentElement!);

    const popover = screen.getByTestId('cli-quota-popover');
    expect(popover).toHaveTextContent('Codex');
    expect(popover).toHaveTextContent('plus');
    expect(popover).toHaveTextContent('7 d');
    expect(popover).toHaveTextContent('resets in 58m');
    // Kept as text: rounding it would drop digits the server sent on purpose.
    expect(popover).toHaveTextContent('credits: 21979.6827500000');
  });

  it('says a reset is due rather than counting past zero', () => {
    setSnapshots([
      snapshot({ windows: [{ ...snapshot().windows[0], resetsAt: OBSERVED_AT - 10 }] }),
    ]);
    render(<CliQuotaChip />);
    fireEvent.mouseEnter(screen.getByTestId('cli-quota-chip').parentElement!);

    expect(screen.getByTestId('cli-quota-popover')).toHaveTextContent('reset due');
  });
});
