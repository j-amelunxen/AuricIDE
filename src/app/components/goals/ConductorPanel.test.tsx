import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConductorPanel } from './ConductorPanel';
import type { PmTicket } from '@/lib/tauri/pm';

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
    canStart: true,
    providers: [],
    providerId: null,
    model: null,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onSetMaxConcurrent: vi.fn(),
    onSetProvider: vi.fn(),
    onSetModel: vi.fn(),
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
