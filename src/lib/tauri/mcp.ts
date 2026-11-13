import { invoke } from './invoke';

export interface McpLaunchSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export async function mcpLaunchSpec(projectPath: string): Promise<McpLaunchSpec> {
  return invoke<McpLaunchSpec>('mcp_launch_spec', { projectPath });
}
