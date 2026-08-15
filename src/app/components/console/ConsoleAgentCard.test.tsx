import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { AgentEvent } from '@/lib/agents/events/types';
import { useStore } from '@/lib/store';
import { ConsoleAgentCard } from './ConsoleAgentCard';

vi.mock('@/lib/tauri/agents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tauri/agents')>('@/lib/tauri/agents');
  return { ...actual, sendToAgent: vi.fn(async () => undefined) };
});

afterEach(() => {
  useStore.setState({ agentLogs: {} } as Partial<ReturnType<typeof useStore.getState>>);
});

const NOW = Date.now();

function agent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    name: 'Waitlist in lead magnet',
    status: 'running',
    model: 'opus',
    provider: 'claude',
    currentTask: 'Surface the waitlist in the lead magnet UI',
    startedAt: NOW - 60_000,
    lastActivityAt: NOW - 500,
    ...overrides,
  };
}

function baseProps(overrides: Partial<React.ComponentProps<typeof ConsoleAgentCard>> = {}) {
  return {
    agent: agent(),
    events: [] as AgentEvent[],
    heartbeat: new Array(24).fill(0),
    reviewed: false,
    onOpenTerminal: vi.fn(),
    ...overrides,
  };
}

describe('ConsoleAgentCard phase labels', () => {
  it('shows Running for an ordinary working agent', () => {
    render(<ConsoleAgentCard {...baseProps()} />);
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('Running');
  });

  it('shows Waiting on you for an agent awaiting input', () => {
    render(<ConsoleAgentCard {...baseProps({ agent: agent({ awaitingInput: true }) })} />);
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('Waiting on you');
  });

  it('shows Possibly stalled for a silent running agent', () => {
    render(
      <ConsoleAgentCard {...baseProps({ agent: agent({ lastActivityAt: NOW - 130_000 }) })} />
    );
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('Possibly stalled');
  });

  it('shows Done, unreviewed for a finished, unreviewed agent', () => {
    render(
      <ConsoleAgentCard {...baseProps({ agent: agent({ status: 'idle' }), reviewed: false })} />
    );
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('Done, unreviewed');
  });

  it('shows plain Done once reviewed', () => {
    render(
      <ConsoleAgentCard {...baseProps({ agent: agent({ status: 'idle' }), reviewed: true })} />
    );
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('Done');
  });

  it('shows Failed for an errored agent', () => {
    render(<ConsoleAgentCard {...baseProps({ agent: agent({ status: 'error' }) })} />);
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('Failed');
  });
});

