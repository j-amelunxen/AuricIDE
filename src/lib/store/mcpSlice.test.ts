import { describe, expect, it, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createMcpSlice, type McpSlice } from './mcpSlice';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const runningInfo = (pid: number, projectPath = '/my/project') => ({
  status: 'running' as const,
  phase: 'running' as const,
  pid,
  projectPath,
  error: null,
});

const stoppedInfo = {
  status: 'stopped' as const,
  phase: 'stopped' as const,
  pid: null,
  projectPath: null,
  error: null,
};

const mockStartMcp = vi.fn();
const mockStopMcp = vi.fn();
const mockMcpStatus = vi.fn();

vi.mock('../tauri/mcp', () => ({
  startMcp: (...args: unknown[]) => mockStartMcp(...args),
  stopMcp: (...args: unknown[]) => mockStopMcp(...args),
  mcpStatus: (...args: unknown[]) => mockMcpStatus(...args),
}));

function createTestStore() {
  return create<McpSlice>()((...a) => ({ ...createMcpSlice(...a) }));
}

describe('mcpSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('has correct initial state', () => {
    const store = createTestStore();
    expect(store.getState().mcpServerRunning).toBe(false);
    expect(store.getState().mcpAutoStart).toBe(false);
    expect(store.getState().mcpPid).toBeNull();
    expect(store.getState().mcpPhase).toBe('stopped');
    expect(store.getState().mcpProjectPath).toBeNull();
    expect(store.getState().mcpError).toBeNull();
  });

  it('setMcpServerRunning updates state', () => {
    const store = createTestStore();
    store.getState().setMcpServerRunning(true);
    expect(store.getState().mcpServerRunning).toBe(true);
  });

  it('setMcpAutoStart updates state', () => {
    const store = createTestStore();
    store.getState().setMcpAutoStart(true);
    expect(store.getState().mcpAutoStart).toBe(true);
    expect(localStorage.getItem('auric.mcp.auto-start')).toBe('true');
  });

  it('loads the global auto-start preference when the slice is created', () => {
    localStorage.setItem('auric.mcp.auto-start', 'true');

    const store = createTestStore();

    expect(store.getState().mcpAutoStart).toBe(true);
  });

  it('setMcpPid updates state', () => {
    const store = createTestStore();
    store.getState().setMcpPid(1234);
    expect(store.getState().mcpPid).toBe(1234);
  });

  it('startMcpServer sets running state on success', async () => {
    mockStartMcp.mockResolvedValueOnce(runningInfo(5678));
    const store = createTestStore();
    await store.getState().startMcpServer('/my/project');
    expect(store.getState().mcpServerRunning).toBe(true);
    expect(store.getState().mcpPid).toBe(5678);
    expect(store.getState().mcpProjectPath).toBe('/my/project');
    expect(mockStartMcp).toHaveBeenCalledWith('/my/project');
  });

  it('startMcpServer surfaces failure without fabricating a stopped server', async () => {
    mockStartMcp.mockRejectedValueOnce(new Error('fail'));
    const store = createTestStore();
    store.setState({
      mcpServerRunning: true,
      mcpPid: 1234,
      mcpProjectPath: '/previous/project',
    });
    await store.getState().startMcpServer('/my/project');
    expect(store.getState().mcpServerRunning).toBe(true);
    expect(store.getState().mcpPid).toBe(1234);
    expect(store.getState().mcpPhase).toBe('error');
    expect(store.getState().mcpError).toBe('fail');
  });

  it('stopMcpServer resets state', async () => {
    mockStopMcp.mockResolvedValueOnce(undefined);
    const store = createTestStore();
    store.getState().setMcpServerRunning(true);
    store.getState().setMcpPid(1234);
    await store.getState().stopMcpServer();
    expect(store.getState().mcpServerRunning).toBe(false);
    expect(store.getState().mcpPid).toBeNull();
  });

  it('stopMcpServer surfaces failure and preserves the tracked running state', async () => {
    mockStopMcp.mockRejectedValueOnce(new Error('kill failed'));
    const store = createTestStore();
    store.setState({ mcpServerRunning: true, mcpPid: 1234, mcpProjectPath: '/my/project' });
    await store.getState().stopMcpServer();
    expect(store.getState().mcpServerRunning).toBe(true);
    expect(store.getState().mcpPid).toBe(1234);
    expect(store.getState().mcpPhase).toBe('error');
    expect(store.getState().mcpError).toBe('kill failed');
  });

  it('refreshMcpStatus updates state from backend', async () => {
    mockMcpStatus.mockResolvedValueOnce(runningInfo(9999));
    const store = createTestStore();
    await store.getState().refreshMcpStatus();
    expect(store.getState().mcpServerRunning).toBe(true);
    expect(store.getState().mcpPid).toBe(9999);
  });

  it('refreshMcpStatus surfaces failure without fabricating stopped', async () => {
    mockMcpStatus.mockRejectedValueOnce(new Error('fail'));
    const store = createTestStore();
    store.setState({ mcpServerRunning: true, mcpPid: 9999 });
    await store.getState().refreshMcpStatus();
    expect(store.getState().mcpServerRunning).toBe(true);
    expect(store.getState().mcpPid).toBe(9999);
    expect(store.getState().mcpPhase).toBe('error');
    expect(store.getState().mcpError).toBe('fail');
  });

  it('ignores a stale start completion after a newer stop intent', async () => {
    const start = deferred<ReturnType<typeof runningInfo>>();
    mockStartMcp.mockReturnValueOnce(start.promise);
    mockStopMcp.mockResolvedValueOnce(undefined);
    const store = createTestStore();

    const starting = store.getState().startMcpServer('/my/project');
    const stopping = store.getState().stopMcpServer();
    await stopping;
    start.resolve(runningInfo(4444));
    await starting;

    expect(store.getState().mcpServerRunning).toBe(false);
    expect(store.getState().mcpPid).toBeNull();
    expect(store.getState().mcpError).toBeNull();
    expect(store.getState().mcpPhase).toBe('stopped');
  });

  it('ignores a stale status completion after a newer start intent', async () => {
    const status = deferred<typeof stoppedInfo>();
    mockMcpStatus.mockReturnValueOnce(status.promise);
    mockStartMcp.mockResolvedValueOnce(runningInfo(5555, '/repo/beta'));
    const store = createTestStore();

    const refreshing = store.getState().refreshMcpStatus();
    await store.getState().startMcpServer('/repo/beta');
    status.resolve(stoppedInfo);
    await refreshing;

    expect(store.getState().mcpServerRunning).toBe(true);
    expect(store.getState().mcpPid).toBe(5555);
    expect(store.getState().mcpProjectPath).toBe('/repo/beta');
  });

  it('reconciles auto-start to the current workspace and stops when none is open', async () => {
    mockStartMcp.mockResolvedValueOnce(runningInfo(1111, '/repo/alpha'));
    mockStopMcp.mockResolvedValueOnce(undefined);
    const store = createTestStore();
    store.getState().setMcpAutoStart(true);

    await store.getState().reconcileMcpForWorkspace('/repo/alpha');
    await store.getState().reconcileMcpForWorkspace(null);

    expect(mockStartMcp).toHaveBeenCalledWith('/repo/alpha');
    expect(mockStopMcp).toHaveBeenCalledOnce();
  });

  it('rebinds an already-running manual server when the workspace changes', async () => {
    mockMcpStatus.mockResolvedValueOnce(runningInfo(1111, '/repo/alpha'));
    mockStartMcp.mockResolvedValueOnce(runningInfo(2222, '/repo/beta'));
    const store = createTestStore();

    await store.getState().reconcileMcpForWorkspace('/repo/beta');

    expect(mockMcpStatus).toHaveBeenCalledOnce();
    expect(mockStartMcp).toHaveBeenCalledWith('/repo/beta');
    expect(store.getState().mcpProjectPath).toBe('/repo/beta');
    expect(store.getState().mcpPid).toBe(2222);
  });

  it('serializes rapid workspace changes and settles on the newest workspace', async () => {
    const alpha = deferred<ReturnType<typeof runningInfo>>();
    mockStartMcp
      .mockReturnValueOnce(alpha.promise)
      .mockResolvedValueOnce(runningInfo(2222, '/repo/beta'));
    const store = createTestStore();
    store.getState().setMcpAutoStart(true);

    const openingAlpha = store.getState().reconcileMcpForWorkspace('/repo/alpha');
    await vi.waitFor(() => expect(mockStartMcp).toHaveBeenCalledWith('/repo/alpha'));
    const openingBeta = store.getState().reconcileMcpForWorkspace('/repo/beta');
    expect(mockStartMcp).toHaveBeenCalledTimes(1);

    alpha.resolve(runningInfo(1111, '/repo/alpha'));
    await Promise.all([openingAlpha, openingBeta]);

    expect(mockStartMcp).toHaveBeenNthCalledWith(2, '/repo/beta');
    expect(store.getState().mcpProjectPath).toBe('/repo/beta');
    expect(store.getState().mcpPid).toBe(2222);
  });
});
