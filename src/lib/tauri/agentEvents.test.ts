import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockListen = vi.fn().mockResolvedValue(vi.fn());

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}));

import {
  onAgentOutput,
  onAgentPtyResized,
  onAgentStatus,
  type AgentOutputEvent,
  type AgentStatusEvent,
} from './agentEvents';

describe('agentEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockResolvedValue(vi.fn());
  });

  describe('onAgentOutput', () => {
    it('sets up event listener via listen', async () => {
      onAgentOutput(vi.fn());
      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalledWith('agent-output', expect.any(Function));
      });
    });

    it('returns an unsubscribe function', () => {
      const unsubscribe = onAgentOutput(vi.fn());
      expect(typeof unsubscribe).toBe('function');
    });

    it('calls callback with event payload when event fires', async () => {
      const callback = vi.fn();
      const event: AgentOutputEvent = {
        agentId: 'agent-1',
        stream: 'stdout',
        line: 'hello world',
        timestamp: 1700000000000,
        endOffset: 11,
      };

      mockListen.mockImplementation(
        (_eventName: string, handler: (event: { payload: AgentOutputEvent }) => void) => {
          handler({ payload: event });
          return Promise.resolve(vi.fn());
        }
      );

      onAgentOutput(callback);

      await vi.waitFor(() => {
        expect(callback).toHaveBeenCalledWith(event);
      });
    });

    it('invokes unlisten when unsubscribe is called', async () => {
      const mockUnlisten = vi.fn();
      mockListen.mockResolvedValue(mockUnlisten);

      const unsubscribe = onAgentOutput(vi.fn());

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });
      await new Promise((r) => setTimeout(r, 0));

      unsubscribe();
      expect(mockUnlisten).toHaveBeenCalled();
    });
  });

  describe('onAgentStatus', () => {
    it('sets up event listener via listen', async () => {
      onAgentStatus(vi.fn());
      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalledWith('agent-status', expect.any(Function));
      });
    });

    it('returns an unsubscribe function', () => {
      const unsubscribe = onAgentStatus(vi.fn());
      expect(typeof unsubscribe).toBe('function');
    });

    it('calls callback with event payload when event fires', async () => {
      const callback = vi.fn();
      const event: AgentStatusEvent = {
        agentId: 'agent-1',
        status: 'idle',
        exitCode: 0,
      };

      mockListen.mockImplementation(
        (_eventName: string, handler: (event: { payload: AgentStatusEvent }) => void) => {
          handler({ payload: event });
          return Promise.resolve(vi.fn());
        }
      );

      onAgentStatus(callback);

      await vi.waitFor(() => {
        expect(callback).toHaveBeenCalledWith(event);
      });
    });

    it('invokes unlisten when unsubscribe is called', async () => {
      const mockUnlisten = vi.fn();
      mockListen.mockResolvedValue(mockUnlisten);

      const unsubscribe = onAgentStatus(vi.fn());

      await vi.waitFor(() => {
        expect(mockListen).toHaveBeenCalled();
      });
      await new Promise((r) => setTimeout(r, 0));

      unsubscribe();
      expect(mockUnlisten).toHaveBeenCalled();
    });
  });
});

describe('onAgentPtyResized', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockResolvedValue(vi.fn());
  });

  it('listens under the name Rust emits and passes the payload on', async () => {
    const callback = vi.fn();
    mockListen.mockImplementation(
      (_eventName: string, handler: (event: { payload: unknown }) => void) => {
        handler({ payload: { agentId: 'agent-1', rows: 50, cols: 160 } });
        return Promise.resolve(vi.fn());
      }
    );

    onAgentPtyResized(callback);

    await vi.waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith('agent-pty-resized', expect.any(Function));
      expect(callback).toHaveBeenCalledWith({ agentId: 'agent-1', rows: 50, cols: 160 });
    });
  });
});