describe('ConsoleAgentCard actions', () => {
  it('always offers Open terminal and calls back with the agent id', async () => {
    const user = userEvent.setup();
    const onOpenTerminal = vi.fn();
    render(<ConsoleAgentCard {...baseProps({ onOpenTerminal })} />);

    await user.click(screen.getByRole('button', { name: 'Open terminal' }));
    expect(onOpenTerminal).toHaveBeenCalledWith('agent-1');
  });

  it('asks for confirmation before stopping a running agent', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<ConsoleAgentCard {...baseProps({ onStop })} />);

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/stop/i);
    await user.click(within(dialog).getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledWith('agent-1');
  });

  it('never calls onStop when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<ConsoleAgentCard {...baseProps({ onStop })} />);

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(onStop).not.toHaveBeenCalled();
  });

  it('offers Retry only for a failed agent, calling back with its id', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ConsoleAgentCard {...baseProps({ agent: agent({ status: 'error' }), onRetry })} />);

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('agent-1');
  });

  it('does not offer Retry for a running agent', () => {
    render(<ConsoleAgentCard {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('offers Mark reviewed only for an unreviewed finish, calling back with its id', async () => {
    const user = userEvent.setup();
    const onMarkReviewed = vi.fn();
    render(
      <ConsoleAgentCard
        {...baseProps({ agent: agent({ status: 'idle' }), reviewed: false, onMarkReviewed })}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    expect(onMarkReviewed).toHaveBeenCalledWith('agent-1');
  });

  it('does not offer Mark reviewed once reviewed', () => {
    render(
      <ConsoleAgentCard {...baseProps({ agent: agent({ status: 'idle' }), reviewed: true })} />
    );
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument();
  });

  it('offers Dismiss for a finished agent without asking for confirmation', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<ConsoleAgentCard {...baseProps({ agent: agent({ status: 'idle' }), onDismiss })} />);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledWith('agent-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not offer Dismiss or Stop for a still-running agent without a dismiss handler', () => {
    render(<ConsoleAgentCard {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });
});

describe('ConsoleAgentCard footprint', () => {
  it('reads "No files changed yet" with no edits', () => {
    render(<ConsoleAgentCard {...baseProps({ events: [] })} />);
    expect(screen.getByText('No files changed yet')).toBeInTheDocument();
  });

  it('reads singular for exactly one changed file', () => {
    const events: AgentEvent[] = [
      { kind: 'edit', label: 'Edited src/a.ts', path: 'src/a.ts', at: NOW },
    ];
    render(<ConsoleAgentCard {...baseProps({ events })} />);
    expect(screen.getByText('1 file changed')).toBeInTheDocument();
  });

  it('reads plural for several changed files', () => {
    const events: AgentEvent[] = [
      { kind: 'edit', label: 'Edited src/a.ts', path: 'src/a.ts', at: NOW },
      { kind: 'edit', label: 'Edited src/b.ts', path: 'src/b.ts', at: NOW },
    ];
    render(<ConsoleAgentCard {...baseProps({ events })} />);
    expect(screen.getByText('2 files changed')).toBeInTheDocument();
  });
});

describe('ConsoleAgentCard focus', () => {
  it('offers Focus before Open terminal when a handler is given', () => {
    render(<ConsoleAgentCard {...baseProps({ onFocus: vi.fn() })} />);
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons.indexOf('Focus')).toBeLessThan(buttons.indexOf('Open terminal'));
  });

  it('does not offer Focus without a handler', () => {
    render(<ConsoleAgentCard {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'Focus' })).not.toBeInTheDocument();
  });

  it('calls onFocus with the agent id', async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    render(<ConsoleAgentCard {...baseProps({ onFocus })} />);
    await user.click(screen.getByRole('button', { name: 'Focus' }));
    expect(onFocus).toHaveBeenCalledWith('agent-1');
  });
});

describe('ConsoleAgentCard inline permission answers', () => {
  function waitingAgent(overrides: Partial<AgentInfo> = {}) {
    return agent({ awaitingInput: true, ...overrides });
  }

  it('renders no answer buttons for an agent that is not waiting on you', () => {
    useStore.setState({
      agentLogs: { 'agent-1': ['❯ 1. Yes\n  2. No\n'] },
    } as Partial<ReturnType<typeof useStore.getState>>);
    render(<ConsoleAgentCard {...baseProps()} />);
    expect(screen.queryByTestId('prompt-tail')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^1 / })).not.toBeInTheDocument();
  });

  it('shows the prompt tail and derived buttons for a Claude-style menu', () => {
    useStore.setState({
      agentLogs: {
        'agent-1': ["Do you want to proceed?\n❯ 1. Yes\n  2. Yes, and don't ask again\n  3. No\n"],
      },
    } as Partial<ReturnType<typeof useStore.getState>>);
    render(<ConsoleAgentCard {...baseProps({ agent: waitingAgent() })} />);

    expect(screen.getByTestId('prompt-tail')).toHaveTextContent('Do you want to proceed?');
    expect(screen.getByRole('button', { name: '1 Yes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^3 No$/ })).toBeInTheDocument();
  });

  it('sends the option number followed by a newline when a menu button is clicked', async () => {
    const user = userEvent.setup();
    useStore.setState({
      agentLogs: { 'agent-1': ['Do you want to proceed?\n❯ 1. Yes\n  2. No\n'] },
    } as Partial<ReturnType<typeof useStore.getState>>);
    render(<ConsoleAgentCard {...baseProps({ agent: waitingAgent() })} />);

    const { sendToAgent } = await import('@/lib/tauri/agents');
    await user.click(screen.getByRole('button', { name: '1 Yes' }));

    expect(sendToAgent).toHaveBeenCalledWith('agent-1', '1\n');
  });

  it('shows a Sent toast after answering', async () => {
    const user = userEvent.setup();
    useStore.setState({
      agentLogs: { 'agent-1': ['Do you want to proceed?\n❯ 1. Yes\n  2. No\n'] },
    } as Partial<ReturnType<typeof useStore.getState>>);
    render(<ConsoleAgentCard {...baseProps({ agent: waitingAgent() })} />);

    await user.click(screen.getByRole('button', { name: '1 Yes' }));

    expect(useStore.getState().toasts.at(-1)?.message).toBe(`Sent to ${agent().name}`);
  });

  it('sends free text followed by a newline on Enter and clears the field', async () => {
    const user = userEvent.setup();
    useStore.setState({
      agentLogs: { 'agent-1': ['Some ordinary output with no menu\n'] },
    } as Partial<ReturnType<typeof useStore.getState>>);
    render(<ConsoleAgentCard {...baseProps({ agent: waitingAgent() })} />);

    const { sendToAgent } = await import('@/lib/tauri/agents');
    const input = screen.getByPlaceholderText('Or send an instruction');
    await user.type(input, 'run the tests{Enter}');

    expect(sendToAgent).toHaveBeenCalledWith('agent-1', 'run the tests\n');
    expect(input).toHaveValue('');
  });

  it('shows Send Enter for a stalled agent and sends a bare newline', async () => {
    const user = userEvent.setup();
    render(
      <ConsoleAgentCard {...baseProps({ agent: agent({ lastActivityAt: NOW - 130_000 }) })} />
    );

    const { sendToAgent } = await import('@/lib/tauri/agents');
    await user.click(screen.getByRole('button', { name: 'Send Enter' }));

    expect(sendToAgent).toHaveBeenCalledWith('agent-1', '\n');
  });

  it('offers no Send Enter button for a running, non-stalled agent', () => {
    render(<ConsoleAgentCard {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'Send Enter' })).not.toBeInTheDocument();
  });
});
