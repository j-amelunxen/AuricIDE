import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { UsageReportModal } from './UsageReportModal';
import { useStore } from '@/lib/store';
import type { CcUsageReport, UsageWindowReport } from '@/lib/usage/ccUsage';

const ccUsageReportMock = vi.fn();
vi.mock('@/lib/usage/ccUsage', async () => {
  const actual = await vi.importActual('@/lib/usage/ccUsage');
  return {
    ...actual,
    ccUsageReport: (opts: unknown) => ccUsageReportMock(opts),
  };
});

function makeWindow(
  id: '24h' | '3d' | '7d' | '30d',
  label: string,
  messages = 10
): UsageWindowReport {
  return {
    id,
    label,
    hours: 24,
    startsAt: 1700000000,
    endsAt: 1700086400,
    bucketSeconds: 3600,
    totals: {
      counts: {
        input: 1000,
        output: 500,
        cacheWrite5m: 100,
        cacheWrite1h: 50,
        cacheRead: 200,
        thinking: 150,
        webSearchRequests: 2,
        webFetchRequests: 0,
      },
      cost: 1.25,
      cacheSaving: 0.15,
      messages,
    },
    models: [
      {
        key: 'claude-3-7-sonnet',
        label: 'Claude 3.7 Sonnet',
        aggregate: {
          counts: {
            input: 1000,
            output: 500,
            cacheWrite5m: 100,
            cacheWrite1h: 50,
            cacheRead: 200,
            thinking: 150,
            webSearchRequests: 2,
            webFetchRequests: 0,
          },
          cost: 1.25,
          cacheSaving: 0.15,
          messages,
        },
        sessions: 2,
        unpriced: false,
        series: [0.1, 0.5, 0.65],
      },
    ],
    projects: [
      {
        key: '/path/to/project',
        label: 'Project Alpha',
        aggregate: {
          counts: {
            input: 1000,
            output: 500,
            cacheWrite5m: 100,
            cacheWrite1h: 50,
            cacheRead: 200,
            thinking: 150,
            webSearchRequests: 2,
            webFetchRequests: 0,
          },
          cost: 1.25,
          cacheSaving: 0.15,
          messages,
        },
        sessions: 2,
        unpriced: false,
        series: [0.1, 0.5, 0.65],
      },
    ],
    buckets: [
      { startsAt: 1700000000, cost: 0.1, tokens: 200, messages: 2 },
      { startsAt: 1700003600, cost: 0.5, tokens: 600, messages: 4 },
      { startsAt: 1700007200, cost: 0.65, tokens: 700, messages: 4 },
    ],
    sessions: 2,
    sidechainMessages: 3,
    unpricedModels: [],
    previous: {
      counts: {
        input: 800,
        output: 400,
        cacheWrite5m: 80,
        cacheWrite1h: 40,
        cacheRead: 160,
        thinking: 100,
        webSearchRequests: 1,
        webFetchRequests: 0,
      },
      cost: 1.0,
      cacheSaving: 0.1,
      messages: 8,
    },
  };
}

const mockReport: CcUsageReport = {
  pluginId: 'claude-code',
  pluginName: 'Claude Code',
  currency: 'USD',
  generatedAt: 1700086400,
  windows: [
    makeWindow('24h', '24 hours'),
    makeWindow('3d', '3 days'),
    makeWindow('7d', '7 days'),
    makeWindow('30d', '30 days'),
  ],
  filesScanned: 12,
  turnsRead: 45,
  duplicatesDropped: 2,
  scanMs: 34,
};

describe('UsageReportModal', () => {
  beforeEach(() => {
    ccUsageReportMock.mockReset();
  });

  afterEach(() => {
    useStore.setState({ overlayStack: { layers: [] } });
  });

  it('renders nothing when closed', () => {
    const { container } = render(<UsageReportModal isOpen={false} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders loading state while report is fetching', () => {
    ccUsageReportMock.mockReturnValue(new Promise(() => {}));
    render(<UsageReportModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /cli usage report/i })).toBeInTheDocument();
    expect(screen.getAllByText('Reading transcripts…').length).toBeGreaterThanOrEqual(1);
  });

  it('renders error alert when report fetch fails', async () => {
    ccUsageReportMock.mockRejectedValue(new Error('Failed to scan transcripts'));
    render(<UsageReportModal isOpen={true} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to scan transcripts');
  });

  it('renders report data, windows, and charts when fetch succeeds', async () => {
    ccUsageReportMock.mockResolvedValue(mockReport);
    render(<UsageReportModal isOpen={true} onClose={vi.fn()} />);

    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByTestId('usage-total-cost')).toHaveTextContent('$1.25');
    expect(screen.getByTestId('usage-change')).toBeInTheDocument();
    expect(screen.getByTestId('usage-buckets')).toBeInTheDocument();
    expect(screen.getAllByTestId('usage-breakdown-row').length).toBeGreaterThan(0);
    expect(screen.getByText('Claude 3.7 Sonnet')).toBeInTheDocument();
    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
  });

  it('allows switching windows', async () => {
    const user = userEvent.setup();
    ccUsageReportMock.mockResolvedValue(mockReport);
    render(<UsageReportModal isOpen={true} onClose={vi.fn()} />);

    await screen.findByText('Claude Code');
    const tab3d = screen.getByTestId('usage-window-3d');
    await user.click(tab3d);

    expect(tab3d).toHaveAttribute('aria-pressed', 'true');
  });

  it('triggers rescan on refresh button click', async () => {
    const user = userEvent.setup();
    ccUsageReportMock.mockResolvedValue(mockReport);
    render(<UsageReportModal isOpen={true} onClose={vi.fn()} />);

    await screen.findByText('Claude Code');
    expect(ccUsageReportMock).toHaveBeenCalledWith({ force: false });

    const refreshBtn = screen.getByTestId('usage-report-refresh');
    await user.click(refreshBtn);

    expect(ccUsageReportMock).toHaveBeenCalledWith({ force: true });
  });

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    ccUsageReportMock.mockResolvedValue(mockReport);
    render(<UsageReportModal isOpen={true} onClose={onClose} />);

    await screen.findByText('Claude Code');
    const closeBtn = screen.getByRole('button', { name: /close usage report/i });
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it('renders empty state when window has no messages', async () => {
    const emptyReport: CcUsageReport = {
      ...mockReport,
      windows: [makeWindow('24h', '24 hours', 0)],
    };
    ccUsageReportMock.mockResolvedValue(emptyReport);
    render(<UsageReportModal isOpen={true} onClose={vi.fn()} />);

    expect(await screen.findByTestId('usage-window-empty')).toHaveTextContent(
      'Nothing recorded in the last 24 hours.'
    );
  });
});
