import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

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

vi.mock('@/lib/pm/metrics', () => ({
  computeTicketMetrics: vi.fn(() => []),
  computeVelocity: vi.fn(() => []),
  computeBurndown: vi.fn(() => []),
  computeEpicProjections: vi.fn(() => []),
  formatDuration: vi.fn((ms: number) => `${Math.round(ms / 60000)}m`),
}));

const mockStore: Record<string, unknown> = {
  rootPath: '/test/project',
  pmStatusHistory: [],
  pmHistoryLoading: false,
  loadPmHistory: vi.fn(),
  pmDraftTickets: [],
  pmDraftEpics: [],
};

vi.mock('@/lib/store', () => ({
  useStore: vi.fn((selector: (s: typeof mockStore) => unknown) => selector(mockStore)),
}));

import { MetricsView } from './MetricsView';
import {
  computeTicketMetrics,
  computeVelocity,
  computeBurndown,
  computeEpicProjections,
} from '@/lib/pm/metrics';

describe('MetricsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.rootPath = '/test/project';
    mockStore.pmStatusHistory = [];
    mockStore.pmHistoryLoading = false;
    mockStore.loadPmHistory = vi.fn();
    mockStore.pmDraftTickets = [];
    mockStore.pmDraftEpics = [];
  });

  it('shows loading state', () => {
    mockStore.pmHistoryLoading = true;
    render(<MetricsView />);
    expect(screen.getByText('Loading metrics...')).toBeDefined();
  });

  it('shows empty state when no history', () => {
    mockStore.pmStatusHistory = [];
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

  it('renders summary cards with history data', () => {
    mockStore.pmStatusHistory = [
      {
        id: 'h1',
        ticketId: 't1',
        fromStatus: null,
        toStatus: 'open',
        changedAt: '2026-01-01T00:00:00Z',
        source: 'user',
      },
    ];
    mockStore.pmDraftTickets = [
      {
        id: 't1',
        epicId: 'e1',
        name: 'Test',
        status: 'done',
        description: '',
        createdAt: '',
        updatedAt: '',
        statusUpdatedAt: '',
        sortOrder: 0,
        priority: 'normal',
      },
    ];

    vi.mocked(computeTicketMetrics).mockReturnValue([
      { ticketId: 't1', cycleTime: 86400000, leadTime: 172800000 },
    ]);
    vi.mocked(computeVelocity).mockReturnValue([
      { periodStart: '2026-01-01', periodEnd: '2026-01-07', completed: 3 },
    ]);
    vi.mocked(computeBurndown).mockReturnValue([
      { date: '2026-01-01', remaining: 5, completed: 0 },
      { date: '2026-01-02', remaining: 4, completed: 1 },
    ]);
    vi.mocked(computeEpicProjections).mockReturnValue([]);

    render(<MetricsView />);

    expect(screen.getByText('Avg Cycle Time')).toBeDefined();
    expect(screen.getByText('Avg Lead Time')).toBeDefined();
    expect(screen.getByText('Current Velocity')).toBeDefined();
    expect(screen.getByText('Total Completed')).toBeDefined();
    expect(screen.getByText('3/wk (0.04/h)')).toBeDefined();
    expect(screen.getByText('1')).toBeDefined(); // total completed
  });

  it('renders burndown and velocity chart sections', () => {
    mockStore.pmStatusHistory = [
      {
        id: 'h1',
        ticketId: 't1',
        fromStatus: null,
        toStatus: 'open',
        changedAt: '2026-01-01T00:00:00Z',
        source: 'user',
      },
    ];

    vi.mocked(computeTicketMetrics).mockReturnValue([]);
    vi.mocked(computeVelocity).mockReturnValue([]);
    vi.mocked(computeBurndown).mockReturnValue([]);
    vi.mocked(computeEpicProjections).mockReturnValue([]);

    render(<MetricsView />);

    expect(screen.getByText('Burndown')).toBeDefined();
    expect(screen.getByText('Velocity (Daily)')).toBeDefined();
  });

  it('renders epic projections table when projections exist', () => {
    mockStore.pmStatusHistory = [
      {
        id: 'h1',
        ticketId: 't1',
        fromStatus: null,
        toStatus: 'open',
        changedAt: '2026-01-01T00:00:00Z',
        source: 'user',
      },
    ];

    vi.mocked(computeTicketMetrics).mockReturnValue([]);
    vi.mocked(computeVelocity).mockReturnValue([]);
    vi.mocked(computeBurndown).mockReturnValue([]);
    vi.mocked(computeEpicProjections).mockReturnValue([
      {
        epicId: 'e1',
        epicName: 'Epic One',
        totalTickets: 5,
        completedTickets: 2,
        avgVelocity: 1.5,
        estimatedDaysRemaining: 14,
      },
      {
        epicId: 'e2',
        epicName: 'Epic Two',
        totalTickets: 10,
        completedTickets: 3,
        avgVelocity: 1.0,
        estimatedDaysRemaining: 49,
      },
    ]);
    vi.mocked(computeTicketMetrics).mockReturnValue([
      { ticketId: 't1', cycleTime: 3600000, leadTime: 7200000 },
    ]);

    render(<MetricsView />);

    expect(screen.getByText('Epic Projections')).toBeDefined();
    expect(screen.getByText('Epic One')).toBeDefined();
    expect(screen.getByText('Epic Two')).toBeDefined();
    expect(screen.getByText('Progress')).toBeDefined();
    expect(screen.getByText('40%')).toBeDefined(); // (2/5)
    expect(screen.getByText('30%')).toBeDefined(); // (3/10)
    expect(screen.getByText('Est. Work-time')).toBeDefined();
    expect(screen.getByText('3h')).toBeDefined(); // (5-2) * 1h
    expect(screen.getByText('7h')).toBeDefined(); // (10-3) * 1h

    // Check footer totals
    const totals = screen.getAllByText('Total');
    expect(totals[1]).toBeDefined(); // The footer "Total"
    expect(screen.getByText('15')).toBeDefined(); // Unique: 5 + 10
    expect(screen.getAllByText('5')).toHaveLength(2); // One in Epic One, one in Footer
    expect(screen.getByText('33%')).toBeDefined(); // Math.round((5/15)*100)
    expect(screen.getByText('10h')).toBeDefined(); // Unique: (3 + 7)h
    expect(screen.getByText('1.3/wk')).toBeDefined(); // Avg: (1.5 + 1.0) / 2 = 1.25 -> 1.3
    expect(screen.getByText('63d')).toBeDefined(); // Sum: 14 + 49
  });

  it('renders burndown filter buttons', () => {
    mockStore.pmStatusHistory = [
      {
        id: 'h1',
        ticketId: 't1',
        fromStatus: null,
        toStatus: 'open',
        changedAt: '2026-01-01T00:00:00Z',
        source: 'user',
      },
    ];

    vi.mocked(computeTicketMetrics).mockReturnValue([]);
    vi.mocked(computeVelocity).mockReturnValue([]);
    vi.mocked(computeBurndown).mockReturnValue([]);
    vi.mocked(computeEpicProjections).mockReturnValue([]);

    render(<MetricsView />);

    expect(screen.getByText('Last 5')).toBeDefined();
    expect(screen.getByText('Last 10')).toBeDefined();
    expect(screen.getByText('All')).toBeDefined();
  });
});
