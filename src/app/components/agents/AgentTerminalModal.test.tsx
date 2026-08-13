import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AgentTerminalModal } from './AgentTerminalModal';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';

// Module-level spies so individual tests can control/inspect behavior
const mockGetSelection = vi.fn().mockReturnValue('');
const mockHasSelection = vi.fn().mockReturnValue(false);
const mockSelectAll = vi.fn();
const mockPaste = vi.fn();
const mockWrite = vi.fn();
const mockFit = vi.fn();
const mockResize = vi.fn();
const mockReset = vi.fn();
const mockTerminalOptions: unknown[] = [];
let keyEventHandler: ((event: KeyboardEvent) => boolean) | null = null;

// Mock xterm.js — AgentXterm dynamically imports these
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    constructor(options?: unknown) {
      mockTerminalOptions.push(options);
    }
    loadAddon() {}
    open() {}
    write(data: string) {
      mockWrite(data);
    }
    onData() {}
    onResize() {}
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      keyEventHandler = handler;
    }
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
      mockResize(cols, rows);
    }
    reset() {
      mockReset();
    }
    getSelection() {
      return mockGetSelection();
    }
    hasSelection() {
      return mockHasSelection();
    }
    selectAll() {
      mockSelectAll();
    }
    paste(text: string) {
      mockPaste(text);
    }
    dispose() {}
  },
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {
      mockFit();
    }
  },
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

vi.mock('@/lib/tauri/terminal', () => ({
  onTerminalOut: vi.fn().mockResolvedValue(vi.fn()),
  writeToShell: vi.fn(),
  resizeShell: vi.fn().mockResolvedValue(undefined),
}));

// Capture the sendText callbacks wired into the image paste / file drop handlers
let pasteSendText: ((text: string) => void) | null = null;
const mockDetachImagePaste = vi.fn();
const mockDetachFileDrop = vi.fn();
const mockAttachImagePaste = vi.fn((_c: HTMLElement, sendText: (text: string) => void) => {
  pasteSendText = sendText;
  return mockDetachImagePaste;
});
const mockAttachFileDrop = vi.fn(() => mockDetachFileDrop);

// Restore latency is the interesting variable here: by default the real stream
// is used, one test swaps in a restore that stays pending.
let pendingRestore: Promise<void> | null = null;

vi.mock('@/lib/terminal/agentStream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/terminal/agentStream')>();
  return {
    ...actual,
    attachAgentStream: (...args: Parameters<typeof actual.attachAgentStream>) => {
      const handle = actual.attachAgentStream(...args);
      return pendingRestore ? { ...handle, restored: pendingRestore } : handle;
    },
  };
});

vi.mock('@/lib/terminal/imageInsert', () => ({
  attachImagePaste: (container: HTMLElement, sendText: (text: string) => void) =>
    mockAttachImagePaste(container, sendText),
  attachFileDrop: () => mockAttachFileDrop(),
}));

const agent: AgentInfo = {
  id: 'agent-1',
  name: 'Writer',
  model: 'claude-opus-4-6',
  provider: 'claude',
  status: 'running',
  currentTask: 'Writing documentation',
  startedAt: 1000,
  lastActivityAt: Date.now(),
};

describe('AgentTerminalModal – failure digest bar', () => {
  afterEach(() => {
    useStore.setState({ overlayStack: { layers: [] } });
  });

  it('answers "why did it fail" the moment the terminal opens', () => {
    useStore.setState({
      agentLogs: { 'agent-1': ['Compiling...\n', 'error: cannot find module "fleet"\n'] },
    });
    render(<AgentTerminalModal agent={{ ...agent, status: 'error' }} onClose={vi.fn()} />);
    expect(screen.getByTestId('terminal-error-digest')).toHaveTextContent(
      'error: cannot find module "fleet"'
    );
    useStore.setState({ agentLogs: {} });
  });

  it('shows no digest bar for a running agent', () => {
    useStore.setState({ agentLogs: { 'agent-1': ['error: transient, retrying\n'] } });
    render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
    expect(screen.queryByTestId('terminal-error-digest')).not.toBeInTheDocument();
    useStore.setState({ agentLogs: {} });
  });
});

