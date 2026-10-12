import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentWindowPage from './page';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';

const uninstall = vi.fn();
const installAgentWindowClient = vi.fn(() => uninstall);
const sendAgentWindowAction = vi.fn(async (_action: unknown) => {});
const closeWindow = vi.fn(async () => {});

vi.mock('@/lib/agents/agentWindowClient', () => ({
  installAgentWindowClient: () => installAgentWindowClient(),
  sendAgentWindowAction: (action: unknown) => sendAgentWindowAction(action),
}));
vi.mock('@/lib/tauri/agentWindow', () => ({}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ close: closeWindow }),
}));
vi.mock('../components/agents/AgentXterm', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    AgentXterm: forwardRef(function AgentXterm({ agentId }: { agentId: string }, ref) {
      useImperativeHandle(ref, () => ({
        visibleText: () => `screen of ${agentId}`,
        focus: () => {},
      }));
      return <div data-testid={`xterm-${agentId}`} />;
    }),
  };
});

const running: AgentInfo = {
  id: 'a',
  name: 'Alpha',
  model: 'model',
  provider: 'claude',
  status: 'running',
  startedAt: 1000,
  lastActivityAt: Date.now(),
};
const failed: AgentInfo = { ...running, id: 'b', name: 'Beta', status: 'error' };

describe('the agent window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      agents: [running, failed],
      agentWindowActiveAgentId: 'a',
      agentWindowErrorDigests: { b: 'error: build failed' },
      terminalGridCells: null,
      toasts: [],
    });
  });
  afterEach(() => {
    useStore.setState({
      agents: [],
      agentWindowActiveAgentId: null,
      agentWindowErrorDigests: {},
      terminalGridCells: null,
      toasts: [],
      overlayStack: { layers: [] },
    });
  });

  it('starts its half of the window protocol once and stops it on unmount', () => {
    const { unmount } = render(<AgentWindowPage />);
    expect(installAgentWindowClient).toHaveBeenCalledOnce();
    unmount();
    expect(uninstall).toHaveBeenCalledOnce();
  });

  it('shows the roster as tabs and the active agent in the terminal', () => {
    render(<AgentWindowPage />);
    expect(screen.getByTestId('agent-tab-a')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('agent-tab-b')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByTestId('xterm-a')).toBeInTheDocument();
    // It is a window, not a dialog — and its own traffic lights close it.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Close')).not.toBeInTheDocument();
  });

  it('switching tabs changes the active agent, and shows why a failed one died', async () => {
    const user = userEvent.setup();
    render(<AgentWindowPage />);
    expect(screen.queryByTestId('terminal-error-digest')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('agent-tab-b'));

    expect(useStore.getState().agentWindowActiveAgentId).toBe('b');
    expect(screen.getByTestId('terminal-error-digest')).toHaveTextContent('error: build failed');
  });

  it('asks here before stopping, then leaves the stopping to the main window', async () => {
    const user = userEvent.setup();
    render(<AgentWindowPage />);

    await user.click(screen.getByTestId('agent-tab-close-a'));

    expect(await screen.findByRole('dialog', { name: 'Stop this agent?' })).toBeInTheDocument();
    expect(sendAgentWindowAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() =>
      expect(sendAgentWindowAction).toHaveBeenCalledWith({ kind: 'kill', agentId: 'a' })
    );
    expect(sendAgentWindowAction).toHaveBeenCalledOnce();
  });

  it('sends nothing when the stop question is cancelled', async () => {
    const user = userEvent.setup();
    render(<AgentWindowPage />);

    await user.click(screen.getByTestId('agent-tab-close-a'));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(sendAgentWindowAction).not.toHaveBeenCalled();
  });

  it('clears a finished agent without asking', async () => {
    const user = userEvent.setup();
    render(<AgentWindowPage />);

    await user.click(screen.getByTestId('agent-tab-close-b'));

    await waitFor(() =>
      expect(sendAgentWindowAction).toHaveBeenCalledWith({ kind: 'dismiss', agentId: 'b' })
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('reads the screen here and has the main window save it, with no verdict of its own', async () => {
    const user = userEvent.setup();
    render(<AgentWindowPage />);

    await user.click(screen.getByTestId('agent-tab-capture-a'));

    await waitFor(() =>
      expect(sendAgentWindowAction).toHaveBeenCalledWith({
        kind: 'save-scratch',
        agentName: 'Alpha',
        screen: 'screen of a',
      })
    );
    expect(useStore.getState().toasts).toEqual([]);
  });

  it('docks back with the agent on show and the layout, then closes itself', async () => {
    const user = userEvent.setup();
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    const order: string[] = [];
    sendAgentWindowAction.mockImplementation(async () => {
      order.push('dock');
    });
    closeWindow.mockImplementation(async () => {
      order.push('close');
    });
    render(<AgentWindowPage />);

    await user.click(screen.getByRole('button', { name: 'Back to main window' }));

    await waitFor(() => expect(closeWindow).toHaveBeenCalledOnce());
    expect(sendAgentWindowAction).toHaveBeenCalledWith({
      kind: 'dock',
      activeAgentId: 'a',
      gridCells: ['a', 'b', 'a', 'b'],
    });
    expect(order).toEqual(['dock', 'close']);
  });

  it('says where to start an agent when there is none, and can still dock', () => {
    useStore.setState({ agents: [], agentWindowActiveAgentId: null });
    render(<AgentWindowPage />);

    expect(screen.getByText('No agents here. Start one in the main window.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to main window' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  // Through the store's own roster path, as the window protocol does it —
  // setting the active agent by hand here once hid that nothing else did.
  it('shows the first agent that arrives in a window opened with none', () => {
    useStore.setState({ agents: [], agentWindowActiveAgentId: null });
    render(<AgentWindowPage />);
    expect(screen.getByText('No agents here. Start one in the main window.')).toBeInTheDocument();

    act(() => useStore.getState().applyAgentRoster({ agents: [running], errorDigests: {} }));

    expect(screen.getByTestId('xterm-a')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(
      screen.queryByText('No agents here. Start one in the main window.')
    ).not.toBeInTheDocument();
  });

  it('moves on when the roster drops the agent on show, and empties with it', () => {
    render(<AgentWindowPage />);

    act(() => useStore.getState().applyAgentRoster({ agents: [failed], errorDigests: {} }));
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument();

    act(() => useStore.getState().applyAgentRoster({ agents: [], errorDigests: {} }));
    expect(screen.getByText('No agents here. Start one in the main window.')).toBeInTheDocument();
  });

  it('makes the header the title bar: draggable, clear of the traffic lights', () => {
    render(<AgentWindowPage />);
    const header = screen
      .getByRole('heading', { name: 'Alpha' })
      .closest('[data-tauri-drag-region]');
    expect(header).toHaveClass('pl-[calc(1.25rem+var(--titlebar-gutter,0px))]');
  });
});
