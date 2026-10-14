import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { AgentTerminalWorkspace } from './AgentTerminalWorkspace';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';

vi.mock('./AgentXterm', async () => {
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
const finished: AgentInfo = { ...running, id: 'b', name: 'Beta', status: 'idle' };

type WorkspaceProps = ComponentProps<typeof AgentTerminalWorkspace>;

function renderWorkspace(props: Partial<WorkspaceProps> = {}) {
  const confirm = vi.fn(async () => true);
  const onEndAgent = vi.fn(async () => {});
  const onClose = vi.fn();
  const onSwitchAgent = vi.fn();
  render(
    <AgentTerminalWorkspace
      agent={running}
      agents={[running, finished]}
      onSwitchAgent={onSwitchAgent}
      onClose={onClose}
      confirm={confirm}
      onEndAgent={onEndAgent}
      {...props}
    />
  );
  return { confirm, onEndAgent, onClose, onSwitchAgent };
}

describe('AgentTerminalWorkspace – outside the modal', () => {
  beforeEach(() => {
    useStore.setState({ terminalGridCells: null });
  });
  afterEach(() => {
    useStore.setState({ terminalGridCells: null, overlayStack: { layers: [] } });
  });

  it('a layout button puts the first tabs into the panes and focuses the first one', async () => {
    const user = userEvent.setup();
    const third: AgentInfo = { ...running, id: 'c', name: 'Gamma' };
    const fourth: AgentInfo = { ...running, id: 'd', name: 'Delta' };
    const { onSwitchAgent } = renderWorkspace({
      agent: fourth,
      agents: [running, finished, third, fourth],
    });
    await user.click(screen.getByRole('button', { name: 'Show the first 3 tabs side by side' }));
    expect(useStore.getState().terminalGridCells).toEqual(['a', 'b', 'a', 'c']);
    expect(onSwitchAgent).toHaveBeenCalledWith(running);
  });

  it('offers a layout only when there are enough tabs to fill it', () => {
    renderWorkspace();
    expect(
      screen.getByRole('button', { name: 'Show the first 2 tabs side by side' })
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Show the first 4 tabs side by side' })
    ).toBeDisabled();
  });

  it('shows no layout buttons for a single agent', () => {
    renderWorkspace({ agents: [running] });
    expect(screen.queryByRole('group', { name: 'Terminal layout' })).not.toBeInTheDocument();
  });

  it('brings no dialog and no backdrop of its own', () => {
    renderWorkspace();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-modal-backdrop')).not.toBeInTheDocument();
    expect(useStore.getState().overlayStack.layers).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByTestId('xterm-a')).toBeInTheDocument();
  });

  it('asks before ending a running agent, leaves its tab, then ends it once', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    let answer: (go: boolean) => void = () => {};
    const confirm = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const onSwitchAgent = vi.fn(() => order.push('switched'));
    const onEndAgent = vi.fn(async () => {
      order.push('ended');
    });
    renderWorkspace({ confirm, onEndAgent, onSwitchAgent });

    await user.click(screen.getByTestId('agent-tab-close-a'));

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stop this agent?' }));
    expect(onEndAgent).not.toHaveBeenCalled();

    answer(true);
    await waitFor(() => expect(onEndAgent).toHaveBeenCalledTimes(1));
    expect(onEndAgent).toHaveBeenCalledWith(running);
    expect(onSwitchAgent).toHaveBeenCalledWith(finished);
    expect(order).toEqual(['switched', 'ended']);
  });

  it('ends nothing when the question is answered with no', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(async () => false);
    const { onEndAgent, onSwitchAgent } = renderWorkspace({ confirm });

    await user.click(screen.getByTestId('agent-tab-close-a'));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(onEndAgent).not.toHaveBeenCalled();
    expect(onSwitchAgent).not.toHaveBeenCalled();
  });

  it('ends a finished agent without asking', async () => {
    const user = userEvent.setup();
    const { confirm, onEndAgent } = renderWorkspace();

    await user.click(screen.getByTestId('agent-tab-close-b'));

    await waitFor(() => expect(onEndAgent).toHaveBeenCalledTimes(1));
    expect(onEndAgent).toHaveBeenCalledWith(finished);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a pane’s X ends the agent exactly like the tab’s X; the split control only takes it out', async () => {
    const user = userEvent.setup();
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    const { confirm, onEndAgent } = renderWorkspace({ agents: [running, finished] });

    await user.click(screen.getByTestId('terminal-pane-remove-b'));
    expect(onEndAgent).not.toHaveBeenCalled();
    expect(useStore.getState().terminalGridCells).toBeNull();

    act(() => useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] }));
    await user.click(screen.getByTestId('terminal-pane-end-b'));
    await waitFor(() => expect(onEndAgent).toHaveBeenCalledWith(finished));
    expect(confirm).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('terminal-pane-end-a'));
    expect(confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onEndAgent).toHaveBeenCalledWith(running));
  });

  it('offers no end control on a pane where the shell allows none', () => {
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'] });
    renderWorkspace({ canEndAgent: (target) => target.id !== 'b' });
    expect(screen.queryByTestId('terminal-pane-end-b')).not.toBeInTheDocument();
    expect(screen.getByTestId('terminal-pane-end-a')).toBeInTheDocument();
  });

  it('closes when the last tab is ended', async () => {
    const user = userEvent.setup();
    const { onClose, onEndAgent } = renderWorkspace({ agents: [running] });

    await user.click(screen.getByTestId('agent-tab-close-a'));

    await waitFor(() => expect(onEndAgent).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('offers an end control only where the shell allows one', () => {
    renderWorkspace({ canEndAgent: (target) => target.id === 'b' });
    expect(screen.queryByTestId('agent-tab-close-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('agent-tab-close-b')).toBeInTheDocument();
  });

  it('hands the save to the shell with the agent name and a way to read the screen', async () => {
    const user = userEvent.setup();
    const onSaveScreen = vi.fn(async (_name: string, _read: () => string | null) => {});
    renderWorkspace({ onSaveScreen });

    await user.click(screen.getByTestId('agent-tab-capture-a'));

    expect(onSaveScreen).toHaveBeenCalledTimes(1);
    const [name, readScreen] = onSaveScreen.mock.calls[0];
    expect(name).toBe('Alpha');
    expect(readScreen()).toBe('screen of a');
  });

  it('offers no save control when the shell cannot save', () => {
    renderWorkspace();
    expect(screen.queryByTestId('agent-tab-capture-a')).not.toBeInTheDocument();
  });

  it('renders the shell’s header actions before the close control', () => {
    renderWorkspace({ headerActions: <button>Dock</button>, closeLabel: 'Close window' });
    const dock = screen.getByRole('button', { name: 'Dock' });
    const close = screen.getByTitle('Close window');
    expect(dock.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(close).toHaveAccessibleName('Close window');
  });

  it('calls onClose from the close control', async () => {
    const user = userEvent.setup();
    const { onClose } = renderWorkspace();
    await user.click(screen.getByTitle('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the error digest it is given', () => {
    renderWorkspace({ errorDigest: 'error: build failed' });
    expect(screen.getByTestId('terminal-error-digest')).toHaveTextContent('error: build failed');
  });

  it('passes extra attributes on to the header row', () => {
    renderWorkspace({ headerProps: { 'data-tauri-drag-region': true, className: 'pl-20' } });
    const header = screen
      .getByRole('heading', { name: 'Alpha' })
      .closest('[data-tauri-drag-region]');
    expect(header).toHaveClass('pl-20', 'glass');
  });
});
