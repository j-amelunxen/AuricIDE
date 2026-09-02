import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Line: () => <div />,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
}));

// The metrics module is deliberately NOT mocked. Feeding the view invented
// numbers would leave the one thing worth testing — that the panel reports what
// the history actually says — driven by the test rather than by the code.

const mockStore: Record<string, unknown> = {
  rootPath: '/test/project',
  pmStatusHistory: [],
  pmHistoryLoading: false,
  loadPmHistory: vi.fn(),
  pmTickets: [],
  pmEpics: [],
  pmDirty: false,
};

vi.mock('@/lib/store', () => ({
  useStore: vi.fn((selector: (s: typeof mockStore) => unknown) => selector(mockStore)),
}));

import { MetricsView } from './MetricsView';

const NOW = '2026-01-26T00:00:00Z';

let historyId = 0;
function entry(ticketId: string, fromStatus: string | null, toStatus: string, changedAt: string) {
  historyId += 1;
  return { id: `h${historyId}`, ticketId, fromStatus, toStatus, changedAt, source: 'ui' };
}

function ticket(id: string, epicId: string, name: string, status: string) {
  return {
    id,
    epicId,
    name,
    status,
    description: '',
    createdAt: '',
    updatedAt: '',
    statusUpdatedAt: '',
    sortOrder: 0,
    priority: 'normal',
  };
}

/**
 * Six tickets finished at an accelerating pace, plus one still in flight. The
 * spacing is uneven on purpose: a uniform cadence would make every basis window
 * agree, and the whole point of the windows is that they disagree.
 */
function seedProject() {
  const completions = [
    '2026-01-02T00:00:00Z',
    '2026-01-12T00:00:00Z',
    '2026-01-22T00:00:00Z',
    '2026-01-23T00:00:00Z',
    '2026-01-24T00:00:00Z',
    '2026-01-25T00:00:00Z',
  ];

  const history = completions.flatMap((doneAt, i) => [
    entry(`t${i + 1}`, null, 'open', '2026-01-01T00:00:00Z'),
    entry(`t${i + 1}`, 'open', 'done', doneAt),
  ]);
  // One ticket was actually worked rather than just closed, so there is a cycle
  // time to average at all.
  history.push(entry('t6', 'open', 'in_progress', '2026-01-24T00:00:00Z'));

  history.push(entry('t7', null, 'open', '2026-01-01T00:00:00Z'));
  history.push(entry('t7', 'open', 'in_progress', '2026-01-20T00:00:00Z'));

  mockStore.pmStatusHistory = history;
  mockStore.pmTickets = [
    ...completions.map((_, i) => ticket(`t${i + 1}`, 'e1', `Ticket ${i + 1}`, 'done')),
    ticket('t7', 'e2', 'Still Running', 'in_progress'),
  ];
  mockStore.pmEpics = [
    { id: 'e1', name: 'Epic One' },
    { id: 'e2', name: 'Epic Two' },
  ];
}

function cardValue(label: string): string {
  const card = screen.getByText(label).closest('div')!.parentElement!;
  return within(card).getAllByText(/.+/)[1].textContent ?? '';
}