describe('AgentTerminalModal', () => {
  afterEach(() => {
    useStore.setState({ overlayStack: { layers: [] } });
  });

  it('renders nothing when no agent is provided', () => {
    const { container } = render(<AgentTerminalModal agent={null} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the modal with agent name', () => {
    render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
    expect(screen.getByText('Writer')).toBeInTheDocument();
  });

  it('renders the agent task', () => {
    render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
    expect(screen.getByText('Writing documentation')).toBeInTheDocument();
  });

  it('shows agent status', () => {
    render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
    expect(screen.getByText('Working')).toBeInTheDocument();
  });

  it('closes on Escape when no confirm is open', () => {
    const onClose = vi.fn();
    render(<AgentTerminalModal agent={agent} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close the terminal when a confirm owns Escape', () => {
    const onClose = vi.fn();
    render(<AgentTerminalModal agent={agent} onClose={onClose} />);

    act(() => {
      useStore.getState().pushOverlay({ id: 'confirm', kind: 'confirm' });
    });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows agent id', () => {
    render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
    expect(screen.getByText('agent-1')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AgentTerminalModal agent={agent} onClose={onClose} />);

    await user.click(screen.getByTitle('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when clicking the backdrop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AgentTerminalModal agent={agent} onClose={onClose} />);

    await user.click(screen.getByTestId('agent-modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders the xterm container', () => {
    const { container } = render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
    // The modal should have the terminal icon in the header
    expect(container.querySelector('[data-icon="terminal"]')).toBeInTheDocument();
  });

  it('exposes an accessible dialog named after the agent', () => {
    render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /writer/i })).toBeInTheDocument();
  });

  describe('terminal stream (single-source from store)', () => {
    beforeEach(() => {
      mockWrite.mockClear();
      mockFit.mockClear();
      useStore.setState({ agentLogs: {}, agentLogMeta: {} });
    });

    // Unique agent id per test: earlier tests in this file mount terminals
    // for `agent-1`, and their store subscriptions can linger a tick under
    // load — distinct ids make each test's write assertions airtight.
    function streamAgent(id: string): AgentInfo {
      return { ...agent, id };
    }

    async function flushSetup() {
      // Setup fits once immediately, sleeps ~50ms for layout, fits AGAIN,
      // then attaches the stream (which replays history). A fixed sleep
      // flakes under full-suite load — the timer fires late when the event
      // loop is starved — so poll for the second fit, then flush the
      // remaining import/attach microtasks with macrotask turns.
      await waitFor(() => expect(mockFit.mock.calls.length).toBeGreaterThanOrEqual(2), {
        timeout: 5000,
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    it('replays store history as a single write', async () => {
      useStore.getState().appendAgentLog('stream-replay', 'chunk-a');
      useStore.getState().appendAgentLog('stream-replay', 'chunk-b');

      render(<AgentTerminalModal agent={streamAgent('stream-replay')} onClose={vi.fn()} />);
      await flushSetup();

      await waitFor(() => expect(mockWrite).toHaveBeenCalledWith('chunk-achunk-b'));
      expect(mockWrite).toHaveBeenCalledTimes(1);
    });

    it('fits the terminal BEFORE replaying history', async () => {
      useStore.getState().appendAgentLog('stream-fit', 'history');

      render(<AgentTerminalModal agent={streamAgent('stream-fit')} onClose={vi.fn()} />);
      await flushSetup();

      await waitFor(() => expect(mockWrite).toHaveBeenCalled());
      expect(mockFit).toHaveBeenCalled();
      expect(mockFit.mock.invocationCallOrder[0]).toBeLessThan(
        mockWrite.mock.invocationCallOrder[0]
      );
    });

    it('writes chunks appended after mount exactly once (no duplication)', async () => {
      useStore.getState().appendAgentLog('stream-live', 'old');

      render(<AgentTerminalModal agent={streamAgent('stream-live')} onClose={vi.fn()} />);
      await flushSetup();
      // The seeded history write must land before we start counting.
      await waitFor(() => expect(mockWrite).toHaveBeenCalled());
      mockWrite.mockClear();

      act(() => {
        useStore.getState().appendAgentLog('stream-live', 'live-1');
        useStore.getState().appendAgentLog('stream-live', 'live-2');
      });

      const written = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(written).toBe('live-1live-2');
    });

    it('does not subscribe to the terminal-out event channel', async () => {
      const { onTerminalOut } = await import('@/lib/tauri/terminal');
      vi.mocked(onTerminalOut).mockClear();
      render(<AgentTerminalModal agent={streamAgent('stream-noevent')} onClose={vi.fn()} />);
      await flushSetup();

      expect(onTerminalOut).not.toHaveBeenCalled();
    });

    it('ignores chunks for other agents', async () => {
      render(<AgentTerminalModal agent={streamAgent('stream-ignore')} onClose={vi.fn()} />);
      await flushSetup();
      mockWrite.mockClear();

      act(() => {
        useStore.getState().appendAgentLog('stream-ignore-other', 'noise');
      });

      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('adopts an external PTY resize by re-attaching at the new geometry', async () => {
      const { resizeAgentMirror, disposeAllAgentMirrors } =
        await import('@/lib/terminal/agentMirror');
      disposeAllAgentMirrors();
      mockResize.mockClear();
      mockReset.mockClear();

      render(<AgentTerminalModal agent={streamAgent('stream-resize')} onClose={vi.fn()} />);
      await flushSetup();
      mockWrite.mockClear();

      // Another view (e.g. the bottom terminal preview) takes over the PTY size.
      act(() => {
        resizeAgentMirror('stream-resize', 40, 160);
      });

      expect(mockResize).toHaveBeenCalledWith(160, 40);
      expect(mockReset).toHaveBeenCalled();

      // The re-attached stream still receives live chunks exactly once.
      act(() => {
        useStore.getState().appendAgentLog('stream-resize', 'after-resize');
      });
      const written = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(written).toContain('after-resize');

      disposeAllAgentMirrors();
    });

    it('stops writing after unmount', async () => {
      const { unmount } = render(
        <AgentTerminalModal agent={streamAgent('stream-unmount')} onClose={vi.fn()} />
      );
      await flushSetup();
      unmount();
      mockWrite.mockClear();

      act(() => {
        useStore.getState().appendAgentLog('stream-unmount', 'after-unmount');
      });

      expect(mockWrite).not.toHaveBeenCalled();
    });
  });

  describe('agent tabs', () => {
    function makeAgent(overrides: Partial<AgentInfo>): AgentInfo {
      return { ...agent, ...overrides };
    }

    const working = makeAgent({ id: 'agent-1', name: 'Writer', lastActivityAt: Date.now() });
    const waiting = makeAgent({
      id: 'agent-2',
      name: 'Reviewer',
      status: 'running',
      lastActivityAt: Date.now() - 60_000,
    });
    const done = makeAgent({ id: 'agent-3', name: 'Fixer', status: 'idle' });
    const failed = makeAgent({ id: 'agent-4', name: 'Deployer', status: 'error' });
    const all = [working, waiting, done, failed];

    it('renders no tablist when agents are not provided', () => {
      render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    it('renders one tab per active agent', () => {
      render(<AgentTerminalModal agent={working} agents={all} onClose={vi.fn()} />);
      expect(screen.getAllByRole('tab')).toHaveLength(4);
      expect(screen.getByTestId('agent-tab-agent-2')).toHaveTextContent('Reviewer');
    });

    it('marks the displayed agent tab as selected', () => {
      render(<AgentTerminalModal agent={waiting} agents={all} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-tab-agent-2')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('agent-tab-agent-1')).toHaveAttribute('aria-selected', 'false');
    });

    it('previews the agent state on each tab', () => {
      render(<AgentTerminalModal agent={working} agents={all} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-tab-agent-1')).toHaveAttribute('data-state', 'working');
      expect(screen.getByTestId('agent-tab-agent-2')).toHaveAttribute('data-state', 'waiting');
      expect(screen.getByTestId('agent-tab-agent-3')).toHaveAttribute('data-state', 'done');
      expect(screen.getByTestId('agent-tab-agent-4')).toHaveAttribute('data-state', 'error');
    });

    it('shows the state label on the tab', () => {
      render(<AgentTerminalModal agent={working} agents={all} onClose={vi.fn()} />);
      expect(screen.getByTestId('agent-tab-agent-1')).toHaveTextContent(/working/i);
      expect(screen.getByTestId('agent-tab-agent-2')).toHaveTextContent(/waiting/i);
    });

    it('calls onSwitchAgent with the clicked agent', async () => {
      const user = userEvent.setup();
      const onSwitchAgent = vi.fn();
      render(
        <AgentTerminalModal
          agent={working}
          agents={all}
          onSwitchAgent={onSwitchAgent}
          onClose={vi.fn()}
        />
      );

      await user.click(screen.getByTestId('agent-tab-agent-3'));
      expect(onSwitchAgent).toHaveBeenCalledWith(done);
    });

    it('renders header status from the live agents list, not the stale snapshot', () => {
      const stale = makeAgent({ id: 'agent-2', name: 'Reviewer', status: 'running' });
      const live = [makeAgent({ id: 'agent-2', name: 'Reviewer', status: 'idle' })];
      render(<AgentTerminalModal agent={stale} agents={live} onClose={vi.fn()} />);
      expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
    });

    /**
     * Answers the modal's own confirmation dialog. window.confirm is off-limits
     * in the Tauri webview — it does not suspend the script.
     */
    async function answerStop(user: ReturnType<typeof userEvent.setup>, button: string) {
      const dialog = await screen.findByRole('dialog', { name: 'Stop this agent?' });
      await user.click(within(dialog).getByRole('button', { name: button }));
    }

    it('does not offer a close control when no end handlers are given', () => {
      render(<AgentTerminalModal agent={working} agents={all} onClose={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /stop /i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /dismiss /i })).not.toBeInTheDocument();
    });

    it('names the close control after the act: stop a runner, dismiss a finished one', () => {
      render(
        <AgentTerminalModal
          agent={working}
          agents={all}
          onKill={vi.fn()}
          onDismiss={vi.fn()}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: 'Stop Writer' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Stop Reviewer' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dismiss Fixer' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dismiss Deployer' })).toBeInTheDocument();
    });

    it('asks before stopping a running agent, and does not stop until answered', async () => {
      const user = userEvent.setup();
      const onKill = vi.fn();
      render(
        <AgentTerminalModal
          agent={working}
          agents={all}
          onKill={onKill}
          onDismiss={vi.fn()}
          onClose={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Stop Writer' }));
      expect(await screen.findByRole('dialog', { name: 'Stop this agent?' })).toHaveTextContent(
        'Stop Writer? Its work in progress is lost.'
      );
      expect(onKill).not.toHaveBeenCalled();
    });

    it('stops the running agent once the question is confirmed', async () => {
      const user = userEvent.setup();
      const onKill = vi.fn();
      render(
        <AgentTerminalModal
          agent={working}
          agents={all}
          onKill={onKill}
          onDismiss={vi.fn()}
          onClose={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Stop Reviewer' }));
      await answerStop(user, 'Stop');
      expect(onKill).toHaveBeenCalledWith('agent-2');
    });

    it('leaves the agent running when the question is cancelled', async () => {
      const user = userEvent.setup();
      const onKill = vi.fn();
      const onSwitchAgent = vi.fn();
      render(
        <AgentTerminalModal
          agent={working}
          agents={all}
          onKill={onKill}
          onDismiss={vi.fn()}
          onSwitchAgent={onSwitchAgent}
          onClose={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Stop Writer' }));
      await answerStop(user, 'Cancel');
      expect(onKill).not.toHaveBeenCalled();
      expect(onSwitchAgent).not.toHaveBeenCalled();
    });

    it('dismisses a finished agent without asking', async () => {
      const user = userEvent.setup();
      const onDismiss = vi.fn();
      const onKill = vi.fn();
      render(
        <AgentTerminalModal
          agent={working}
          agents={all}
          onKill={onKill}
          onDismiss={onDismiss}
          onClose={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Dismiss Fixer' }));
      expect(onDismiss).toHaveBeenCalledWith('agent-3');
      expect(onKill).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog', { name: 'Stop this agent?' })).not.toBeInTheDocument();
    });

    it('does not switch tabs when the close control is clicked', async () => {
      const user = userEvent.setup();
      const onSwitchAgent = vi.fn();
      render(
        <AgentTerminalModal
          agent={working}
          agents={all}
          onKill={vi.fn()}
          onDismiss={vi.fn()}
          onSwitchAgent={onSwitchAgent}
          onClose={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Stop Reviewer' }));
      expect(onSwitchAgent).not.toHaveBeenCalled();
    });

    it('moves to a neighbour after stopping the agent on screen', async () => {
      const user = userEvent.setup();
      const onKill = vi.fn();
      const onSwitchAgent = vi.fn();
      render(
        <AgentTerminalModal
          agent={working}
          agents={all}
          onKill={onKill}
          onDismiss={vi.fn()}
          onSwitchAgent={onSwitchAgent}
          onClose={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Stop Writer' }));
      await answerStop(user, 'Stop');
      expect(onSwitchAgent).toHaveBeenCalledWith(waiting);
      expect(onKill).toHaveBeenCalledWith('agent-1');
      expect(onSwitchAgent.mock.invocationCallOrder[0]).toBeLessThan(
        onKill.mock.invocationCallOrder[0]
      );
    });

    it('closes the modal when the last tab is stopped', async () => {
      const user = userEvent.setup();
      const onKill = vi.fn();
      const onSwitchAgent = vi.fn();
      const onClose = vi.fn();
      render(
        <AgentTerminalModal
          agent={working}
          agents={[working]}
          onKill={onKill}
          onDismiss={vi.fn()}
          onSwitchAgent={onSwitchAgent}
          onClose={onClose}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Stop Writer' }));
      await answerStop(user, 'Stop');
      expect(onClose).toHaveBeenCalled();
      expect(onKill).toHaveBeenCalledWith('agent-1');
      expect(onSwitchAgent).not.toHaveBeenCalled();
    });

    it('cancels a queued agent without asking', async () => {
      const user = userEvent.setup();
      const queued = makeAgent({ id: 'agent-q', name: 'Queued', status: 'queued' });
      const onKill = vi.fn();
      render(
        <AgentTerminalModal
          agent={working}
          agents={[working, queued]}
          onKill={onKill}
          onDismiss={vi.fn()}
          onClose={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Stop Queued' }));
      expect(onKill).toHaveBeenCalledWith('agent-q');
      expect(screen.queryByRole('dialog', { name: 'Stop this agent?' })).not.toBeInTheDocument();
    });

    it('middle-clicks a tab to start the same stop flow', async () => {
      const onKill = vi.fn();
      render(
        <AgentTerminalModal
          agent={working}
          agents={all}
          onKill={onKill}
          onDismiss={vi.fn()}
          onClose={vi.fn()}
        />
      );

      fireEvent(
        screen.getByTestId('agent-tab-agent-1'),
        new MouseEvent('auxclick', { button: 1, bubbles: true })
      );
      expect(await screen.findByRole('dialog', { name: 'Stop this agent?' })).toBeInTheDocument();
      expect(onKill).not.toHaveBeenCalled();
    });

    it('keeps the terminal open when Escape answers the stop question', async () => {
      const user = userEvent.setup();
      const onKill = vi.fn();
      const onClose = vi.fn();
      render(
        <AgentTerminalModal
          agent={working}
          agents={all}
          onKill={onKill}
          onDismiss={vi.fn()}
          onClose={onClose}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Stop Writer' }));
      expect(await screen.findByRole('dialog', { name: 'Stop this agent?' })).toBeInTheDocument();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Stop this agent?' })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: /writer/i })).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(onKill).not.toHaveBeenCalled();
    });
  });

  describe('image paste & file drop', () => {
    beforeEach(() => {
      pasteSendText = null;
      mockAttachImagePaste.mockClear();
      mockAttachFileDrop.mockClear();
      mockDetachImagePaste.mockClear();
      mockDetachFileDrop.mockClear();
    });

    it('attaches paste and drop handlers to the xterm container', async () => {
      const { container } = render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);

      await waitFor(() => expect(mockAttachImagePaste).toHaveBeenCalledTimes(1));
      expect(mockAttachFileDrop).toHaveBeenCalledTimes(1);
      expect(mockAttachImagePaste.mock.calls[0][0]).toBe(
        container.querySelector('[data-testid="agent-xterm"]')
      );
    });

    it('routes inserted paths to the agent PTY session', async () => {
      render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
      await waitFor(() => expect(pasteSendText).not.toBeNull());

      pasteSendText!('/cache/screenshot_1.png ');

      const { writeToShell } = await import('@/lib/tauri/terminal');
      expect(writeToShell).toHaveBeenCalledWith('agent-agent-1', '/cache/screenshot_1.png ');
    });

    it('detaches both handlers on unmount', async () => {
      const { unmount } = render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
      await waitFor(() => expect(mockAttachImagePaste).toHaveBeenCalled());

      unmount();
      expect(mockDetachImagePaste).toHaveBeenCalled();
      expect(mockDetachFileDrop).toHaveBeenCalled();
    });
  });

  describe('context menu', () => {
    beforeEach(() => {
      mockGetSelection.mockReturnValue('');
      mockHasSelection.mockReturnValue(false);
      mockSelectAll.mockReset();
      mockPaste.mockReset();
      keyEventHandler = null;
      mockTerminalOptions.length = 0;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: vi.fn().mockResolvedValue(undefined),
          readText: vi.fn().mockResolvedValue('pasted line'),
        },
      });
    });

    it('accepts onSelectionSpawn prop without error', () => {
      expect(() => {
        render(<AgentTerminalModal agent={agent} onClose={vi.fn()} onSelectionSpawn={vi.fn()} />);
      }).not.toThrow();
    });

    it('does not render context menu by default', () => {
      render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
      expect(screen.queryByText('Paste')).not.toBeInTheDocument();
    });

    it('enables Option-click selection and snappier wheel scrolling', async () => {
      render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
      await waitFor(() => expect(mockTerminalOptions.length).toBeGreaterThan(0));
      expect(mockTerminalOptions[0]).toEqual(
        expect.objectContaining({
          macOptionClickForcesSelection: true,
          scrollSensitivity: 3,
          smoothScrollDuration: 0,
        })
      );
    });

    it('shows copy/paste/select-all and spawn when there is a selection', async () => {
      mockGetSelection.mockReturnValue('error on line 42');
      const { container } = render(
        <AgentTerminalModal agent={agent} onClose={vi.fn()} onSelectionSpawn={vi.fn()} />
      );

      const xtermContainer = container.querySelector('[data-testid="agent-xterm"]')!;

      await waitFor(() => {
        fireEvent.contextMenu(xtermContainer);
        expect(screen.getByText('Copy')).toBeInTheDocument();
        expect(screen.getByText('Paste')).toBeInTheDocument();
        expect(screen.getByText('Select All')).toBeInTheDocument();
        expect(screen.getByText('Spawn Agent with Selection')).toBeInTheDocument();
      });
    });

    it('still shows paste and select-all when there is no selection', async () => {
      mockGetSelection.mockReturnValue('');
      const { container } = render(
        <AgentTerminalModal agent={agent} onClose={vi.fn()} onSelectionSpawn={vi.fn()} />
      );

      const xtermContainer = container.querySelector('[data-testid="agent-xterm"]')!;

      await waitFor(() => {
        fireEvent.contextMenu(xtermContainer);
        expect(screen.getByText('Paste')).toBeInTheDocument();
      });

      expect(screen.getByText('Select All')).toBeInTheDocument();
      expect(screen.queryByText('Copy')).not.toBeInTheDocument();
      expect(screen.queryByText('Spawn Agent with Selection')).not.toBeInTheDocument();
    });

    it('copies the captured selection from the menu', async () => {
      mockGetSelection.mockReturnValue('error on line 42');
      const { container } = render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
      const xtermContainer = container.querySelector('[data-testid="agent-xterm"]')!;

      await waitFor(() => {
        fireEvent.contextMenu(xtermContainer);
        expect(screen.getByText('Copy')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Copy'));
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('error on line 42')
      );
    });

    it('pastes clipboard text through xterm so bracketed-paste stays intact', async () => {
      const { container } = render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
      const xtermContainer = container.querySelector('[data-testid="agent-xterm"]')!;

      await waitFor(() => {
        fireEvent.contextMenu(xtermContainer);
        expect(screen.getByText('Paste')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Paste'));
      await waitFor(() => expect(mockPaste).toHaveBeenCalledWith('pasted line'));
    });

    it('selects all from the menu', async () => {
      const { container } = render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
      const xtermContainer = container.querySelector('[data-testid="agent-xterm"]')!;

      await waitFor(() => {
        fireEvent.contextMenu(xtermContainer);
        expect(screen.getByText('Select All')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Select All'));
      expect(mockSelectAll).toHaveBeenCalled();
    });

    it('calls onSelectionSpawn with selected text when menu item is clicked', async () => {
      mockGetSelection.mockReturnValue('error on line 42');
      const onSelectionSpawn = vi.fn();
      const { container } = render(
        <AgentTerminalModal agent={agent} onClose={vi.fn()} onSelectionSpawn={onSelectionSpawn} />
      );

      const xtermContainer = container.querySelector('[data-testid="agent-xterm"]')!;

      await waitFor(() => {
        fireEvent.contextMenu(xtermContainer);
        expect(screen.getByText('Spawn Agent with Selection')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Spawn Agent with Selection'));

      expect(onSelectionSpawn).toHaveBeenCalledWith('error on line 42');
    });

    it('closes context menu when clicking outside', async () => {
      mockGetSelection.mockReturnValue('some text');
      const { container } = render(
        <AgentTerminalModal agent={agent} onClose={vi.fn()} onSelectionSpawn={vi.fn()} />
      );

      const xtermContainer = container.querySelector('[data-testid="agent-xterm"]')!;

      await waitFor(() => {
        fireEvent.contextMenu(xtermContainer);
        expect(screen.getByText('Spawn Agent with Selection')).toBeInTheDocument();
      });

      act(() => {
        fireEvent.mouseDown(document.body);
      });

      expect(screen.queryByText('Spawn Agent with Selection')).not.toBeInTheDocument();
    });

    it('copies on Cmd+C when the terminal has a selection', async () => {
      mockHasSelection.mockReturnValue(true);
      mockGetSelection.mockReturnValue('picked');
      render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);

      await waitFor(() => expect(keyEventHandler).toBeInstanceOf(Function));
      const event = new KeyboardEvent('keydown', { key: 'c', metaKey: true });
      expect(keyEventHandler!(event)).toBe(false);
      await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('picked'));
    });

    it('selects all on Cmd+A', async () => {
      render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
      await waitFor(() => expect(keyEventHandler).toBeInstanceOf(Function));
      const event = new KeyboardEvent('keydown', { key: 'a', metaKey: true });
      expect(keyEventHandler!(event)).toBe(false);
      expect(mockSelectAll).toHaveBeenCalled();
    });
  });
});

describe('AgentTerminalModal restore feedback', () => {
  const agent: AgentInfo = {
    id: 'agent-restore',
    name: 'Restoring Agent',
    model: 'sonnet',
    provider: 'claude',
    status: 'running',
    startedAt: 1000,
  };

  beforeEach(() => {
    pendingRestore = null;
    vi.useRealTimers();
  });

  it('stays quiet while a restore completes quickly', async () => {
    render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('agent-xterm')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByTestId('terminal-restoring')).not.toBeInTheDocument();
  });

  it('says it is restoring when the screen takes a noticeable moment', async () => {
    let finishRestore = () => {};
    pendingRestore = new Promise<void>((resolve) => {
      finishRestore = resolve;
    });

    render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('terminal-restoring')).toBeInTheDocument());

    await act(async () => {
      finishRestore();
      await pendingRestore;
    });
    await waitFor(() => expect(screen.queryByTestId('terminal-restoring')).not.toBeInTheDocument());
  });
});
