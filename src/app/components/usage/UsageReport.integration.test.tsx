import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStore } from '@/lib/store';
import type {
  CcUsagePlugin,
  CcUsageReport,
  UsageAggregate,
  UsageNamedAggregate,
  UsageTokenCounts,
  UsageWindowId,
  UsageWindowReport,
} from '@/lib/usage/ccUsage';
import type { UsageSnapshot } from '@/lib/usage/types';

const ccUsagePlugins = vi.fn(async (): Promise<CcUsagePlugin[]> => []);
const ccUsageReport = vi.fn(async (): Promise<CcUsageReport> => emptyReport());

vi.mock('@/lib/usage/ccUsage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/usage/ccUsage')>('@/lib/usage/ccUsage');
  return {
    ...actual,
    ccUsagePlugins: () => ccUsagePlugins(),
    ccUsageReport: (options?: { force?: boolean }) => ccUsageReport(options),
  };
});
// The chip re-reads stored quota on mount, so the mock has to return what a
// test set up — otherwise awaiting anything clears the snapshots under it.
let storedSnapshots: UsageSnapshot[] = [];
vi.mock('@/lib/tauri/usageLimits', () => ({
  usageLimitsRead: vi.fn(async () => storedSnapshots),
  usageLimitsRefresh: vi.fn(async () => storedSnapshots),
}));
vi.mock('@/lib/tauri/usageEvents', () => ({ onUsageLimitsChanged: vi.fn(() => () => {}) }));
vi.mock('@/lib/hooks/useNow', () => ({ useNow: () => NOW * 1000 }));

import { CliQuotaChip } from './CliQuotaChip';

const NOW = 1_787_400_000;
const HOUR = 3600;

function counts(partial: Partial<UsageTokenCounts> = {}): UsageTokenCounts {
  return {
    input: 0,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    thinking: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
    ...partial,
  };
}

function aggregate(partial: Partial<UsageAggregate> = {}): UsageAggregate {
  return { counts: counts(), cost: 0, cacheSaving: 0, messages: 0, ...partial };
}

function row(
  key: string,
  label: string,
  cost: number,
  series: number[],
  partial: Partial<UsageNamedAggregate> = {}
): UsageNamedAggregate {
  return {
    key,
    label,
    aggregate: aggregate({ cost, messages: 100, counts: counts({ input: 500 }) }),
    sessions: 5,
    unpriced: false,
    series,
    ...partial,
  };
}

function windowReport(
  id: UsageWindowId,
  hours: number,
  partial: Partial<UsageWindowReport> = {}
): UsageWindowReport {
  return {
    id,
    label: `${hours} hours`,
    hours,
    startsAt: NOW - hours * HOUR,
    endsAt: NOW,
    bucketSeconds: HOUR,
    totals: aggregate(),
    models: [],
    projects: [],
    buckets: [],
    sessions: 0,
    sidechainMessages: 0,
    unpricedModels: [],
    previous: null,
    ...partial,
  };
}

function emptyReport(): CcUsageReport {
  return {
    pluginId: 'claude-code',
    pluginName: 'Claude Code',
    currency: 'USD',
    generatedAt: NOW,
    windows: [
      windowReport('24h', 24),
      windowReport('3d', 72),
      windowReport('7d', 168),
      windowReport('30d', 720),
    ],
    filesScanned: 0,
    turnsRead: 0,
    duplicatesDropped: 0,
    scanMs: 4,
  };
}

