import type { StateCreator } from 'zustand';
import { loadAppConfig, setAppConfigValue } from '../config/appConfig';
import { mcpStatus, startMcp, stopMcp, type McpStatusInfo } from '../tauri/mcp';

export type McpPhase = McpStatusInfo['phase'] | 'starting' | 'stopping';

export interface McpSlice {
  mcpServerRunning: boolean;
  mcpAutoStart: boolean;
  mcpPid: number | null;
  mcpPhase: McpPhase;
  mcpProjectPath: string | null;
  mcpError: string | null;
  setMcpServerRunning: (running: boolean) => void;
  setMcpAutoStart: (autoStart: boolean) => void;
  setMcpPid: (pid: number | null) => void;
  startMcpServer: (projectPath: string) => Promise<void>;
  stopMcpServer: () => Promise<void>;
  refreshMcpStatus: () => Promise<void>;
  reconcileMcpForWorkspace: (projectPath: string | null) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stateFromStatus(info: McpStatusInfo) {
  return {
    mcpServerRunning: info.status === 'running',
    mcpPhase: info.phase,
    mcpPid: info.pid,
    mcpProjectPath: info.projectPath,
    mcpError: info.error,
  };
}

export const createMcpSlice: StateCreator<McpSlice> = (set, get) => {
  let operationGeneration = 0;
  let reconciliationGeneration = 0;
  let reconciliationQueue = Promise.resolve();
  const isLatest = (operation: number) => operation === operationGeneration;

  return {
    mcpServerRunning: false,
    mcpAutoStart: loadAppConfig().mcpAutoStart,
    mcpPid: null,
    mcpPhase: 'stopped',
    mcpProjectPath: null,
    mcpError: null,

    setMcpServerRunning: (running) => set({ mcpServerRunning: running }),
    setMcpAutoStart: (autoStart) => {
      setAppConfigValue('mcpAutoStart', autoStart);
      set({ mcpAutoStart: autoStart });
    },
    setMcpPid: (pid) => set({ mcpPid: pid }),

    startMcpServer: async (projectPath) => {
      const operation = ++operationGeneration;
      set({ mcpPhase: 'starting', mcpError: null });
      try {
        const info = await startMcp(projectPath);
        if (isLatest(operation)) set(stateFromStatus(info));
      } catch (error) {
        if (isLatest(operation)) {
          set({ mcpPhase: 'error', mcpError: errorMessage(error) });
        }
      }
    },

    stopMcpServer: async () => {
      const operation = ++operationGeneration;
      set({ mcpPhase: 'stopping', mcpError: null });
      try {
        await stopMcp();
        if (isLatest(operation)) {
          set({
            mcpServerRunning: false,
            mcpPhase: 'stopped',
            mcpPid: null,
            mcpProjectPath: null,
            mcpError: null,
          });
        }
      } catch (error) {
        if (isLatest(operation)) {
          set({ mcpPhase: 'error', mcpError: errorMessage(error) });
        }
      }
    },

    refreshMcpStatus: async () => {
      const operation = ++operationGeneration;
      try {
        const info = await mcpStatus();
        if (isLatest(operation)) set(stateFromStatus(info));
      } catch (error) {
        if (isLatest(operation)) {
          set({ mcpPhase: 'error', mcpError: errorMessage(error) });
        }
      }
    },

    reconcileMcpForWorkspace: async (projectPath) => {
      const reconciliation = ++reconciliationGeneration;
      // A workspace intent supersedes any in-flight start/stop/status result,
      // even before its queued reconciliation reaches the backend.
      operationGeneration += 1;
      const run = async () => {
        if (reconciliation !== reconciliationGeneration) return;
        if (!projectPath) {
          await get().stopMcpServer();
        } else if (get().mcpAutoStart) {
          await get().startMcpServer(projectPath);
        } else {
          await get().refreshMcpStatus();
          if (reconciliation !== reconciliationGeneration) return;
          const current = get();
          if (current.mcpServerRunning && current.mcpProjectPath !== projectPath) {
            await current.startMcpServer(projectPath);
          }
        }
      };
      const queued = reconciliationQueue.then(run, run);
      reconciliationQueue = queued.then(
        () => undefined,
        () => undefined
      );
      await queued;
    },
  };
};
