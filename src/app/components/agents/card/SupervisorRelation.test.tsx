import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import { AgentCard } from '../AgentCard';
import { CompactAgentRow } from '../CompactAgentRow';

const agent = (id: string, extra: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  name: id,
  model: 'm',
  provider: 'claude',
  status: 'running',
  startedAt: 0,
  ...extra,
});

const SUPERVISOR = agent('sup', { name: 'Supervisor', role: 'supervisor' });
const CHILD_A = agent('child-a', { spawnedByAgentId: 'sup' });
const CHILD_B = agent('child-b', { spawnedByAgentId: 'sup', status: 'idle', finishedAt: 5 });

describe('supervisor relation on cards and rows', () => {
  beforeEach(() => {
    useStore.setState({ agents: [SUPERVISOR, CHILD_A, CHILD_B], selectedAgentId: null });
  });

  it('marks the supervisor card and counts its children', () => {
    render(<AgentCard agent={SUPERVISOR} onKill={vi.fn()} />);
    expect(screen.getByTestId('agent-supervisor-chip')).toHaveTextContent(
      'Supervisor2 children · 1 running'
    );
  });

  it("names the child's supervisor and selects it on click, not the child", () => {
    const onSelect = vi.fn();
    render(<AgentCard agent={CHILD_A} onKill={vi.fn()} onSelect={onSelect} />);
    const link = screen.getByTestId('agent-supervisor-link');
    expect(link).toHaveTextContent('via Supervisor');
    fireEvent.click(link);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('sup');
  });

  it('keeps saying a supervisor started it after the supervisor is cleared', () => {
    useStore.setState({ agents: [CHILD_A] });
    render(<AgentCard agent={CHILD_A} onKill={vi.fn()} />);
    const link = screen.getByTestId('agent-supervisor-link');
    expect(link).toHaveTextContent('via a supervisor');
    expect(link).toBeDisabled();
  });

  it('shows the link on a compact row and selects through the store', () => {
    render(
      <CompactAgentRow
        agent={CHILD_B}
        activateLabel="Open logs of"
        onActivate={vi.fn()}
        dismissLabel="Dismiss"
        dismissIcon="close"
        onDismiss={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('agent-supervisor-link'));
    expect(useStore.getState().selectedAgentId).toBe('sup');
  });

  it('shows the key a supervisor is addressed by, on its card, a compact row and its child', () => {
    const keyed = { ...SUPERVISOR, supervisorKey: 'mail-triage' };
    useStore.setState({ agents: [keyed, CHILD_A, CHILD_B] });
    const { unmount } = render(<AgentCard agent={keyed} onKill={vi.fn()} />);
    expect(screen.getByTestId('agent-supervisor-key')).toHaveTextContent('· mail-triage');
    unmount();
    render(
      <CompactAgentRow
        agent={keyed}
        activateLabel="Open logs of"
        onActivate={vi.fn()}
        dismissLabel="Dismiss"
        dismissIcon="close"
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByTestId('agent-supervisor-key')).toHaveTextContent('· mail-triage');
    render(<AgentCard agent={CHILD_A} onKill={vi.fn()} />);
    expect(screen.getByTestId('agent-supervisor-link')).toHaveTextContent('via mail-triage');
  });

  it('adds nothing to an ordinary agent', () => {
    render(<AgentCard agent={agent('plain')} onKill={vi.fn()} />);
    expect(screen.queryByTestId('agent-supervisor-chip')).toBeNull();
    expect(screen.queryByTestId('agent-supervisor-link')).toBeNull();
  });
});
