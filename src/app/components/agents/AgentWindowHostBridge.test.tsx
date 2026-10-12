import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentWindowHostBridge } from './AgentWindowHostBridge';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { AgentWindowHostHandlers } from '@/lib/agents/agentWindowHost';
import type { ConfirmRequest } from '@/lib/hooks/useConfirm';
import { useStore } from '@/lib/store';

let handlers: AgentWindowHostHandlers | null = null;
const uninstall = vi.fn();
const focusMainWindow = vi.fn(async () => {});
const captureAgentScreen = vi.fn(async (_name: string, _read: () => string | null) => {});
/** Whether the agent that ended has a worktree worth asking about. */
let mergeIsOffered = false;
const order: string[] = [];

vi.mock('@/lib/agents/agentWindowHost', () => ({
  installAgentWindowHost: (next: AgentWindowHostHandlers) => {
    handlers = next;
    return uninstall;
  },
}));
vi.mock('@/lib/tauri/agentWindow', () => ({
  focusMainWindow: () => focusMainWindow(),
}));
vi.mock('./captureAgentScreen', () => ({
  captureAgentScreen: (name: string, read: () => string | null) => captureAgentScreen(name, read),
}));
vi.mock('@/lib/hooks/useWorktreeMergeOffer', () => ({
  useWorktreeMergeOffer:
    (confirm: (request: ConfirmRequest) => Promise<boolean>) => async (agent: AgentInfo) => {
      order.push(`offer:${agent.id}`);
      if (mergeIsOffered) await confirm({ title: 'Merge?', message: 'Merge the worktree?' });
    },
}));

const running: AgentInfo = {
  id: 'a',
  name: 'Alpha',
  model: 'model',
  provider: 'claude',
  status: 'running',
  startedAt: 1000,
};
const finished: AgentInfo = { ...running, id: 'b', name: 'Beta', status: 'idle' };

function renderBridge() {
  const setFullscreenAgent = vi.fn();
  const view = render(<AgentWindowHostBridge setFullscreenAgent={setFullscreenAgent} />);
  if (!handlers) throw new Error('the host was not installed');
  return { setFullscreenAgent, handlers, ...view };
}

describe('AgentWindowHostBridge', () => {
  const killRunningAgent = vi.fn(async (id: string) => {
    order.push(`kill:${id}`);
  });
  const dismissFinishedAgent = vi.fn((id: string) => {
    order.push(`dismiss:${id}`);
  });

  beforeEach(() => {
    handlers = null;
    mergeIsOffered = false;
    order.length = 0;
    vi.clearAllMocks();
    useStore.setState({
      agents: [running, finished],
      killRunningAgent,
      dismissFinishedAgent,
      terminalGridCells: null,
      agentWindowOpen: false,
    });
  });
  afterEach(() => {
    useStore.setState({ agents: [], terminalGridCells: null, overlayStack: { layers: [] } });
  });

  it('installs the host once and takes it down on unmount', () => {
    const { rerender, unmount, setFullscreenAgent } = renderBridge();
    const first = handlers;
    rerender(<AgentWindowHostBridge setFullscreenAgent={setFullscreenAgent} />);
    expect(handlers).toBe(first);
    unmount();
    expect(uninstall).toHaveBeenCalledOnce();
  });

  it('kills through the store action, then offers the merge', async () => {
    const { handlers: host } = renderBridge();

    await act(async () => {
      await host.onKill('a');
    });

    expect(order).toEqual(['kill:a', 'offer:a']);
    expect(dismissFinishedAgent).not.toHaveBeenCalled();
  });

  it('clears a finished agent through the store action', async () => {
    const { handlers: host } = renderBridge();

    await act(async () => {
      await host.onDismiss('b');
    });

    expect(order).toEqual(['dismiss:b', 'offer:b']);
    expect(killRunningAgent).not.toHaveBeenCalled();
  });

  // The other window asked to clear a stopped agent; by the time it arrives
  // the agent runs again here. Nobody was asked "Stop this agent?".
  it('never turns a clear into a kill', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { handlers: host } = renderBridge();

    await act(async () => {
      await host.onDismiss('a');
    });

    expect(killRunningAgent).not.toHaveBeenCalled();
    expect(dismissFinishedAgent).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped dismiss for a'));
    warn.mockRestore();
  });

  it('drops a kill for an agent that has already stopped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { handlers: host } = renderBridge();

    await act(async () => {
      await host.onKill('b');
    });

    expect(order).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped kill for b'));
    warn.mockRestore();
  });

  it('does nothing for an agent that is already gone', async () => {
    const { handlers: host } = renderBridge();
    await act(async () => {
      await host.onKill('nobody');
    });
    expect(order).toEqual([]);
  });

  it('stays in the background when ending an agent raises no question', async () => {
    const { handlers: host } = renderBridge();
    await act(async () => {
      await host.onKill('a');
    });
    expect(focusMainWindow).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('comes forward to ask the merge question in the main window', async () => {
    const user = userEvent.setup();
    mergeIsOffered = true;
    const { handlers: host } = renderBridge();

    let settled = false;
    act(() => {
      void Promise.resolve(host.onKill('a')).then(() => {
        settled = true;
      });
    });

    expect(await screen.findByRole('dialog', { name: 'Merge?' })).toBeInTheDocument();
    expect(focusMainWindow).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(settled).toBe(true));
  });

  it('saves the screen the agent window read, through the capture path', async () => {
    const { handlers: host } = renderBridge();

    await host.onSaveScratch('Alpha', 'what was on screen');

    expect(captureAgentScreen).toHaveBeenCalledOnce();
    const [name, readScreen] = captureAgentScreen.mock.calls[0];
    expect(name).toBe('Alpha');
    expect(readScreen()).toBe('what was on screen');
  });

  it('docking restores the layout and opens the modal on the agent', () => {
    const { handlers: host, setFullscreenAgent } = renderBridge();

    act(() => void host.onDock('b', ['a', 'b', 'a', 'b']));

    expect(useStore.getState().terminalGridCells).toEqual(['a', 'b', 'a', 'b']);
    expect(setFullscreenAgent).toHaveBeenCalledWith(finished);
  });

  it('docking on an agent that is gone restores the layout and opens nothing', () => {
    const { handlers: host, setFullscreenAgent } = renderBridge();

    act(() => void host.onDock('nobody', null));

    expect(useStore.getState().terminalGridCells).toBeNull();
    expect(setFullscreenAgent).not.toHaveBeenCalled();
  });
});