describe('MetricsView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(NOW));
    vi.clearAllMocks();
    historyId = 0;
    mockStore.rootPath = '/test/project';
    mockStore.pmStatusHistory = [];
    mockStore.pmHistoryLoading = false;
    mockStore.loadPmHistory = vi.fn();
    mockStore.pmTickets = [];
    mockStore.pmEpics = [];
    mockStore.pmDirty = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading state', () => {
    mockStore.pmHistoryLoading = true;
    render(<MetricsView />);
    expect(screen.getByText('Loading metrics...')).toBeDefined();
  });

  it('shows empty state when no history', () => {
    render(<MetricsView />);
    expect(
      screen.getByText('No status history data yet. Metrics will appear as tickets change status.')
    ).toBeDefined();
  });

  it('calls loadPmHistory on mount when rootPath is set', () => {
    render(<MetricsView />);
    expect(mockStore.loadPmHistory).toHaveBeenCalledWith('/test/project');
  });

  it('does not call loadPmHistory when rootPath is null', () => {
    mockStore.rootPath = null;
    render(<MetricsView />);
    expect(mockStore.loadPmHistory).not.toHaveBeenCalled();
  });

  it('reports cycle, lead, throughput and a project ETA from the real history', () => {
    seedProject();
    render(<MetricsView />);

    // t6 alone was worked: in_progress Jan 24 -> done Jan 25.
    expect(cardValue('Avg Cycle Time')).toBe('1d 0h');
    // Six tickets created Jan 1, finished 1/11/21/22/23/24 days later.
    expect(cardValue('Avg Lead Time')).toBe('17d 0h');
    // Five intervals across the 23 days from the first completion to the last.
    expect(cardValue('Throughput')).toBe('0.22/day');
    // One ticket left at that pace, counted from Jan 26.
    expect(cardValue('Project ETA')).toBe('5d');
    expect(screen.getAllByText(/2026-01-31/).length).toBeGreaterThan(0);
  });

  it('states the window every estimate rests on', () => {
    seedProject();
    render(<MetricsView />);

    expect(screen.getByText('6 tickets completed over 23d 0h')).toBeDefined();
  });

  it('re-estimates from the last N completed tickets when the basis changes', async () => {
    const user = userEvent.setup();
    seedProject();
    render(<MetricsView />);

    expect(cardValue('Project ETA')).toBe('5d');

    await user.click(screen.getByRole('button', { name: 'Last 5' }));

    // The oldest, slowest ticket drops out: four intervals across 13 days.
    expect(screen.getByText('5 tickets completed over 13d 0h')).toBeDefined();
    expect(cardValue('Throughput')).toBe('0.31/day');
    expect(cardValue('Project ETA')).toBe('4d');
    expect(cardValue('Avg Lead Time')).toBe('20d 4h');
  });

  it('reports how long tickets sat in each status they have left', () => {
    seedProject();
    render(<MetricsView />);

    const table = screen.getByText('Time in Status').closest('div')!.parentElement!;
    const open = within(table).getByText('Open').closest('tr')!;

    // Every ticket has left `open`, including the one still running.
    expect(within(open).getAllByRole('cell')[1].textContent).toBe('7');
    expect(within(open).getAllByRole('cell')[4].textContent).toBe('23d 0h');

    const inProgress = within(table).getByText('In progress').closest('tr')!;
    // Only t6 has left in_progress; t7 is still sitting in it.
    expect(within(inProgress).getAllByRole('cell')[1].textContent).toBe('1');
  });

  it('lists the unfinished tickets by how long they have been stuck', () => {
    seedProject();
    render(<MetricsView />);

    expect(screen.getByText('Open Tickets (1)')).toBeDefined();
    const row = screen.getByText('Still Running').closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[1].textContent).toBe('In progress');
    // in_progress since Jan 20, now Jan 26.
    expect(cells[2].textContent).toBe('6d 0h');
    // It waited 19 days in `open` before that.
    expect(cells[3].textContent).toBe('19d 0h');
  });

  it('gives the project its own estimate rather than the sum of the epics', () => {
    seedProject();
    render(<MetricsView />);

    const table = screen.getByText('Epic Projections').closest('div')!.parentElement!;
    const epicOne = within(table).getByText('Epic One').closest('tr')!;
    expect(within(epicOne).getAllByRole('cell')[5].textContent).toBe('0d');

    const epicTwo = within(table).getByText('Epic Two').closest('tr')!;
    expect(within(epicTwo).getAllByRole('cell')[5].textContent).toBe('5d');

    const projectRow = within(table).getByText('Project').closest('tr')!;
    const cells = within(projectRow).getAllByRole('cell');
    expect(cells[1].textContent).toBe('7'); // total
    expect(cells[2].textContent).toBe('6'); // done
    expect(cells[4].textContent).toBe('1'); // left
    expect(cells[5].textContent).toBe('5d');
  });

  it('says so when unsaved edits are not in the figures yet', () => {
    seedProject();
    mockStore.pmDirty = true;
    render(<MetricsView />);

    expect(
      screen.getByText(
        'Unsaved changes are not counted yet — these figures read the saved history.'
      )
    ).toBeDefined();
  });

  it('stays silent about unsaved edits when there are none', () => {
    seedProject();
    render(<MetricsView />);

    expect(screen.queryByText(/Unsaved changes are not counted/)).toBeNull();
  });

  it('renders burndown and velocity chart sections', () => {
    seedProject();
    render(<MetricsView />);

    expect(screen.getByText('Burndown')).toBeDefined();
    expect(screen.getByText('Velocity (Daily)')).toBeDefined();
  });

  it('offers the basis windows and marks the active one', () => {
    seedProject();
    render(<MetricsView />);

    expect(screen.getByRole('button', { name: 'Last 5' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Last 20' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'All' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Last 10' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('withholds a pace rather than inventing one from a single completion', () => {
    mockStore.pmStatusHistory = [
      entry('t1', null, 'open', '2026-01-01T00:00:00Z'),
      entry('t1', 'open', 'done', '2026-01-02T00:00:00Z'),
      entry('t2', null, 'open', '2026-01-01T00:00:00Z'),
    ];
    mockStore.pmTickets = [
      ticket('t1', 'e1', 'Done One', 'done'),
      ticket('t2', 'e1', 'Open One', 'open'),
    ];
    mockStore.pmEpics = [{ id: 'e1', name: 'Epic One' }];

    render(<MetricsView />);

    expect(screen.getByText('1 ticket completed — too few to measure a pace.')).toBeDefined();
    expect(cardValue('Throughput')).toBe('—');
    expect(cardValue('Project ETA')).toBe('—');
  });

  it('keeps discarded tickets out of the open list', () => {
    seedProject();
    mockStore.pmTickets = [
      ...(mockStore.pmTickets as ReturnType<typeof ticket>[]),
      ticket('t8', 'e1', 'Thrown Away', 'discarded'),
    ];
    mockStore.pmStatusHistory = [
      ...(mockStore.pmStatusHistory as ReturnType<typeof entry>[]),
      entry('t8', null, 'open', '2026-01-01T00:00:00Z'),
      entry('t8', 'open', 'discarded', '2026-01-02T00:00:00Z'),
    ];

    render(<MetricsView />);

    expect(screen.getByText('Open Tickets (1)')).toBeDefined();
    expect(screen.queryByText('Thrown Away')).toBeNull();
  });

  it('lists completed tickets with cycle and lead time', () => {
    seedProject();
    render(<MetricsView />);

    expect(screen.getByText('Completed Tickets (6)')).toBeDefined();
    const row = screen.getByText('Ticket 6').closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    // in_progress Jan 24 → done Jan 25
    expect(cells[1].textContent).toBe('1d 0h');
    // created Jan 1 → done Jan 25
    expect(cells[2].textContent).toBe('24d 0h');
  });

  it('scopes the open list to one epic', async () => {
    const user = userEvent.setup();
    seedProject();
    render(<MetricsView />);

    await user.selectOptions(screen.getByLabelText('Epic'), 'e2');

    expect(screen.getByText('Open Tickets (1)')).toBeDefined();
    expect(screen.getByText('Still Running')).toBeDefined();
    expect(screen.queryByText('Completed Tickets')).toBeNull();
    expect(screen.queryByText('Ticket 1')).toBeNull();
  });
});
