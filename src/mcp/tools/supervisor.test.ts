import { afterEach, describe, expect, it, vi } from 'vitest';
import { FastMCP, UserError } from 'fastmcp';
import type { z } from 'zod';
import fixtures from '../../lib/agents/agentControl.fixtures.json';
import linkFixtures from '../../lib/agents/supervisorLink.fixtures.json';
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
  send_agent_input: 'send_input',
  kill_agent: 'kill',
  remove_worktree: 'remove_worktree',
  dismiss_agent: 'dismiss',
  link_policy_get: 'link_policy_get',
  link_policy_propose: 'link_policy_propose',
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

  it('map each tool onto its socket method', async () => {
    const call = vi.fn(async () => ({})) as unknown as ControlCaller;
    const tools = capture(call);
    for (const [tool, method] of Object.entries(TOOL_METHODS)) {
      await tools.get(tool)!.execute({ agentId: 'agent-5' });
      expect(vi.mocked(call).mock.lastCall?.[0]).toBe(method);
    }
  });

  it('keeps spawn and await guidance consistent with finish pingbacks', () => {
    const tools = capture(vi.fn() as unknown as ControlCaller);
    for (const name of ['spawn_agent', 'await_agent_result']) {
      const description = tools.get(name)!.description;
      expect(description).toContain('finish pingback');
      expect(description).not.toMatch(/loop on await_agent_result|repeat on done false/);
    }
  });

  it('spawn_agent requires only headless, takes a model reason, and neither role nor mode', () => {
    const spawn = capture(vi.fn() as unknown as ControlCaller).get('spawn_agent')!;
    const shape = spawn.parameters.shape as Record<string, z.ZodType>;
    for (const required of scope.requiredSpawnParams) {
      expect(shape[required], required).toBeDefined();
      expect(shape[required].safeParse(undefined).success, required).toBe(false);
    }
    for (const refused of Object.keys(scope.refusedParams)) {
      expect(shape[refused], refused).toBeUndefined();
    }
    const base = { projectPath: '/tmp/example-project', prompt: 'x' };
    expect(spawn.parameters.safeParse({ ...base, provider: 'claude' }).success).toBe(false);
    expect(spawn.parameters.safeParse({ ...base, headless: true }).success).toBe(true);
    const large = { ...base, headless: true, provider: 'claude', model: 'opus' };
    expect(spawn.parameters.parse({ ...large, modelReason: 'Architecture' })).toMatchObject({
      modelReason: 'Architecture',
    });
  });

  it('list_projects narrows to one project and answers in compact JSON', async () => {
    const answer = fixtures.additionalResponses.find(
      (entry) => entry.method === 'list_projects' && entry.raw.ok
    )!.raw.result;
    const call = vi.fn(async () => answer) as unknown as ControlCaller;
    const list = capture(call).get('list_projects')!;
    expect(list.parameters.safeParse({}).success).toBe(true);
    const text = await list.execute(list.parameters.parse({ project: 'example-project' }));
    expect(vi.mocked(call).mock.lastCall).toEqual([
      'list_projects',
      { project: 'example-project' },
    ]);
    expect(text).toBe(JSON.stringify(answer));
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

  it('link_policy_propose offers exactly the ops the link contract knows', () => {
    const propose = capture(vi.fn() as unknown as ControlCaller).get('link_policy_propose')!;
    const changes = (propose.parameters.shape as Record<string, z.ZodType>).changes;
    const ops = linkFixtures.proposals.ops.map((op) => ({ op }));
    // Each op is accepted by the discriminator (its own fields may still be missing).
    for (const { op } of ops) {
      const result = changes.safeParse([{ op }]);
      const issues = result.success ? [] : result.error.issues;
      expect(
        issues.some((issue) => issue.code === 'invalid_union'),
        op
      ).toBe(false);
    }
    expect(changes.safeParse([{ op: 'remove_project', project: '/p' }]).success).toBe(false);
  });

  it('link_policy_propose forwards the parsed changes to the socket', async () => {
    const call = vi.fn(async () => ({})) as unknown as ControlCaller;
    const propose = capture(call).get('link_policy_propose')!;
    const args = propose.parameters.parse({
      reason: 'Scenes in every project',
      changes: [
        {
          op: 'set_default_job_kind',
          jobKind: { kind: 'scene.draw', globalInstructions: 'scene.draw.md' },
        },
      ],
    });
    await propose.execute(args);
    expect(vi.mocked(call).mock.lastCall).toEqual(['link_policy_propose', args]);
  });
});
