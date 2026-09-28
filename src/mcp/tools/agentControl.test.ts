import { afterEach, describe, expect, it, vi } from 'vitest';
import { FastMCP, UserError } from 'fastmcp';
import type Database from 'better-sqlite3';
import fixtures from '../../lib/agents/agentControl.fixtures.json';
import { ControlError } from '../../lib/agents/agentControl.contract';
import { createTestDb } from '../db';
import { createControlServer, createMcpServer } from '../server';
import { registerAgentControlTools, type ControlCaller } from './agentControl';

const CONTROL_TOOLS = [
  'kill_agent',
  'list_agents',
  'list_projects',
  'read_agent_output',
  'send_agent_input',
  'spawn_agent',
];

interface CapturedTool {
  name: string;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

function capture(call: ControlCaller): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  const server = {
    addTool: (tool: CapturedTool) => tools.set(tool.name, tool),
  } as unknown as FastMCP;
  registerAgentControlTools(server, call);
  return tools;
}

describe('agent control tools', () => {
  it('map each tool onto its socket method and return the result as JSON', async () => {
    const call = vi.fn(async () => fixtures.responses.kill.result) as unknown as ControlCaller;
    const tools = capture(call);

    const text = await tools.get('kill_agent')!.execute({ agentId: 'agent-3' });
    expect(JSON.parse(text)).toEqual({ agentId: 'agent-3', killed: true });
    expect(call).toHaveBeenCalledWith('kill', { agentId: 'agent-3' });

    const methods: Record<string, string> = {
      list_agents: 'list_agents',
      read_agent_output: 'read_output',
      send_agent_input: 'send_input',
      spawn_agent: 'spawn',
      list_projects: 'list_projects',
    };
    for (const [tool, method] of Object.entries(methods)) {
      await tools.get(tool)!.execute({});
      expect(call).toHaveBeenLastCalledWith(method, {});
    }
  });

  it('turn a socket error into a tool error "<code>: <message>"', async () => {
    const tools = capture(async () => {
      throw new ControlError('headless_no_stdin', 'agent-2 runs headless and does not read input');
    });
    const error = await tools
      .get('send_agent_input')!
      .execute({ agentId: 'agent-2', text: 'x' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserError);
    expect((error as Error).message).toBe(
      'headless_no_stdin: agent-2 runs headless and does not read input'
    );
  });
});

describe('server modes', () => {
  let db: Database.Database | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    db?.close();
    db = null;
  });

  function registeredBy(create: () => unknown): string[] {
    const names: string[] = [];
    vi.spyOn(FastMCP.prototype, 'addTool').mockImplementation(function (tool) {
      names.push(tool.name);
    });
    create();
    return names.sort();
  }

  it('the control server offers only the control tools', () => {
    expect(registeredBy(() => createControlServer())).toEqual(CONTROL_TOOLS);
  });

  it('the project server offers none of them', () => {
    db = createTestDb();
    const names = registeredBy(() => createMcpServer(db!, '/tmp/test-project'));
    expect(names.length).toBeGreaterThan(0);
    for (const tool of CONTROL_TOOLS) expect(names).not.toContain(tool);
  });
});
