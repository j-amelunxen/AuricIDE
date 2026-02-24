import { invoke } from './invoke';

export interface McpStatusInfo {
  status: 'running' | 'stopped';
  pid: number | null;
}

export async function startMcp(projectPath: string): Promise<McpStatusInfo> {
  return await invoke<McpStatusInfo>('start_mcp', { projectPath });
}

export async function stopMcp(): Promise<void> {
  await invoke('stop_mcp');
}

export async function mcpStatus(): Promise<McpStatusInfo> {
  return await invoke<McpStatusInfo>('mcp_status');
}
