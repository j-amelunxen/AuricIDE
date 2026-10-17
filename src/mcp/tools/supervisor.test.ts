import { afterEach, describe, expect, it, vi } from 'vitest';
import { FastMCP, UserError } from 'fastmcp';
import type { z } from 'zod';
import fixtures from '../../lib/agents/agentControl.fixtures.json';
import { ControlError } from '../../lib/agents/agentControl.contract';
import { createSupervisorServer } from '../server';
import type { ControlCaller } from './agentControl';
import { registerSupervisorTools } from './supervisor';

/** Tool name → socket method, as the design doc's supervisor tool table names them. */
const TOOL_METHODS: Record<string, string> = {
  list_projects: 'list_projects',
  spawn_agent: 'spawn',
  list_my_agents: 'list_agents',
  read_agent_output: 'read_output',
  await_agent_result: 'await_result',
  kill_agent: 'kill',
  remove_worktree: 'remove_worktree',
};

const scope = fixtures.callerScope.callers.supervisor;

interface CapturedTool {
  name: string;
  description: string;
  parameters: z.ZodObject;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

function capture(call: ControlCaller): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  const server = {
    addTool: (tool: CapturedTool) => tools.set(tool.name, tool),
  } as unknown as FastMCP;
  registerSupervisorTools(server, call);
  return tools;
}

describe('supervisor tools', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cover exactly the methods the caller scope grants a supervisor', () => {
    const tools = capture(vi.fn() as unknown as ControlCaller);
    expect([...tools.keys()].sort()).toEqual(Object.keys(TOOL_METHODS).sort());
    expect(Object.values(TOOL_METHODS).sort()).toEqual([...scope.methods].sort());
  });

  it('offer no way to type into an agent', () => {
    const tools = capture(vi.fn() as unknown as ControlCaller);
    for (const refused of Object.keys(scope.refusedMethods)) {
      expect(Object.values(TOOL_METHODS)).not.toContain(refused);
    }
    expect(tools.has('send_agent_input')).toBe(false);
  });

  it('map each tool onto its socket method', async () => {
    const call = vi.fn(async () => ({})) as unknown as ControlCaller;
    const tools = capture(call);
    for (const [tool, method] of Object.entries(TOOL_METHODS)) {
      await tools.get(tool)!.execute({ agentId: 'agent-5' });
      expect(vi.mocked(call).mock.lastCall?.[0]).toBe(method);
    }
  });

  it('spawn_agent requires provider, model and headless, and takes neither role nor mode', () => {
    const spawn = capture(vi.fn() as unknown as ControlCaller).get('spawn_agent')!;
    const shape = spawn.parameters.shape as Record<string, z.ZodType>;
    for (const required of scope.requiredSpawnParams) {
      expect(shape[required], required).toBeDefined();
      expect(shape[required].safeParse(undefined).success, required).toBe(false);
    }
    for (const refused of Object.keys(scope.refusedParams)) {
      expect(shape[refused], refused).toBeUndefined();
    }
    const base = { projectPath: '/tmp/example-project', prompt: 'x', provider: 'claude' };
    expect(spawn.parameters.safeParse({ ...base, model: 'haiku' }).success).toBe(false);
    expect(spawn.parameters.safeParse({ ...base, model: 'haiku', headless: true }).success).toBe(
      true
    );
  });

  it('report a policy refusal with its code, so the model can name it', async () => {
    const refusal = fixtures.additionalResponses.find(
      (entry) => entry.method === 'spawn' && entry.raw.ok === false
    )!.raw as { error: { code: 'supervisor_denied'; message: string; reason: string } };
    const tools = capture(async () => {
      throw new ControlError(refusal.error.code, refusal.error.message, refusal.error.reason);
    });
    const error = await tools
      .get('spawn_agent')!
      .execute({})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserError);
    expect((error as Error).message).toBe(
      `supervisor_denied (model_not_allowed): ${refusal.error.message}`
    );
  });

  it('the supervisor server offers only these tools', () => {
    const names: string[] = [];
    vi.spyOn(FastMCP.prototype, 'addTool').mockImplementation(function (tool) {
      names.push(tool.name);
    });
    createSupervisorServer();
    expect(names.sort()).toEqual(Object.keys(TOOL_METHODS).sort());
  });
});
