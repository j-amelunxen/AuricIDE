import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AgentTerminalModal } from './AgentTerminalModal';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';

// Module-level spies so individual tests can control/inspect behavior
const mockGetSelection = vi.fn().mockReturnValue('');
const mockWrite = vi.fn();
const mockFit = vi.fn();

// Mock xterm.js — AgentXterm dynamically imports these
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    loadAddon() {}
    open() {}
    write(data: string) {
      mockWrite(data);
    }
    onData() {}
    onResize() {}
    getSelection() {
      return mockGetSelection();
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

describe('AgentTerminalModal', () => {
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
    expect(screen.getByText('running')).toBeInTheDocument();
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
    render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
    // The modal should have the terminal icon in the header
    expect(screen.getByText('terminal')).toBeInTheDocument();
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
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    it('replays store history as a single write', async () => {
      useStore.getState().appendAgentLog('stream-replay', 'chunk-a');
      useStore.getState().appendAgentLog('stream-replay', 'chunk-b');

      render(<AgentTerminalModal agent={streamAgent('stream-replay')} onClose={vi.fn()} />);
      await flushSetup();

      expect(mockWrite).toHaveBeenCalledTimes(1);
      expect(mockWrite).toHaveBeenCalledWith('chunk-achunk-b');
    });

    it('fits the terminal BEFORE replaying history', async () => {
      useStore.getState().appendAgentLog('stream-fit', 'history');

      render(<AgentTerminalModal agent={streamAgent('stream-fit')} onClose={vi.fn()} />);
      await flushSetup();

      expect(mockFit).toHaveBeenCalled();
      expect(mockWrite).toHaveBeenCalled();
      expect(mockFit.mock.invocationCallOrder[0]).toBeLessThan(
        mockWrite.mock.invocationCallOrder[0]
      );
    });

    it('writes chunks appended after mount exactly once (no duplication)', async () => {
      useStore.getState().appendAgentLog('stream-live', 'old');

      render(<AgentTerminalModal agent={streamAgent('stream-live')} onClose={vi.fn()} />);
      await flushSetup();
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

  describe('context menu', () => {
    beforeEach(() => {
      mockGetSelection.mockReturnValue('');
    });

    it('accepts onSelectionSpawn prop without error', () => {
      expect(() => {
        render(<AgentTerminalModal agent={agent} onClose={vi.fn()} onSelectionSpawn={vi.fn()} />);
      }).not.toThrow();
    });

    it('does not render context menu by default', () => {
      render(<AgentTerminalModal agent={agent} onClose={vi.fn()} />);
      expect(screen.queryByText('Spawn Agent with Selection')).not.toBeInTheDocument();
    });

    it('shows context menu with selection on right-click', async () => {
      mockGetSelection.mockReturnValue('error on line 42');
      const { container } = render(
        <AgentTerminalModal agent={agent} onClose={vi.fn()} onSelectionSpawn={vi.fn()} />
      );

      const xtermContainer = container.querySelector('[data-testid="agent-xterm"]')!;

      // waitFor retries (each wrapped in act), so it waits until setup() attaches
      // the contextmenu listener and the React state update is flushed.
      await waitFor(() => {
        fireEvent.contextMenu(xtermContainer);
        expect(screen.getByText('Spawn Agent with Selection')).toBeInTheDocument();
      });
    });

    it('does not show context menu when there is no selection', async () => {
      mockGetSelection.mockReturnValue('');
      const { container } = render(
        <AgentTerminalModal agent={agent} onClose={vi.fn()} onSelectionSpawn={vi.fn()} />
      );

      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      act(() => {
        fireEvent.contextMenu(container.querySelector('[data-testid="agent-xterm"]')!);
      });

      expect(screen.queryByText('Spawn Agent with Selection')).not.toBeInTheDocument();
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
  });
});
