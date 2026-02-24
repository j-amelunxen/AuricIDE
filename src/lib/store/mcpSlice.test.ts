import { describe, expect, it, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createMcpSlice, type McpSlice } from './mcpSlice';

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
  });

  it('has correct initial state', () => {
    const store = createTestStore();
    expect(store.getState().mcpServerRunning).toBe(false);
    expect(store.getState().mcpAutoStart).toBe(false);
    expect(store.getState().mcpPid).toBeNull();
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
  });

  it('setMcpPid updates state', () => {
    const store = createTestStore();
    store.getState().setMcpPid(1234);
    expect(store.getState().mcpPid).toBe(1234);
  });

  it('startMcpServer sets running state on success', async () => {
    mockStartMcp.mockResolvedValueOnce({ status: 'running', pid: 5678 });
    const store = createTestStore();
    await store.getState().startMcpServer('/my/project');
    expect(store.getState().mcpServerRunning).toBe(true);
    expect(store.getState().mcpPid).toBe(5678);
    expect(mockStartMcp).toHaveBeenCalledWith('/my/project');
  });

  it('startMcpServer resets state on failure', async () => {
    mockStartMcp.mockRejectedValueOnce(new Error('fail'));
    const store = createTestStore();
    store.getState().setMcpServerRunning(true);
    await store.getState().startMcpServer('/my/project');
    expect(store.getState().mcpServerRunning).toBe(false);
    expect(store.getState().mcpPid).toBeNull();
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

  it('stopMcpServer resets state even on failure', async () => {
    mockStopMcp.mockRejectedValueOnce(new Error('not running'));
    const store = createTestStore();
    store.getState().setMcpServerRunning(true);
    await store.getState().stopMcpServer();
    expect(store.getState().mcpServerRunning).toBe(false);
  });

  it('refreshMcpStatus updates state from backend', async () => {
    mockMcpStatus.mockResolvedValueOnce({ status: 'running', pid: 9999 });
    const store = createTestStore();
    await store.getState().refreshMcpStatus();
    expect(store.getState().mcpServerRunning).toBe(true);
    expect(store.getState().mcpPid).toBe(9999);
  });

  it('refreshMcpStatus resets on failure', async () => {
    mockMcpStatus.mockRejectedValueOnce(new Error('fail'));
    const store = createTestStore();
    store.getState().setMcpServerRunning(true);
    await store.getState().refreshMcpStatus();
    expect(store.getState().mcpServerRunning).toBe(false);
  });
});
