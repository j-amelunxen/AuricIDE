import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConductorPanel, formatRunDuration } from './ConductorPanel';
import type { PmTicket } from '@/lib/tauri/pm';
import type { ConductorRunSummary } from '@/lib/store/conductorSlice';

function makeLastRun(overrides: Partial<ConductorRunSummary> = {}): ConductorRunSummary {
  return {
    outcome: 'finished',
    goalName: null,
    completed: 3,
    failed: 0,
    blockers: [],
    startedAt: '2026-01-01T10:00:00.000Z',
    endedAt: '2026-01-01T10:12:00.000Z',
    ...overrides,
  };
}

function makeTicket(overrides: Partial<PmTicket> = {}): PmTicket {
  return {
    id: 't1',
    epicId: 'e1',
    name: 'Supervised ticket',
    description: '',
    status: 'open',
    statusUpdatedAt: '',
    sortOrder: 0,
    priority: 'normal',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof ConductorPanel>[0]> = {}) {
  const props = {
    running: false,
    scopeGoalName: null,
    maxConcurrent: 2,
    activeAgentCount: 0,
    pendingApprovals: [] as PmTicket[],
    decisions: [],
    lastRun: null as ConductorRunSummary | null,
    canStart: true,
    providers: [],
    providerId: null,
    model: null,
    requireReview: false,
    judgeForm: 'llm' as const,
    judgeConfigured: true,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onSetMaxConcurrent: vi.fn(),
    onSetProvider: vi.fn(),
    onSetModel: vi.fn(),
    onSetRequireReview: vi.fn(),
    onSetJudgeForm: vi.fn(),
    onApprove: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<ConductorPanel {...props} />);
  return props;
}

describe('ConductorPanel', () => {
  const providers = [
    {
      id: 'claude',
      name: 'Claude Code',
      models: [
        { value: 'sonnet', label: 'Sonnet' },
        { value: 'opus', label: 'Opus' },
      ],
      permissionModes: [],
      defaultModel: 'sonnet',
      defaultPermissionMode: 'acceptEdits',
    },
  ];

  it('lets the user pick an agent provider and model before starting', () => {
    const props = renderPanel({ providers });
    const providerSelect = screen.getByTestId('conductor-provider-select');
    fireEvent.change(providerSelect, { target: { value: 'claude' } });
    expect(props.onSetProvider).toHaveBeenCalledWith('claude');

    const modelSelect = screen.getByTestId('conductor-model-select');
    fireEvent.change(modelSelect, { target: { value: 'opus' } });
    expect(props.onSetModel).toHaveBeenCalledWith('opus');
  });

  it('hides the agent/model selectors while running', () => {
    renderPanel({ providers, running: true });
    expect(screen.queryByTestId('conductor-provider-select')).not.toBeInTheDocument();
  });

  it('starts the conductor', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByTestId('conductor-start-btn'));
    expect(props.onStart).toHaveBeenCalled();
  });

  it('stops the conductor while running', () => {
    const props = renderPanel({ running: true });
    fireEvent.click(screen.getByTestId('conductor-stop-btn'));
    expect(props.onStop).toHaveBeenCalled();
  });

  it('disables start without a project', () => {
    renderPanel({ canStart: false });
    expect((screen.getByTestId('conductor-start-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows approval queue and forwards approve/dismiss', () => {
    const props = renderPanel({ pendingApprovals: [makeTicket()] });
    expect(screen.getByTestId('conductor-approvals')).toBeTruthy();
    fireEvent.click(screen.getByTestId('conductor-approve-t1'));
    expect(props.onApprove).toHaveBeenCalledWith('t1');
    fireEvent.click(screen.getByTestId('conductor-dismiss-t1'));
    expect(props.onDismiss).toHaveBeenCalledWith('t1');
  });

  it('updates max concurrency', () => {
    const props = renderPanel();
    fireEvent.change(screen.getByTestId('conductor-max-concurrent'), { target: { value: '4' } });
    expect(props.onSetMaxConcurrent).toHaveBeenCalledWith(4);
  });

  describe('last run summary', () => {
    it('shows plain "stopped" when nothing has run yet', () => {
      renderPanel();
      expect(screen.queryByTestId('conductor-last-run')).not.toBeInTheDocument();
      expect(screen.getByTestId('conductor-panel').textContent).toContain('stopped');
    });

    it('summarizes a finished run with counts and duration', () => {
      renderPanel({ lastRun: makeLastRun() });
      const summary = screen.getByTestId('conductor-last-run');
      expect(summary.textContent).toContain('finished');
      expect(summary.textContent).toContain('3 done');
      expect(summary.textContent).toContain('12m');
      expect(summary.textContent).not.toContain('failed');
    });

    it('celebrates an achieved goal by name, calmly', () => {
      renderPanel({
        lastRun: makeLastRun({ outcome: 'goal_achieved', goalName: 'Ship v1', completed: 4 }),
      });
      const summary = screen.getByTestId('conductor-last-run');
      expect(summary.textContent).toContain('achieved "Ship v1"');
      expect(summary.textContent).toContain('4 done');
    });

    it('spells out a blocked run and exposes the blockers', () => {
      renderPanel({
        lastRun: makeLastRun({
          outcome: 'goal_blocked',
          goalName: 'Ship v1',
          blockers: ['Sub-goal "Docs" not achieved', 'Requirement REQ-01 not verified'],
          failed: 1,
        }),
      });
      const summary = screen.getByTestId('conductor-last-run');
      expect(summary.textContent).toContain('blocked');
      expect(summary.textContent).toContain('2 blockers');
      expect(summary.textContent).toContain('1 failed');
      expect(summary.getAttribute('title')).toContain('Sub-goal "Docs" not achieved');
    });

    it('marks a user-initiated stop as such', () => {
      renderPanel({ lastRun: makeLastRun({ outcome: 'user_stopped', completed: 1 }) });
      expect(screen.getByTestId('conductor-last-run').textContent).toContain('stopped by you');
    });

    it('hides the summary while a new run is working', () => {
      renderPanel({ running: true, lastRun: makeLastRun() });
      expect(screen.queryByTestId('conductor-last-run')).not.toBeInTheDocument();
    });
  });

  describe('formatRunDuration', () => {
    it('formats seconds below a minute', () => {
      expect(formatRunDuration('2026-01-01T10:00:00.000Z', '2026-01-01T10:00:42.000Z')).toBe('42s');
    });

    it('formats minutes below an hour', () => {
      expect(formatRunDuration('2026-01-01T10:00:00.000Z', '2026-01-01T10:12:30.000Z')).toBe('13m');
    });

    it('formats hours with remaining minutes', () => {
      expect(formatRunDuration('2026-01-01T10:00:00.000Z', '2026-01-01T11:04:00.000Z')).toBe(
        '1h 4m'
      );
    });

    it('never goes negative on clock skew', () => {
      expect(formatRunDuration('2026-01-01T10:00:10.000Z', '2026-01-01T10:00:00.000Z')).toBe('0s');
    });
  });

  it('toggles the decision log', () => {
    renderPanel({
      decisions: [
        {
          id: 'd1',
          timestamp: '2026-01-01 00:00:00',
          action: 'spawn',
          detail: 'Launched sonnet agent',
        },
      ],
    });
    fireEvent.click(screen.getByTestId('conductor-log-toggle'));
    expect(screen.getByTestId('conductor-log').textContent).toContain('Launched sonnet agent');
  });
});

describe('ConductorPanel preflight', () => {
  const preflight = {
    ready: 0,
    blocked: 0,
    needsApproval: 0,
    inProgress: 0,
    inReview: 0,
    exhausted: 0,
  };

  it('says what a run would pick up before it starts', () => {
    renderPanel({ preflight: { ...preflight, ready: 3 } });
    expect(screen.getByTestId('conductor-preflight')).toHaveTextContent('3 ready');
  });

  it('names the work that is held back', () => {
    renderPanel({
      preflight: { ...preflight, ready: 1, blocked: 4, needsApproval: 2, exhausted: 1 },
    });
    const readout = screen.getByTestId('conductor-preflight');
    expect(readout).toHaveTextContent('1 ready');
    expect(readout).toHaveTextContent('4 blocked');
    expect(readout).toHaveTextContent('2 need approval');
    expect(readout).toHaveTextContent('1 out of attempts');
  });

  it('omits categories that are empty', () => {
    renderPanel({ preflight: { ...preflight, ready: 2 } });
    const readout = screen.getByTestId('conductor-preflight');
    expect(readout).not.toHaveTextContent('blocked');
    expect(readout).not.toHaveTextContent('approval');
  });

  it('says a scoped run with no work left will verify the goal', () => {
    renderPanel({ preflight, selectedGoalName: 'Ship v1' });
    expect(screen.getByTestId('conductor-preflight')).toHaveTextContent(
      'nothing to work — will verify the goal'
    );
  });

  it('says an unscoped run with no work left has nothing to do', () => {
    renderPanel({ preflight });
    expect(screen.getByTestId('conductor-preflight')).toHaveTextContent('no open tickets');
  });

  it('stays a single truncating line with the full sentence in the tooltip', () => {
    // Squeezed by the bar, the readout must shorten with an ellipsis — a
    // one-word-per-line column reads as a broken layout, not as information.
    renderPanel({ preflight });
    const readout = screen.getByTestId('conductor-preflight');
    expect(readout.className).toContain('truncate');
    expect(readout).toHaveAttribute('title', expect.stringContaining('no open tickets'));
  });

  it('hides the readout while the conductor is running', () => {
    renderPanel({ running: true, preflight: { ...preflight, ready: 3 } });
    expect(screen.queryByTestId('conductor-preflight')).not.toBeInTheDocument();
  });

  it('hides the readout when no project is open', () => {
    renderPanel({ canStart: false, preflight: { ...preflight, ready: 3 } });
    expect(screen.queryByTestId('conductor-preflight')).not.toBeInTheDocument();
  });

  it('renders without a preflight prop', () => {
    renderPanel();
    expect(screen.queryByTestId('conductor-preflight')).not.toBeInTheDocument();
  });

  describe('judge review toggle', () => {
    it('is disabled when no judge model is configured', () => {
      renderPanel({ judgeConfigured: false });
      expect(screen.getByTestId('conductor-require-review')).toBeDisabled();
    });

    it('toggles review on via the setter when a judge model is configured', () => {
      const props = renderPanel({ judgeConfigured: true, requireReview: false });
      fireEvent.click(screen.getByTestId('conductor-require-review'));
      expect(props.onSetRequireReview).toHaveBeenCalledWith(true);
    });

    it('shows the judge form picker only when review is on', () => {
      renderPanel({ requireReview: false, judgeConfigured: true });
      expect(screen.queryByTestId('conductor-judge-form')).not.toBeInTheDocument();
      renderPanel({ requireReview: true, judgeConfigured: true });
      expect(screen.getByTestId('conductor-judge-form')).toBeInTheDocument();
    });
  });
});
