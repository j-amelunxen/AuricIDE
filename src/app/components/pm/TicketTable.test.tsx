import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketTable } from './TicketTable';
import type { PmTicket, PmDependency, PmTestCase } from '@/lib/tauri/pm';
import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';

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
  beforeEach(() => {
    localStorage.clear();
  });

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

  it('calls onUpdateTicket and onSave with in_progress status when Start agent icon clicked', async () => {
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
    const spawnBtn = screen.getByTitle('Start agent');
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

  it('titles the strength badge Agent strength', () => {
    const tickets = [makeTicket({ modelPower: 'high' })];
    render(<TicketTable {...defaultProps} tickets={tickets} />);
    expect(screen.getByTitle('Agent strength: high')).toBeInTheDocument();
    expect(screen.queryByTitle(/model power/i)).not.toBeInTheDocument();
  });

  it('does not show blocked indicator when dependency is discarded', () => {
    const ticket1 = makeTicket({ id: 'tk-1', name: 'Free Ticket' });
    const ticket2 = makeTicket({ id: 'tk-2', name: 'Dependency', status: 'discarded' });
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

function ticketNames(): string[] {
  return screen
    .getAllByTestId(/ticket-row-/)
    .map((row) => row.querySelector('span.flex-1')?.textContent ?? '');
}

describe('TicketTable custom order', () => {
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

  const tickets = [
    makeTicket({
      id: 'tk-1',
      name: 'First by custom',
      sortOrder: 0,
      createdAt: '2026-03-01T00:00:00Z',
      priority: 'low',
    }),
    makeTicket({
      id: 'tk-2',
      name: 'Second by custom',
      sortOrder: 1,
      createdAt: '2026-01-01T00:00:00Z',
      priority: 'critical',
    }),
  ];

  beforeEach(() => {
    localStorage.clear();
  });

  it('opens on custom order so a drag has somewhere to land', () => {
    render(<TicketTable {...defaultProps} tickets={tickets} />);
    expect(screen.getByLabelText('Sort tickets')).toHaveValue('custom');
    expect(ticketNames()).toEqual(['First by custom', 'Second by custom']);
  });

  it('returns to the stored custom order after sorting by created or priority', () => {
    render(<TicketTable {...defaultProps} tickets={tickets} />);
    const select = screen.getByLabelText('Sort tickets');

    fireEvent.change(select, { target: { value: 'createdAt' } });
    expect(ticketNames()).toEqual(['Second by custom', 'First by custom']);

    fireEvent.change(select, { target: { value: 'priority' } });
    expect(ticketNames()).toEqual(['First by custom', 'Second by custom']);

    fireEvent.change(select, { target: { value: 'custom' } });
    expect(ticketNames()).toEqual(['First by custom', 'Second by custom']);
  });

  it('remembers the chosen sort across mounts', () => {
    const { unmount } = render(<TicketTable {...defaultProps} tickets={tickets} />);
    fireEvent.change(screen.getByLabelText('Sort tickets'), { target: { value: 'priority' } });
    expect(localStorage.getItem(APP_CONFIG_KEYS.pmTicketSort)).toBe('priority');
    unmount();

    render(<TicketTable {...defaultProps} tickets={tickets} />);
    expect(screen.getByLabelText('Sort tickets')).toHaveValue('priority');
  });

  it('reorders by drag and drop while on custom sort', () => {
    const onReorderTickets = vi.fn();
    render(<TicketTable {...defaultProps} tickets={tickets} onReorderTickets={onReorderTickets} />);
    const source = screen.getByTestId('ticket-row-tk-1');
    const target = screen.getByTestId('ticket-row-tk-2');
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      height: 40,
      bottom: 40,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() };

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer, clientY: 30 });
    fireEvent.drop(target, { dataTransfer, clientY: 30 });

    expect(onReorderTickets).toHaveBeenCalledWith(['tk-2', 'tk-1']);
  });

  it('does not reorder by drag when another sort is active', () => {
    const onReorderTickets = vi.fn();
    render(<TicketTable {...defaultProps} tickets={tickets} onReorderTickets={onReorderTickets} />);
    fireEvent.change(screen.getByLabelText('Sort tickets'), { target: { value: 'priority' } });

    const source = screen.getByTestId('ticket-row-tk-1');
    const target = screen.getByTestId('ticket-row-tk-2');
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn() };
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.drop(target, { dataTransfer, clientY: 30 });

    expect(onReorderTickets).not.toHaveBeenCalled();
    expect(source).not.toHaveAttribute('draggable', 'true');
  });
});

describe('TicketTable load status', () => {
  const props = {
    tickets: [] as PmTicket[],
    allTickets: [] as PmTicket[],
    testCases: [] as PmTestCase[],
    selectedTicketId: null as string | null,
    dependencies: [] as PmDependency[],
    onSelectTicket: vi.fn(),
    onUpdateTicket: vi.fn(),
    onAddTicket: vi.fn(),
  };

  it('does not claim there are no tickets while they load', () => {
    render(<TicketTable {...props} loading />);
    expect(screen.getByTestId('ticket-table-loading')).toBeInTheDocument();
    expect(screen.queryByText('No tickets')).not.toBeInTheDocument();
  });

  it('says tickets could not be read instead of showing none', () => {
    render(<TicketTable {...props} loadError="database is locked" />);
    expect(screen.getByTestId('ticket-table-error')).toHaveTextContent('database is locked');
    expect(screen.queryByText('No tickets')).not.toBeInTheDocument();
  });

  it('shows the empty state once a load finished with no tickets', () => {
    render(<TicketTable {...props} />);
    expect(screen.getByText('No tickets')).toBeInTheDocument();
  });
});
