import type { StateCreator } from 'zustand';

export interface McpSlice {
  mcpServerRunning: boolean;
  mcpAutoStart: boolean;
  mcpPid: number | null;
  setMcpServerRunning: (running: boolean) => void;
  setMcpAutoStart: (autoStart: boolean) => void;
  setMcpPid: (pid: number | null) => void;
  startMcpServer: (projectPath: string) => Promise<void>;
  stopMcpServer: () => Promise<void>;
  refreshMcpStatus: () => Promise<void>;
}

export const createMcpSlice: StateCreator<McpSlice> = (set) => ({
  mcpServerRunning: false,
  mcpAutoStart: false,
  mcpPid: null,

  setMcpServerRunning: (running) => set({ mcpServerRunning: running }),
  setMcpAutoStart: (autoStart) => set({ mcpAutoStart: autoStart }),
  setMcpPid: (pid) => set({ mcpPid: pid }),

  startMcpServer: async (projectPath) => {
    try {
      const { startMcp } = await import('../tauri/mcp');
      const info = await startMcp(projectPath);
      set({ mcpServerRunning: info.status === 'running', mcpPid: info.pid });
    } catch {
      set({ mcpServerRunning: false, mcpPid: null });
    }
  },

  stopMcpServer: async () => {
    try {
      const { stopMcp } = await import('../tauri/mcp');
      await stopMcp();
    } catch {
      // Server may already be stopped
    }
    set({ mcpServerRunning: false, mcpPid: null });
  },

  refreshMcpStatus: async () => {
    try {
      const { mcpStatus } = await import('../tauri/mcp');
      const info = await mcpStatus();
      set({ mcpServerRunning: info.status === 'running', mcpPid: info.pid });
    } catch {
      set({ mcpServerRunning: false, mcpPid: null });
    }
  },
});