/** A report with distinct figures per window, so a mixed-up tab is visible. */
function populatedReport(overrides: Partial<CcUsageReport> = {}): CcUsageReport {
  const base = emptyReport();
  return {
    ...base,
    filesScanned: 2547,
    turnsRead: 131_362,
    duplicatesDropped: 68_914,
    scanMs: 1192,
    windows: [
      windowReport('24h', 24, {
        totals: aggregate({
          cost: 592.02,
          cacheSaving: 1200,
          messages: 5210,
          counts: counts({ input: 1000, output: 2000, cacheRead: 900_000, cacheWrite5m: 50_000 }),
        }),
        sessions: 89,
        sidechainMessages: 1042,
        models: [
          row('claude-opus-5', 'Opus 5', 466.22, [90, 376.22]),
          row('claude-haiku-4-5', 'Haiku 4.5', 3.69, [3.69, 0]),
        ],
        projects: [row('/tmp/workspace/alpha', 'alpha', 500, [100, 400])],
        buckets: [
          { startsAt: NOW - 2 * HOUR, cost: 100, tokens: 500, messages: 20 },
          { startsAt: NOW - HOUR, cost: 492.02, tokens: 900, messages: 40 },
        ],
        previous: aggregate({ cost: 500, messages: 4000 }),
      }),
      windowReport('3d', 72, {
        totals: aggregate({ cost: 2009.6, messages: 15_573, counts: counts({ input: 5000 }) }),
        sessions: 271,
        previous: aggregate({ cost: 2500, messages: 18_000 }),
      }),
      windowReport('7d', 168),
      windowReport('30d', 720),
    ],
    ...overrides,
  };
}

function withQuota() {
  storedSnapshots = [snapshot()];
  useStore.setState({ usageSnapshots: storedSnapshots, usageStatus: 'ready' });
}

function snapshot(): UsageSnapshot {
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
        resetsAt: NOW + HOUR,
        windowMinutes: 10080,
      },
    ],
    credits: null,
    observedAt: NOW - 90,
    source: 'app-server',
  };
}

const AVAILABLE: CcUsagePlugin[] = [
  { id: 'claude-code', name: 'Claude Code', currency: 'USD', available: true },
];

async function openReport() {
  render(<CliQuotaChip />);
  const button = await screen.findByTestId('usage-report-open');
  fireEvent.click(button);
  return await screen.findByTestId('usage-report-modal');
}

