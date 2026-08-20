import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import { CloseWindowGuard } from './useCloseWindowGuard';

type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>;

const unlisten = vi.fn();
let closeHandler: CloseHandler | null = null;

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: CloseHandler) => {
      closeHandler = handler;
      return unlisten;
    },
  }),
}));

const agent = (id: string, status: AgentInfo['status']): AgentInfo => ({
  id,
  name: id,
  model: 'm',
  provider: 'claude',
  status,
  startedAt: 0,
});

function closeEvent() {
  const preventDefault = vi.fn();
  return { preventDefault };
}

describe('CloseWindowGuard', () => {
  beforeEach(() => {
    closeHandler = null;
    vi.clearAllMocks();
    useStore.setState({ agents: [], overlayStack: { layers: [] } });
  });

  afterEach(() => {
    useStore.setState({ agents: [], overlayStack: { layers: [] } });
  });

  it('lets the window close when no agent is running', async () => {
    useStore.setState({ agents: [agent('done', 'idle')] });
    render(<CloseWindowGuard />);
    await waitFor(() => expect(closeHandler).not.toBeNull());

    const event = closeEvent();
    await act(async () => {
      await closeHandler!(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks before closing while an agent is running, and does not settle while it asks', async () => {
    useStore.setState({ agents: [agent('run', 'running')] });
    render(<CloseWindowGuard />);
    await waitFor(() => expect(closeHandler).not.toBeNull());

    const event = closeEvent();
    let pending!: Promise<void>;
    await act(async () => {
      pending = Promise.resolve(closeHandler!(event));
    });

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Agents are still running')).toBeInTheDocument();
    // The whole point: the close is still pending while the question is on screen.
    expect(event.preventDefault).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await pending;

    expect(event.preventDefault).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when the user confirms', async () => {
    useStore.setState({ agents: [agent('run', 'running')] });
    render(<CloseWindowGuard />);
    await waitFor(() => expect(closeHandler).not.toBeNull());

    const event = closeEvent();
    let pending!: Promise<void>;
    await act(async () => {
      pending = Promise.resolve(closeHandler!(event));
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Close anyway' }));
    await pending;

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the first question when a second close arrives while it is open', async () => {
    useStore.setState({ agents: [agent('run', 'running')] });
    render(<CloseWindowGuard />);
    await waitFor(() => expect(closeHandler).not.toBeNull());

    const first = closeEvent();
    let firstPending!: Promise<void>;
    await act(async () => {
      firstPending = Promise.resolve(closeHandler!(first));
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    const second = closeEvent();
    await act(async () => {
      await closeHandler!(second);
    });

    expect(second.preventDefault).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Agents are still running' })).toBeInTheDocument();
    expect(first.preventDefault).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await firstPending;
    expect(first.preventDefault).toHaveBeenCalled();
  });

  it('unsubscribes when the app unmounts', async () => {
    const { unmount } = render(<CloseWindowGuard />);
    await waitFor(() => expect(closeHandler).not.toBeNull());
    unmount();
    expect(unlisten).toHaveBeenCalled();
  });
});
