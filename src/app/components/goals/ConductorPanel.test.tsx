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
    onStart: vi.fn(),
    onStop: vi.fn(),
    onSetMaxConcurrent: vi.fn(),
    onApprove: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<ConductorPanel {...props} />);
  return props;
}

describe('ConductorPanel', () => {
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
