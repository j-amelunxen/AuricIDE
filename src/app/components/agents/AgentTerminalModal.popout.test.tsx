import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentTerminalModal } from './AgentTerminalModal';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';

const openAgentWindow = vi.fn(async () => {});
const setAgentWindowHandover = vi.fn();

vi.mock('./AgentXterm', () => ({
  AgentXterm: ({ agentId }: { agentId: string }) => <div data-testid={`xterm-${agentId}`} />,
}));
vi.mock('@/lib/tauri/agentWindow', () => ({
  openAgentWindow: () => openAgentWindow(),
}));
vi.mock('@/lib/agents/agentWindowHost', () => ({
  setAgentWindowHandover: (next: unknown) => setAgentWindowHandover(next),
}));

const agent: AgentInfo = {
  id: 'a',
  name: 'Alpha',
  model: 'model',
  provider: 'claude',
  status: 'running',
  startedAt: 1000,
};
const other: AgentInfo = { ...agent, id: 'b', name: 'Beta' };

describe('AgentTerminalModal – open in own window', () => {
  beforeEach(() => {
    openAgentWindow.mockReset().mockResolvedValue(undefined);
    setAgentWindowHandover.mockClear();
    useStore.setState({ terminalGridCells: ['a', 'b', 'a', 'b'], toasts: [] });
  });
  afterEach(() => {
    useStore.setState({ terminalGridCells: null, toasts: [], overlayStack: { layers: [] } });
  });

  it('hands the layout over, opens the window, then closes the modal', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    setAgentWindowHandover.mockImplementation(() => order.push('handover'));
    openAgentWindow.mockImplementation(async () => {
      order.push('open');
    });
    const onClose = vi.fn(() => order.push('close'));
    render(<AgentTerminalModal agent={agent} agents={[agent, other]} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Open in own window' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(setAgentWindowHandover).toHaveBeenCalledWith({
      activeAgentId: 'a',
      gridCells: ['a', 'b', 'a', 'b'],
    });
    expect(order).toEqual(['handover', 'open', 'close']);
  });

  it('says so and stays open when the window cannot be opened', async () => {
    const user = userEvent.setup();
    openAgentWindow.mockRejectedValue(new Error('no window'));
    const onClose = vi.fn();
    render(<AgentTerminalModal agent={agent} agents={[agent, other]} onClose={onClose} />);

    await user.click(screen.getByTitle('Open in own window'));

    await waitFor(() =>
      expect(useStore.getState().toasts.map((t) => t.message)).toContain(
        'Could not open the agent window'
      )
    );
    expect(onClose).not.toHaveBeenCalled();
    // A layout left behind would be picked up by a window opened later.
    expect(setAgentWindowHandover).toHaveBeenLastCalledWith({
      activeAgentId: null,
      gridCells: null,
    });
  });
});