describe('the way into the usage report', () => {
  beforeEach(() => {
    ccUsagePlugins.mockReset();
    ccUsageReport.mockReset();
    ccUsagePlugins.mockResolvedValue(AVAILABLE);
    ccUsageReport.mockResolvedValue(populatedReport());
    storedSnapshots = [];
    useStore.setState({ usageSnapshots: [], usageStatus: 'idle' });
  });

  afterEach(() => {
    useStore.setState({ usageSnapshots: [], usageStatus: 'idle' });
  });

  it('is reachable when no quota has ever been read', async () => {
    // The quota chip only appears once a CLI has reported one, and that needs
    // an interactive agent to have run. Hanging the report off it would leave
    // a user who has never seen a quota with nothing to press.
    render(<CliQuotaChip />);
    expect(await screen.findByTestId('usage-report-open')).toBeInTheDocument();
    expect(screen.queryByTestId('cli-quota-chip')).not.toBeInTheDocument();
  });

  it('sits beside the quota chip when there is one', async () => {
    withQuota();
    render(<CliQuotaChip />);
    expect(await screen.findByTestId('usage-report-open')).toBeInTheDocument();
    expect(screen.getByTestId('cli-quota-chip')).toBeInTheDocument();
  });

  it('does not offer a button when no plugin can answer', async () => {
    // A control that opens an empty panel is worse than no control.
    ccUsagePlugins.mockResolvedValue([
      { id: 'claude-code', name: 'Claude Code', currency: 'USD', available: false },
    ]);
    const { container } = render(<CliQuotaChip />);
    await waitFor(() => expect(ccUsagePlugins).toHaveBeenCalled());
    expect(screen.queryByTestId('usage-report-open')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('survives a backend that has no usage commands at all', async () => {
    // Browser mode. The chip must still render whatever quota it has.
    ccUsagePlugins.mockRejectedValue(new Error('Tauri IPC is unavailable (cc_usage_plugins)'));
    withQuota();
    render(<CliQuotaChip />);
    await waitFor(() => expect(ccUsagePlugins).toHaveBeenCalled());
    expect(screen.getByTestId('cli-quota-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('usage-report-open')).not.toBeInTheDocument();
  });

  it('reads no transcripts until the panel is actually opened', async () => {
    // Listing plugins is cheap; building a report walks gigabytes. Doing the
    // second one at startup would make every launch pay for a panel nobody
    // opened.
    render(<CliQuotaChip />);
    await screen.findByTestId('usage-report-open');
    expect(ccUsageReport).not.toHaveBeenCalled();
  });

  it('opens the panel on the button', async () => {
    await openReport();
    expect(ccUsageReport).toHaveBeenCalled();
  });
});

describe('the usage report panel', () => {
  beforeEach(() => {
    ccUsagePlugins.mockReset();
    ccUsageReport.mockReset();
    ccUsagePlugins.mockResolvedValue(AVAILABLE);
    ccUsageReport.mockResolvedValue(populatedReport());
    storedSnapshots = [];
    useStore.setState({ usageSnapshots: [], usageStatus: 'idle' });
  });

  it('opens on the last 24 hours', async () => {
    await openReport();
    expect(await screen.findByTestId('usage-total-cost')).toHaveTextContent('$592.02');
  });

  it('switches period without reading the transcripts again', async () => {
    // All four windows come from one scan. A rescan per tab would make the
    // panel feel broken for a figure that is already in hand.
    await openReport();
    await screen.findByTestId('usage-total-cost');
    const callsAfterOpen = ccUsageReport.mock.calls.length;

    fireEvent.click(screen.getByTestId('usage-window-3d'));
    expect(await screen.findByTestId('usage-total-cost')).toHaveTextContent('$2,009.60');
    expect(ccUsageReport.mock.calls.length).toBe(callsAfterOpen);
  });

  it('says the money is a list-price equivalent, not a bill', async () => {
    // The one thing a reader must not get wrong: on a subscription, none of
    // these figures is what the account is charged.
    const modal = await openReport();
    expect(modal).toHaveTextContent(/published API rates/i);
    expect(modal).toHaveTextContent(/bills the subscription/i);
  });

  it('names a model it has no rate for instead of quietly undercounting', async () => {
    const report = populatedReport();
    report.windows[0].unpricedModels = ['claude-unknown-9'];
    ccUsageReport.mockResolvedValue(report);

    await openReport();
    const note = await screen.findByTestId('usage-unpriced');
    expect(note).toHaveTextContent('claude-unknown-9');
    expect(note).toHaveTextContent(/understates/i);
  });

  it('says how many turns were counted once rather than twice', async () => {
    // Over half the turns in a real corpus are duplicates. A total with no
    // word about that invites the question of whether it double-counts.
    const modal = await openReport();
    expect(modal).toHaveTextContent('68,914');
    expect(modal).toHaveTextContent(/more than one transcript/i);
  });

  it('shows an idle period as idle rather than as zeroes', async () => {
    ccUsageReport.mockResolvedValue(emptyReport());
    await openReport();
    expect(await screen.findByTestId('usage-window-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('usage-total-cost')).not.toBeInTheDocument();
  });

  it('surfaces the backend reason when a scan fails', async () => {
    // "Could not load usage" would throw away the one line that says why.
    ccUsageReport.mockRejectedValue(new Error('No usage plugin with id "typo"'));
    await openReport();
    expect(await screen.findByRole('alert')).toHaveTextContent('No usage plugin with id "typo"');
  });

  it('rescans only when asked to', async () => {
    await openReport();
    await screen.findByTestId('usage-total-cost');
    expect(ccUsageReport).toHaveBeenLastCalledWith({ force: false });

    fireEvent.click(screen.getByTestId('usage-report-refresh'));
    await waitFor(() => expect(ccUsageReport).toHaveBeenLastCalledWith({ force: true }));
  });

  it('closes on Escape', async () => {
    await openReport();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('usage-report-modal')).not.toBeInTheDocument());
  });

  it('answers "compared to what?" beside the total', async () => {
    // A bare total is unreadable: $625 in a day is only meaningful against the
    // day before. 592.02 against 500 is a rise of a bit over 18%.
    await openReport();
    const change = await screen.findByTestId('usage-change');
    expect(change).toHaveTextContent('+18%');
    expect(change).toHaveTextContent('$500.00');
  });

  it('shows a drop as a drop', async () => {
    await openReport();
    await screen.findByTestId('usage-total-cost');
    fireEvent.click(screen.getByTestId('usage-window-3d'));
    // 2009.60 against 2500 is a fall of about 20%.
    expect(await screen.findByTestId('usage-change')).toHaveTextContent('−20%');
  });

  it('offers no comparison when the history does not reach back', async () => {
    // The failure this prevents: a fresh install reporting its window against
    // an "empty" earlier period and showing a vast increase that is really
    // just the absence of data.
    const report = populatedReport();
    report.windows[0].previous = null;
    ccUsageReport.mockResolvedValue(report);

    await openReport();
    expect(await screen.findByTestId('usage-no-comparison')).toBeInTheDocument();
    expect(screen.queryByTestId('usage-change')).not.toBeInTheDocument();
  });

  it('offers no comparison against a period that spent nothing', async () => {
    // Any increase over zero is an infinite one, and "+∞%" is a division
    // artefact rather than a finding.
    const report = populatedReport();
    report.windows[0].previous = aggregate({ cost: 0, messages: 0 });
    ccUsageReport.mockResolvedValue(report);

    await openReport();
    expect(await screen.findByTestId('usage-no-comparison')).toBeInTheDocument();
  });

  it('draws each breakdown row as its own series', async () => {
    // Small multiples: the row says how much *and when*, which the percentage
    // bar this replaced could not.
    await openReport();
    expect(await screen.findByTestId('usage-sparkline-claude-opus-5')).toBeInTheDocument();
    expect(screen.getByTestId('usage-sparkline-claude-haiku-4-5')).toBeInTheDocument();
    expect(screen.getByTestId('usage-sparkline-/tmp/workspace/alpha')).toBeInTheDocument();
  });

  it('scales every row against the same ceiling', async () => {
    // The reading is the comparison *between* rows, so a quiet row has to
    // render quiet. Per-row scaling would stretch Haiku's $3.69 to the same
    // height as Opus's $466 and invert the finding.
    await openReport();
    const loud = await screen.findByTestId('usage-sparkline-claude-opus-5');
    const quiet = screen.getByTestId('usage-sparkline-claude-haiku-4-5');

    const peakOf = (svg: HTMLElement) => {
      const path = svg.querySelector('path[fill="none"]')?.getAttribute('d') ?? '';
      const ys = [...path.matchAll(/[ML][\d.]+,([\d.]+)/g)].map((match) => Number(match[1]));
      // Smallest y is the tallest point — SVG y grows downward.
      return Math.min(...ys);
    };

    expect(peakOf(loud)).toBeLessThan(peakOf(quiet));
  });

  it('states the shared scale rather than leaving it to be inferred', async () => {
    const modal = await openReport();
    expect(modal).toHaveTextContent(/shares this scale/i);
  });

  it('labels the chart ceiling so a bar can be read, not just seen', async () => {
    const modal = await openReport();
    // The tallest bucket is $492.02; without the label the chart shows shape
    // but no magnitude.
    expect(modal).toHaveTextContent('$492.02');
  });

  it('carries every bucket of the period, quiet ones included', async () => {
    const modal = await openReport();
    const chart = modal.querySelector('[data-testid="usage-buckets"]');
    expect(chart?.querySelectorAll('rect')).toHaveLength(2);
  });
});
