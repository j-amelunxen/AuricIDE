import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ConductorPanel, formatRunDuration } from './ConductorPanel';
import type { PmTicket } from '@/lib/tauri/pm';
import type { ConductorRunSummary } from '@/lib/store/conductorSlice';
import type { ProviderInfo } from '@/lib/tauri/providers';

function makeLastRun(overrides: Partial<ConductorRunSummary> = {}): ConductorRunSummary {
  return {
    outcome: 'finished',
    goalName: null,
    completed: 3,
    failed: 0,
    blockers: [],
    startedAt: '2026-01-01T10:00:00.000Z',
    endedAt: '2026-01-01T10:12:00.000Z',
    ticketBudget: null,
    spawned: 0,
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
    runningAgentCount: 0,
    pendingApprovals: [] as PmTicket[],
    decisions: [],
    lastRun: null as ConductorRunSummary | null,
    canStart: true,
    providers: [],
    providerId: null,
    model: null,
    requireReview: false,
    judgeForm: 'llm' as 'llm' | 'agent',
    judgeProviderId: null as string | null,
    judgeModel: null as string | null,
    judgeLlmModel: 'judge-model' as string | null,
    judgeConfigured: true,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onSetMaxConcurrent: vi.fn(),
    onSetProvider: vi.fn(),
    onSetModel: vi.fn(),
    onSetRequireReview: vi.fn(),
    onSetJudgeForm: vi.fn(),
    onSetJudgeProvider: vi.fn(),
    onSetJudgeModel: vi.fn(),
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

    it('reports a spent budget by how many tickets it started', () => {
      renderPanel({
        lastRun: makeLastRun({
          outcome: 'budget_reached',
          completed: 2,
          ticketBudget: 5,
          spawned: 5,
        }),
      });
      const summary = screen.getByTestId('conductor-last-run');
      expect(summary.textContent).toContain('budget reached');
      expect(summary.textContent).toContain('5 of 5 tickets started');
    });

    it('shows the "N of M tickets started" readout only when a budget was set', () => {
      renderPanel({ lastRun: makeLastRun() });
      expect(screen.getByTestId('conductor-last-run').textContent).not.toContain('tickets started');
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

  describe('stopping a run with agents in flight', () => {
    it('asks before killing anything', async () => {
      const props = renderPanel({ running: true, runningAgentCount: 3 });
      fireEvent.click(screen.getByTestId('conductor-stop-btn'));

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent('Stop 3 running agents?');
      expect(dialog).toHaveTextContent('Their work in progress is lost.');
      // The question is the gate: nothing dies until it is answered.
      expect(props.onStop).not.toHaveBeenCalled();
    });

    it('stops once the user confirms', async () => {
      const props = renderPanel({ running: true, runningAgentCount: 2 });
      fireEvent.click(screen.getByTestId('conductor-stop-btn'));

      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }));
      await waitFor(() => expect(props.onStop).toHaveBeenCalledTimes(1));
    });

    it('leaves the run alone when the user cancels', async () => {
      const props = renderPanel({ running: true, runningAgentCount: 2 });
      fireEvent.click(screen.getByTestId('conductor-stop-btn'));

      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(props.onStop).not.toHaveBeenCalled();
    });

    it('counts a single agent in the singular', async () => {
      renderPanel({ running: true, runningAgentCount: 1 });
      fireEvent.click(screen.getByTestId('conductor-stop-btn'));
      expect(await screen.findByRole('dialog')).toHaveTextContent('Stop 1 running agent?');
    });

    it('stops without a question when nothing is running', async () => {
      // Nothing to lose — a prompt here would be friction, not a safeguard.
      const props = renderPanel({ running: true, runningAgentCount: 0 });
      fireEvent.click(screen.getByTestId('conductor-stop-btn'));
      await waitFor(() => expect(props.onStop).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    total: 0,
    done: 0,
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

  it('says a scoped goal with no tickets needs work first', () => {
    renderPanel({ preflight, selectedGoalName: 'Ship v1' });
    expect(screen.getByTestId('conductor-preflight')).toHaveTextContent(
      'No tickets yet - create work first'
    );
  });

  it('checks open conditions when every scoped ticket is complete', () => {
    renderPanel({ preflight: { ...preflight, total: 3, done: 3 }, selectedGoalName: 'Ship v1' });
    expect(screen.getByTestId('conductor-preflight')).toHaveTextContent(
      'All tickets complete - checking open conditions'
    );
  });

  it('disables Start with an accessible reason when there are no tickets', () => {
    renderPanel({
      preflight,
      canStart: false,
      startDisabledReason: 'No tickets yet - create work first',
    });
    expect(screen.getByTestId('conductor-start-btn')).toBeDisabled();
    expect(screen.getByTestId('conductor-start-btn')).toHaveAttribute(
      'title',
      expect.stringMatching(/create work first/i)
    );
  });

  it('announces changing preflight information politely', () => {
    renderPanel({ preflight: { ...preflight, total: 1, ready: 1 } });
    expect(screen.getByTestId('conductor-preflight')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('conductor-preflight')).toHaveAttribute('aria-live', 'polite');
  });

  it('includes reviews in held work', () => {
    renderPanel({ preflight: { ...preflight, total: 1, inReview: 1 } });
    expect(screen.getByTestId('conductor-preflight')).toHaveTextContent('1 in review');
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
    const providers = [
      {
        id: 'claude',
        name: 'Claude Code',
        models: [{ value: 'sonnet', label: 'Sonnet' }],
        permissionModes: [],
        defaultModel: 'sonnet',
        defaultPermissionMode: 'default',
      },
      {
        id: 'codex',
        name: 'Codex',
        models: [{ value: 'gpt', label: 'GPT' }],
        permissionModes: [],
        defaultModel: 'gpt',
        defaultPermissionMode: 'default',
      },
    ] satisfies ProviderInfo[];

    it('is disabled only when there is no judge at all — no key and no CLI', () => {
      renderPanel({ judgeConfigured: false, providers: [] });
      expect(screen.getByTestId('conductor-require-review')).toBeDisabled();
    });

    // The switch used to hang off the judge API key alone, which locked out
    // the one form that never needed it. A review agent is a CLI like any
    // other; if there is one, review is reachable.
    it('stays reachable with no judge key as long as an agent CLI can review', () => {
      renderPanel({ judgeConfigured: false, providers });
      expect(screen.getByTestId('conductor-require-review')).not.toBeDisabled();
    });

    it('turns review on in the form that can actually run when there is no key', () => {
      const props = renderPanel({ judgeConfigured: false, providers, requireReview: false });
      fireEvent.click(screen.getByTestId('conductor-require-review'));
      expect(props.onSetJudgeForm).toHaveBeenCalledWith('agent');
      expect(props.onSetRequireReview).toHaveBeenCalledWith(true);
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

    it('offers no inline-LLM form without a key, and does not claim it is in effect', () => {
      renderPanel({ requireReview: true, judgeConfigured: false, providers, judgeForm: 'llm' });
      const picker = screen.getByTestId('conductor-judge-form') as HTMLSelectElement;
      // A stored 'llm' that cannot run must not be shown as the live setting —
      // the panel would be naming a judge that is not the one about to review.
      expect(picker.value).toBe('agent');
      expect(screen.getByRole('option', { name: /LLM call/ })).toBeDisabled();
    });

    describe('which harness reviews', () => {
      it('offers a judge provider and model for a spawned reviewer', () => {
        const props = renderPanel({
          requireReview: true,
          judgeConfigured: true,
          judgeForm: 'agent',
          providers,
        });

        fireEvent.change(screen.getByTestId('conductor-judge-provider'), {
          target: { value: 'codex' },
        });
        expect(props.onSetJudgeProvider).toHaveBeenCalledWith('codex');
      });

      it('lists the models of the judge’s provider, not the conductor’s', () => {
        renderPanel({
          requireReview: true,
          judgeConfigured: true,
          judgeForm: 'agent',
          providers,
          providerId: 'claude',
          judgeProviderId: 'codex',
        });

        const judgeModels = within(screen.getByTestId('conductor-judge-model'));
        expect(judgeModels.getByRole('option', { name: 'GPT' })).toBeInTheDocument();
        // The conductor's own picker still offers Sonnet; the judge's must not.
        expect(judgeModels.queryByRole('option', { name: 'Sonnet' })).not.toBeInTheDocument();
      });

      it('reads an unset judge harness as the conductor’s, not as nothing', () => {
        renderPanel({
          requireReview: true,
          judgeConfigured: true,
          judgeForm: 'agent',
          providers,
          judgeProviderId: null,
        });

        expect(screen.getAllByRole('option', { name: 'Same as conductor' })).toHaveLength(2);
      });

      it('names the model the inline judge would call instead of offering a picker', () => {
        renderPanel({
          requireReview: true,
          judgeConfigured: true,
          judgeForm: 'llm',
          providers,
          judgeLlmModel: 'devstral-medium-latest',
        });

        expect(screen.getByTestId('conductor-judge-llm-model')).toHaveTextContent(
          'devstral-medium-latest'
        );
        expect(screen.queryByTestId('conductor-judge-provider')).not.toBeInTheDocument();
      });
    });
  });

  describe('layout', () => {
    const providers = [
      {
        id: 'claude',
        name: 'Claude Code',
        models: [{ value: 'sonnet', label: 'Sonnet' }],
        permissionModes: [],
        defaultModel: 'sonnet',
        defaultPermissionMode: 'acceptEdits',
      },
    ];

    // The panel is embedded at very different widths — full modal width in
    // GoalsModal, a 768px card on the cockpit. Settings and the run controls
    // therefore never share a row: five selects competing with Start is what
    // pushes the button off the edge of the narrow surface.
    it('keeps the settings on their own row, away from status and Start', () => {
      renderPanel({ providers, requireReview: true, judgeConfigured: true });
      const settings = screen.getByTestId('conductor-settings');

      expect(settings).toContainElement(screen.getByTestId('conductor-max-concurrent'));
      expect(settings).toContainElement(screen.getByTestId('conductor-provider-select'));
      expect(settings).toContainElement(screen.getByTestId('conductor-model-select'));
      expect(settings).toContainElement(screen.getByTestId('conductor-require-review'));
      expect(settings).toContainElement(screen.getByTestId('conductor-judge-form'));

      expect(settings).not.toContainElement(screen.getByTestId('conductor-start-btn'));
      expect(settings).not.toContainElement(screen.getByTestId('conductor-status-dot'));
    });

    it('lets the settings wrap instead of squeezing their controls', () => {
      renderPanel({ providers });
      expect(screen.getByTestId('conductor-settings').className).toContain('flex-wrap');
    });

    it('never shrinks the run controls', () => {
      renderPanel({ providers });
      expect(screen.getByTestId('conductor-actions').className).toContain('flex-shrink-0');
    });
  });
});
