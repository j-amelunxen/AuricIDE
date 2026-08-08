import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { CompactAgentRow } from './CompactAgentRow';

vi.mock('@/lib/hooks/useNow', () => ({ useNow: () => Date.now() }));

const agent: AgentInfo = {
  id: 'agent-1',
  name: 'Writer',
  model: 'claude-opus-4-6',
  provider: 'claude',
  status: 'running',
  currentTask: 'Writing documentation',
  startedAt: 1000,
};

const parkedProps = {
  activateLabel: 'Restore',
  dismissLabel: 'Terminate',
  dismissIcon: 'power_settings_new',
};

function renderRow(overrides: Partial<AgentInfo> = {}, handlers = {}) {
  return render(
    <CompactAgentRow
      agent={{ ...agent, ...overrides }}
      {...parkedProps}
      onActivate={vi.fn()}
      onDismiss={vi.fn()}
      {...handlers}
    />
  );
}

describe('CompactAgentRow – error digest', () => {
  it('states why a failed agent died, right on the row', () => {
    // Finding out what went wrong must cost a glance, not opening a terminal.
    useStore.setState({
      agentLogs: { 'agent-1': ['Compiling...\n', 'error: cannot find module "fleet"\n'] },
    });
    renderRow({ status: 'error' });
    expect(screen.getByTestId('agent-error-digest')).toHaveTextContent(
      'error: cannot find module "fleet"'
    );
    useStore.setState({ agentLogs: {} });
  });

  it('shows no digest while the agent is still running', () => {
    useStore.setState({
      agentLogs: { 'agent-1': ['error: transient, retrying\n'] },
    });
    renderRow({ status: 'running' });
    expect(screen.queryByTestId('agent-error-digest')).not.toBeInTheDocument();
    useStore.setState({ agentLogs: {} });
  });

  it('stays quiet when a failed agent left no output', () => {
    renderRow({ status: 'error' });
    expect(screen.queryByTestId('agent-error-digest')).not.toBeInTheDocument();
  });
});

describe('CompactAgentRow', () => {
  it('names the agent and activates it on click', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    renderRow({}, { onActivate });

    await user.click(screen.getByRole('button', { name: 'Restore Writer' }));
    expect(onActivate).toHaveBeenCalledWith('agent-1');
  });

  it('takes its wording from the caller, so one row serves both lists', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <CompactAgentRow
        agent={{ ...agent, status: 'idle' }}
        activateLabel="Open logs of"
        dismissLabel="Dismiss"
        dismissIcon="close"
        onActivate={onActivate}
        onDismiss={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Open logs of Writer' }));
    expect(onActivate).toHaveBeenCalledWith('agent-1');
    expect(screen.getByRole('button', { name: 'Dismiss Writer' })).toBeInTheDocument();
  });

  it('keeps the task reachable as a tooltip without spending a line on it', () => {
    renderRow();
    expect(screen.getByRole('button', { name: 'Restore Writer' })).toHaveAttribute(
      'title',
      'Writer — Writing documentation'
    );
  });

  it('prefers what the agent is doing over what it was asked to do', () => {
    renderRow({ currentActivity: 'Editing setup.ts' });
    expect(screen.getByRole('button', { name: 'Restore Writer' })).toHaveAttribute(
      'title',
      'Writer — Editing setup.ts'
    );
  });

  it('dismisses without activating first', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    renderRow({}, { onDismiss });

    await user.click(screen.getByRole('button', { name: 'Terminate Writer' }));
    expect(onDismiss).toHaveBeenCalledWith('agent-1');
  });

  it('says how old the agent is without spending a line on it', () => {
    renderRow({ startedAt: Date.now() - 8 * 60_000 });
    expect(screen.getByTestId('compact-agent-age')).toHaveTextContent('8m');
  });

  it('still shows liveness while folded away', () => {
    const { container } = renderRow({ lastActivityAt: Date.now() });
    expect(container.querySelector('.bg-primary')).toBeInTheDocument();
  });

  it('marks a failed agent apart from a working one', () => {
    const { container } = renderRow({ status: 'error' });
    expect(container.querySelector('.bg-red-400')).toBeInTheDocument();
  });

  it('hides decorative glyphs from assistive technology', () => {
    const { container } = renderRow();
    const decorations = container.querySelectorAll('[aria-hidden="true"]');
    expect(decorations.length).toBeGreaterThan(0);
  });
});
