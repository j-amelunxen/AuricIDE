import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { FocusView } from './FocusView';

vi.mock('@/lib/tauri/agents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tauri/agents')>('@/lib/tauri/agents');
  return { ...actual, sendToAgent: vi.fn(async () => undefined) };
});

// The embedded terminal is XtermTerminal itself (the same primitive
// TerminalPanel mounts) — stub it here so this test stays about FocusView's
// own layout and wiring, not xterm's DOM.
vi.mock('@/app/components/terminal/XtermTerminal', () => ({
  XtermTerminal: ({ agentId }: { agentId?: string }) => (
    <div data-testid="stage-terminal">{agentId}</div>
  ),
}));

const NOW = Date.now();

function agent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-focused',
    name: 'Waitlist in lead magnet',
    status: 'running',
    model: 'opus',
    provider: 'claude',
    repoPath: '/repos/kaenguru',
    startedAt: NOW - 60_000,
    lastActivityAt: NOW - 500,
    ...overrides,
  };
}

afterEach(() => {
  useStore.setState({ agentLogs: {} } as Partial<ReturnType<typeof useStore.getState>>);
});

function baseProps(overrides: Partial<React.ComponentProps<typeof FocusView>> = {}) {
  return {
    agent: agent(),
    otherAgents: [] as AgentInfo[],
    reviewedAgentIds: [] as string[],
    agentEvents: {},
    agentHeartbeat: {},
    onBack: vi.fn(),
    onFocus: vi.fn(),
    ...overrides,
  };
}

describe('FocusView layout', () => {
  it('shows the back button and a project / agent breadcrumb', () => {
    render(<FocusView {...baseProps()} />);
    expect(screen.getByRole('button', { name: '← Projects' })).toBeInTheDocument();
    expect(screen.getByTestId('focus-crumb')).toHaveTextContent('kaenguru');
    expect(screen.getByTestId('focus-crumb')).toHaveTextContent('Waitlist in lead magnet');
    expect(screen.getByTestId('focus-crumb')).toHaveTextContent('opus');
  });

  it('calls onBack when the back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<FocusView {...baseProps({ onBack })} />);
    await user.click(screen.getByRole('button', { name: '← Projects' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('mounts the real agent terminal for the focused agent', () => {
    render(<FocusView {...baseProps()} />);
    expect(screen.getByTestId('stage-terminal')).toHaveTextContent('agent-focused');
  });

  it('sends the stage input followed by a newline on Enter and clears it', async () => {
    const user = userEvent.setup();
    render(<FocusView {...baseProps()} />);

    const { sendToAgent } = await import('@/lib/tauri/agents');
    const input = screen.getByPlaceholderText('Send instruction to this agent · Enter to send');
    await user.type(input, 'run the tests{Enter}');

    expect(sendToAgent).toHaveBeenCalledWith('agent-focused', 'run the tests\n');
    expect(input).toHaveValue('');
  });
});

describe('FocusView other agents rail', () => {
  it('lists every other agent as a thumbnail, sorted waiting-on-you first', () => {
    const otherAgents: AgentInfo[] = [
      agent({ id: 'calm', name: 'Calm one', status: 'running', awaitingInput: false }),
      agent({ id: 'urgent', name: 'Urgent one', status: 'running', awaitingInput: true }),
    ];
    render(<FocusView {...baseProps({ otherAgents })} />);

    const names = screen.getAllByTestId(/^focus-thumb-/).map((el) => el.textContent);
    expect(names[0]).toContain('Urgent one');
    expect(names[1]).toContain('Calm one');
  });

  it('switches focus when a thumbnail is clicked', async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    const otherAgents: AgentInfo[] = [agent({ id: 'other-1', name: 'Other agent' })];
    render(<FocusView {...baseProps({ otherAgents, onFocus })} />);

    await user.click(screen.getByTestId('focus-thumb-other-1'));
    expect(onFocus).toHaveBeenCalledWith('other-1');
  });

  it('shows nothing in the rail when there are no other agents', () => {
    render(<FocusView {...baseProps({ otherAgents: [] })} />);
    expect(screen.queryByTestId(/^focus-thumb-/)).not.toBeInTheDocument();
  });
});
