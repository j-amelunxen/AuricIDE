import { describe, expect, it } from 'vitest';
import type { PmTicket } from '@/lib/tauri/pm';
import { TICKET_DEFAULT_SORT, TICKET_SORTS, parseTicketSort, sortTickets } from './sortTickets';

const makeTicket = (overrides: Partial<PmTicket> = {}): PmTicket => ({
  id: 't1',
  epicId: 'e1',
  name: 'Alpha',
  description: '',
  status: 'open',
  statusUpdatedAt: '',
  priority: 'normal',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '',
  ...overrides,
});

describe('parseTicketSort', () => {
  it('accepts every offered sort', () => {
    for (const sort of TICKET_SORTS) expect(parseTicketSort(sort)).toBe(sort);
  });

  it('falls back to custom for absent or stale values', () => {
    expect(TICKET_DEFAULT_SORT).toBe('custom');
    expect(parseTicketSort(null)).toBe('custom');
    expect(parseTicketSort('')).toBe('custom');
    expect(parseTicketSort('whatever-an-old-build-wrote')).toBe('custom');
  });
});

describe('sortTickets', () => {
  const tickets = [
    makeTicket({
      id: 'late',
      name: 'Zebra',
      status: 'done',
      priority: 'low',
      sortOrder: 2,
      createdAt: '2026-03-01T00:00:00Z',
    }),
    makeTicket({
      id: 'early',
      name: 'Alpha',
      status: 'open',
      priority: 'critical',
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00Z',
    }),
    makeTicket({
      id: 'mid',
      name: 'Mike',
      status: 'in_progress',
      priority: 'high',
      sortOrder: 1,
      createdAt: '2026-02-01T00:00:00Z',
    }),
  ];

  it('orders by sortOrder for custom, so a drag can come back after another sort', () => {
    expect(sortTickets(tickets, 'custom').map((t) => t.id)).toEqual(['early', 'mid', 'late']);
  });

  it('orders by createdAt, name, status and priority without touching sortOrder', () => {
    expect(sortTickets(tickets, 'createdAt').map((t) => t.id)).toEqual(['early', 'mid', 'late']);
    expect(sortTickets(tickets, 'name').map((t) => t.id)).toEqual(['early', 'mid', 'late']);
    expect(sortTickets(tickets, 'status').map((t) => t.id)).toEqual(['late', 'mid', 'early']);
    // Same direction the table already used: low first, critical last.
    expect(sortTickets(tickets, 'priority').map((t) => t.id)).toEqual(['late', 'mid', 'early']);
    expect(tickets.map((t) => t.sortOrder)).toEqual([2, 0, 1]);
  });

  it('reverses when asked, except the input stays untouched', () => {
    const reversed = sortTickets(tickets, 'custom', false);
    expect(reversed.map((t) => t.id)).toEqual(['late', 'mid', 'early']);
    expect(tickets[0].id).toBe('late');
  });

  it('does not mutate the input array', () => {
    const copy = tickets.slice();
    sortTickets(tickets, 'name');
    expect(tickets).toEqual(copy);
  });
});
