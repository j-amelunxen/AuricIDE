import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { usageRow } from '@/lib/pm/usage/testRow';
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

describe('TicketTable usage columns', () => {
  const PATH = '/proj';
  const props = {
    tickets: [makeTicket({ id: 'tk-1' }), makeTicket({ id: 'tk-2', name: 'Other' })],
    allTickets: [makeTicket({ id: 'tk-1' }), makeTicket({ id: 'tk-2', name: 'Other' })],
    testCases: [] as PmTestCase[],
    selectedTicketId: null as string | null,
    dependencies: [] as PmDependency[],
    onSelectTicket: vi.fn(),
    onUpdateTicket: vi.fn(),
    onAddTicket: vi.fn(),
  };
  const seed = (rows: ReturnType<typeof usageRow>[]) =>
    useStore.setState({
      rootPath: PATH,
      agentUsageRows: { [PATH]: rows },
      agentUsageStatus: { [PATH]: 'ready' },
    });

  beforeEach(() => {
    localStorage.clear();
    seed([]);
  });
  afterEach(() => useStore.setState({ rootPath: null, agentUsageRows: {}, agentUsageStatus: {} }));

  it('shows no usage columns by default', () => {
    render(<TicketTable {...props} />);
    expect(screen.queryByTestId('ticket-cost-tk-1')).toBeNull();
    expect(screen.queryByTestId('ticket-tokens-tk-1')).toBeNull();
  });

  it('turns columns on from the menu, persists the choice, and restores it', () => {
    const { unmount } = render(<TicketTable {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    const cost = screen.getByRole('menuitemcheckbox', { name: /Cost/ });
    expect(cost.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(cost);

    expect(screen.getByTestId('ticket-cost-tk-1')).toBeDefined();
    expect(screen.queryByTestId('ticket-tokens-tk-1')).toBeNull();
    expect(localStorage.getItem(APP_CONFIG_KEYS.pmTicketUsageColumns)).toBe('["cost"]');

    unmount();
    render(<TicketTable {...props} />);
    expect(screen.getByTestId('ticket-cost-tk-1')).toBeDefined();
  });

  it('marks a cost that is missing runs, with a tooltip and an accessible label', () => {
    localStorage.setItem(APP_CONFIG_KEYS.pmTicketUsageColumns, '["cost"]');
    seed([
      usageRow({ ticketId: 'tk-1', costUsd: 1.2 }),
      usageRow({ ticketId: 'tk-1', costUsd: null, costSource: 'none' }),
      usageRow({ ticketId: 'tk-2', costUsd: 3 }),
    ]);
    render(<TicketTable {...props} />);
    const partial = screen.getByTestId('ticket-cost-tk-1');
    expect(partial.textContent).toBe('$1.20+');
    expect(partial.getAttribute('title')).toBe('+ 1 run without price');
    expect(partial.getAttribute('aria-label')).toBe('$1.20, + 1 run without price');
    const complete = screen.getByTestId('ticket-cost-tk-2');
    expect(complete.textContent).toBe('$3.00');
    expect(complete.getAttribute('title')).toBeNull();
  });

  it('marks the table so the list column can widen while usage columns are on', () => {
    const { container, unmount } = render(<TicketTable {...props} />);
    expect(container.querySelector('[data-usage-columns]')).toBeNull();
    unmount();
    localStorage.setItem(APP_CONFIG_KEYS.pmTicketUsageColumns, '["cost"]');
    const second = render(<TicketTable {...props} />);
    expect(second.container.querySelector('[data-usage-columns]')).not.toBeNull();
  });

  it('closes the menu on Escape', () => {
    render(<TicketTable {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('fills the cells with per-ticket totals when usage arrives after mount', () => {
    localStorage.setItem(APP_CONFIG_KEYS.pmTicketUsageColumns, '["tokens","cost"]');
    render(<TicketTable {...props} />);
    expect(screen.getByTestId('ticket-cost-tk-1').textContent).toBe('—');

    act(() =>
      seed([
        usageRow({ ticketId: 'tk-1', costUsd: 1.5, inputTokens: 1000, outputTokens: 500 }),
        usageRow({ ticketId: 'tk-1', costUsd: 0.5, inputTokens: 500 }),
        usageRow({ ticketId: 'tk-2', costUsd: null, costSource: 'none' }),
      ])
    );

    expect(screen.getByTestId('ticket-cost-tk-1').textContent).toBe('$2.00');
    expect(screen.getByTestId('ticket-tokens-tk-1').textContent).toBe('2k');
    expect(screen.getByTestId('ticket-cost-tk-2').textContent).toBe('—');
  });
});
