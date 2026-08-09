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

describe('CompactAgentRow – blocked on input', () => {
  it('names the reason instead of a meaningless duration', () => {
    // A permission menu redraws itself, so neither runtime nor quiet time
    // says anything true about a blocked agent — the reason does.
    renderRow({ status: 'running', awaitingInput: true, lastActivityAt: Date.now() });
    expect(screen.getByTestId('compact-agent-age')).toHaveTextContent('needs input');
  });
});

describe('CompactAgentRow – quiet duration on a stalled agent', () => {
  it('says how long a stalled agent has been silent', () => {
    // The cost of ignoring a stalled agent is exactly its silence — the row
    // states it instead of leaving the user to compare clocks.
    vi.useFakeTimers();
    vi.setSystemTime(20 * 60_000);
    try {
      renderRow({ status: 'running', startedAt: 0, lastActivityAt: 10 * 60_000 });
      expect(screen.getByTestId('compact-agent-age')).toHaveTextContent('quiet 10m');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps plain runtime while the silence is still ordinary waiting', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5 * 60_000);
    try {
      renderRow({ status: 'running', startedAt: 0, lastActivityAt: 4 * 60_000 });
      expect(screen.getByTestId('compact-agent-age')).toHaveTextContent(/^5m$/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CompactAgentRow – retry', () => {
  it('offers a retry on a failed agent and reports the click', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderRow({ status: 'error' }, { onRetry });

    await user.click(screen.getByRole('button', { name: 'Retry Writer' }));
    expect(onRetry).toHaveBeenCalledWith('agent-1');
  });

  it('offers no retry on an agent that did not fail', () => {
    renderRow({ status: 'idle' }, { onRetry: vi.fn() });
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('offers no retry when the caller cannot relaunch', () => {
    renderRow({ status: 'error' });
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});

describe('CompactAgentRow – live activity on the row', () => {
  it('shows what a running agent is doing right now', () => {
    // A parked agent is still being supervised — the one-line activity is
    // what lets that happen without restoring the card.
    renderRow({ status: 'running', currentActivity: 'Editing setup.ts' });
    expect(screen.getByTestId('agent-row-activity')).toHaveTextContent('Editing setup.ts');
  });

  it('shows no activity line once the agent stopped', () => {
    // A frozen last line would read as ongoing work.
    renderRow({ status: 'idle', currentActivity: 'Editing setup.ts' });
    expect(screen.queryByTestId('agent-row-activity')).not.toBeInTheDocument();
  });

  it('shows nothing extra while there is no activity to report', () => {
    renderRow({ status: 'running', currentActivity: undefined });
    expect(screen.queryByTestId('agent-row-activity')).not.toBeInTheDocument();
  });
});

describe('CompactAgentRow – age of a finished agent', () => {
  it('says how long ago it finished, not how old it is', () => {
    // For a review list the useful number is recency of the outcome; the
    // start time answers a question nobody is asking anymore.
    vi.useFakeTimers();
    vi.setSystemTime(10 * 60_000);
    try {
      renderRow({ status: 'idle', startedAt: 0, finishedAt: 7 * 60_000 });
      expect(screen.getByTestId('compact-agent-age')).toHaveTextContent('3m ago');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the runtime reachable in the tooltip', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10 * 60_000);
    try {
      renderRow({ status: 'idle', startedAt: 0, finishedAt: 7 * 60_000 });
      expect(screen.getByTestId('compact-agent-age')).toHaveAttribute(
        'title',
        expect.stringContaining('7m')
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows plain runtime for an agent that is still running', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5 * 60_000);
    try {
      renderRow({ status: 'running', startedAt: 0 });
      expect(screen.getByTestId('compact-agent-age')).toHaveTextContent(/^5m$/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CompactAgentRow – unseen marker', () => {
  it('marks a stopped agent whose outcome nobody looked at yet', () => {
    renderRow({ status: 'idle' }, { unseen: true });
    expect(screen.getByTestId('agent-unseen-dot')).toBeInTheDocument();
  });

  it('drops the marker once the outcome was reviewed', () => {
    renderRow({ status: 'idle' }, { unseen: false });
    expect(screen.queryByTestId('agent-unseen-dot')).not.toBeInTheDocument();
  });

  it('tells assistive technology what the dot means', () => {
    renderRow({ status: 'idle' }, { unseen: true });
    expect(screen.getByTestId('agent-unseen-dot')).toHaveAccessibleName(/not.*reviewed/i);
  });
});

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
