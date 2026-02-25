import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TicketTable } from './TicketTable';
import type { PmTicket, PmDependency, PmTestCase } from '@/lib/tauri/pm';

const makeTicket = (overrides: Partial<PmTicket> = {}): PmTicket => ({
  id: 'tk-1',
  epicId: 'epic-1',
  name: 'Login feature',
  description: 'Implement login',
  status: 'open',
  statusUpdatedAt: '',
  priority: 'normal',
  sortOrder: 0,
  createdAt: '2026-01-15T00:00:00Z',
  updatedAt: '2026-01-15T00:00:00Z',
  ...overrides,
});

describe('TicketTable', () => {
  const defaultProps = {
    tickets: [] as PmTicket[],
    allTickets: [] as PmTicket[],
    testCases: [] as PmTestCase[],
    selectedTicketId: null as string | null,
    dependencies: [] as PmDependency[],
    onSelectTicket: vi.fn(),
    onUpdateTicket: vi.fn(),
    onAddTicket: vi.fn(),
  };

  it('renders "Tickets" header', () => {
    render(<TicketTable {...defaultProps} tickets={[makeTicket()]} allTickets={[makeTicket()]} />);
    expect(screen.getByText('Tickets')).toBeDefined();
  });

  it('renders sort dropdown', () => {
    render(<TicketTable {...defaultProps} tickets={[makeTicket()]} />);
    expect(screen.getByLabelText('Sort tickets')).toBeDefined();
  });

  it('renders ticket names', () => {
    const tickets = [
      makeTicket({ id: 'tk-1', name: 'First ticket' }),
      makeTicket({ id: 'tk-2', name: 'Second ticket' }),
    ];
    render(<TicketTable {...defaultProps} tickets={tickets} />);
    expect(screen.getByText('First ticket')).toBeDefined();
    expect(screen.getByText('Second ticket')).toBeDefined();
  });

  it('highlights selected ticket', () => {
    const tickets = [makeTicket({ id: 'tk-1' })];
    render(<TicketTable {...defaultProps} tickets={tickets} selectedTicketId="tk-1" />);
    const row = screen.getByText('Login feature').closest('div[class]');
    expect(row?.className).toContain('bg-primary/10');
  });

  it('calls onSelectTicket when row clicked', () => {
    const onSelectTicket = vi.fn();
    const tickets = [makeTicket({ id: 'tk-1' })];
    render(<TicketTable {...defaultProps} tickets={tickets} onSelectTicket={onSelectTicket} />);
    fireEvent.click(screen.getByText('Login feature'));
    expect(onSelectTicket).toHaveBeenCalledWith('tk-1');
  });

  it('shows "+ New Ticket" button', () => {
    render(<TicketTable {...defaultProps} />);
    expect(screen.getByText('+ New Ticket')).toBeDefined();
  });

  it('calls onAddTicket when button clicked', () => {
    const onAddTicket = vi.fn();
    render(<TicketTable {...defaultProps} onAddTicket={onAddTicket} />);
    fireEvent.click(screen.getByText('+ New Ticket'));
    expect(onAddTicket).toHaveBeenCalled();
  });

  it('shows "No tickets" when list is empty', () => {
    render(<TicketTable {...defaultProps} />);
    expect(screen.getByText('No tickets')).toBeDefined();
  });

  it('shows compact status badges', () => {
    const tickets = [
      makeTicket({ id: 'tk-1', name: 'Open ticket', status: 'open' }),
      makeTicket({ id: 'tk-2', name: 'Progress ticket', status: 'in_progress' }),
      makeTicket({ id: 'tk-3', name: 'Done ticket', status: 'done' }),
    ];
    render(<TicketTable {...defaultProps} tickets={tickets} />);
    const openBadge = screen.getByText('Open');
    const progressBadge = screen.getByText('IP');
    const doneBadge = screen.getByText('Done');
    expect(openBadge.className).toContain('bg-white/10');
    expect(progressBadge.className).toContain('bg-yellow-500/10');
    expect(doneBadge.className).toContain('bg-green-500/10');
  });

  it('calls onUpdateTicket and onSave with in_progress status when Spawn Agent icon clicked', async () => {
    const onUpdateTicket = vi.fn();
    const onSave = vi.fn();
    const tickets = [makeTicket({ id: 'tk-1' })];
    render(
      <TicketTable
        {...defaultProps}
        tickets={tickets}
        onUpdateTicket={onUpdateTicket}
        onSave={onSave}
      />
    );
    const spawnBtn = screen.getByTitle('Spawn Agent');
    fireEvent.click(spawnBtn);
    expect(onUpdateTicket).toHaveBeenCalledWith('tk-1', { status: 'in_progress' });
    expect(onSave).toHaveBeenCalled();
  });

  it('shows blocked indicator when ticket has unfinished dependency', () => {
    const ticket1 = makeTicket({ id: 'tk-1', name: 'Blocked Ticket' });
    const ticket2 = makeTicket({ id: 'tk-2', name: 'Dependency', status: 'open' });
    const dependency: PmDependency = {
      id: 'dep-1',
      sourceType: 'ticket',
      sourceId: 'tk-1',
      targetType: 'ticket',
      targetId: 'tk-2',
    };

    render(
      <TicketTable
        {...defaultProps}
        tickets={[ticket1]}
        allTickets={[ticket1, ticket2]}
        dependencies={[dependency]}
      />
    );

    expect(screen.getByTitle('Blocked by dependencies')).toBeDefined();
  });

  it('does not show blocked indicator when dependency is done', () => {
    const ticket1 = makeTicket({ id: 'tk-1', name: 'Free Ticket' });
    const ticket2 = makeTicket({ id: 'tk-2', name: 'Dependency', status: 'done' });
    const dependency: PmDependency = {
      id: 'dep-1',
      sourceType: 'ticket',
      sourceId: 'tk-1',
      targetType: 'ticket',
      targetId: 'tk-2',
    };

    render(
      <TicketTable
        {...defaultProps}
        tickets={[ticket1]}
        allTickets={[ticket1, ticket2]}
        dependencies={[dependency]}
      />
    );

    expect(screen.queryByTitle('Blocked by dependencies')).toBeNull();
  });

  it('does not show blocked indicator when dependency is archived', () => {
    const ticket1 = makeTicket({ id: 'tk-1', name: 'Free Ticket' });
    const ticket2 = makeTicket({ id: 'tk-2', name: 'Dependency', status: 'archived' });
    const dependency: PmDependency = {
      id: 'dep-1',
      sourceType: 'ticket',
      sourceId: 'tk-1',
      targetType: 'ticket',
      targetId: 'tk-2',
    };

    render(
      <TicketTable
        {...defaultProps}
        tickets={[ticket1]}
        allTickets={[ticket1, ticket2]}
        dependencies={[dependency]}
      />
    );

    expect(screen.queryByTitle('Blocked by dependencies')).toBeNull();
  });
});
