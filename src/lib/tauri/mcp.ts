import { invoke } from './invoke';

export interface McpLaunchSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export async function mcpLaunchSpec(projectPath: string): Promise<McpLaunchSpec> {
  return invoke<McpLaunchSpec>('mcp_launch_spec', { projectPath });
}

export interface McpStatusInfo {
  status: 'running' | 'stopped';
  phase: 'running' | 'stopped' | 'error';
  pid: number | null;
  projectPath: string | null;
  error: string | null;
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
