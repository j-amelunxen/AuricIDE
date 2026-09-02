import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockStore: Record<string, unknown> = {
  pmStatusHistory: [],
};

vi.mock('@/lib/store', () => ({
  useStore: vi.fn((selector: (s: typeof mockStore) => unknown) => selector(mockStore)),
}));

import { TicketTiming } from './TicketTiming';

const NOW = '2026-01-26T00:00:00Z';

function entry(ticketId: string, fromStatus: string | null, toStatus: string, changedAt: string) {
  return { id: `${ticketId}-${toStatus}`, ticketId, fromStatus, toStatus, changedAt, source: 'ui' };
}

describe('TicketTiming', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    mockStore.pmStatusHistory = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when the ticket has no history', () => {
    const { container } = render(<TicketTiming ticketId="t1" status="open" />);
    expect(container.textContent).toBe('');
  });

  it('shows how long the ticket has sat in its current status', () => {
    mockStore.pmStatusHistory = [
      entry('t1', null, 'open', '2026-01-01T00:00:00Z'),
      entry('t1', 'open', 'in_progress', '2026-01-20T00:00:00Z'),
    ];

    render(<TicketTiming ticketId="t1" status="in_progress" />);

    expect(screen.getByText('Timing')).toBeDefined();
    expect(screen.getByText('In progress')).toBeDefined();
    expect(screen.getByText('6d 0h')).toBeDefined();
    expect(screen.getByText('Open')).toBeDefined();
    expect(screen.getByText('19d 0h')).toBeDefined();
  });

  it('shows cycle and lead time once the ticket is done', () => {
    mockStore.pmStatusHistory = [
      entry('t1', null, 'open', '2026-01-01T00:00:00Z'),
      entry('t1', 'open', 'in_progress', '2026-01-24T00:00:00Z'),
      entry('t1', 'in_progress', 'done', '2026-01-25T00:00:00Z'),
    ];

    render(<TicketTiming ticketId="t1" status="done" />);

    expect(screen.getByText('Cycle').nextElementSibling?.textContent).toBe('1d 0h');
    expect(screen.getByText('Lead').nextElementSibling?.textContent).toBe('24d 0h');
  });

  it('ignores history that belongs to another ticket', () => {
    mockStore.pmStatusHistory = [
      entry('other', null, 'open', '2026-01-01T00:00:00Z'),
      entry('other', 'open', 'in_progress', '2026-01-02T00:00:00Z'),
    ];

    const { container } = render(<TicketTiming ticketId="t1" status="open" />);
    expect(container.textContent).toBe('');
  });
});
