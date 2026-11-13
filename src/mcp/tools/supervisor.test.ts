import { afterEach, describe, expect, it, vi } from 'vitest';
import { FastMCP, UserError } from 'fastmcp';
import type { z } from 'zod';
import fixtures from '../../lib/agents/agentControl.fixtures.json';
import linkFixtures from '../../lib/agents/supervisorLink.fixtures.json';
import tokenFixtures from '../../lib/agents/capabilityTokens.fixtures.json';
import { ControlError, parseControlResponse } from '../../lib/agents/agentControl.contract';
import { createSupervisorServer } from '../server';
import type { ControlCaller } from '../controlTypes';
import { registerSupervisorTools } from './supervisor';

/** Tool name → socket method, as the design doc's supervisor tool table names them. */
const TOOL_METHODS: Record<string, string> = {
  list_projects: 'list_projects',
  spawn_agent: 'spawn',
  list_my_agents: 'list_agents',
  read_agent_output: 'read_output',
  read_agent_report: 'read_report',
  await_agent_result: 'await_result',
  send_agent_input: 'send_input',
  kill_agent: 'kill',
  remove_worktree: 'remove_worktree',
  dismiss_agent: 'dismiss',
  link_policy_get: 'link_policy_get',
  link_policy_propose: 'link_policy_propose',
  pm_tools: 'pm_target',
  pm_call: 'pm_target',
  list_quota_blocks: 'list_quota_blocks',
  set_quota_block: 'set_quota_block',
  clear_quota_block: 'clear_quota_block',
  register_external_agent: 'external_register',
  stop_external_agent: 'external_stop',
  list_external_agents: 'external_list',
  mark_agent_waiting: 'mark_waiting',
  clear_agent_waiting: 'clear_waiting',
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
    expect([...new Set(Object.values(TOOL_METHODS))].sort()).toEqual([...scope.methods].sort());
  });

  // testuuid: t_6b1r4cgf covers: el_8822ww84,el_rqg3vpjg,el_sf1eca3c,el_d93xrgtp,el_h6np2qvy categories: happy level: unit
  it('map each tool onto its socket method', async () => {
    const call = vi.fn(async () => ({})) as unknown as ControlCaller;
    const tools = capture(call);
    for (const [tool, method] of Object.entries(TOOL_METHODS)) {
      // The stand-in's answer is no project path, so a PM tool stops right after asking.
      await tools
        .get(tool)!
        .execute({ agentId: 'agent-5' })
        .catch(() => {});
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

  /* testuuid: t_h3kw9pqa covers: el_extreg01,el_extstp01,el_extlst01 categories: happy,negative level: unit */
  it('offers the external run tools with their rules in the description, refusing a prompt', () => {
    const tools = capture(vi.fn() as unknown as ControlCaller);
    const register = tools.get('register_external_agent')!;
    const stop = tools.get('stop_external_agent')!;
    expect(register.description).toMatch(/safe to call again/i);
    expect(register.description).toContain('new runId');
    expect(stop.description).toMatch(/as reported/i);
    const base = {
      externalId: 'box-7',
      projectPath: '/tmp/example-project',
      name: 'Fix the parser',
      provider: 'claude',
      state: 'running',
    };
    expect(register.parameters.safeParse(base).success).toBe(true);
    expect(register.parameters.safeParse({ ...base, prompt: 'do it' }).success).toBe(false);
    expect(stop.parameters.safeParse({ externalId: 'box-7', reason: 'x' }).success).toBe(false);
  });

  it('documents and checks the capability token, force and end reason', () => {
    const tools = capture(vi.fn() as unknown as ControlCaller);
    const register = tools.get('register_external_agent')!;
    const stop = tools.get('stop_external_agent')!;
    expect(register.description).toMatch(/capability token, shown once/);
    expect(register.description).toContain('tokenTtlSeconds');
    expect(register.description).toContain('newToken');
    expect(stop.description).toMatch(/never accepted with a token/);
    expect(stop.description).toContain('endReason');

    const token = `auric_cap_${'A'.repeat(43)}`;
    const ok = (params: object) => stop.parameters.safeParse(params).success;
    expect(ok({ externalId: 'box-7', token, endReason: 'reaped' })).toBe(true);
    expect(ok({ externalId: 'box-7', force: true, finishedAt: 1, endReason: 'lost' })).toBe(true);
    expect(ok({ externalId: 'box-7', token, force: true })).toBe(false);
    const malformed = tokenFixtures.tokenShape.reject[2];
    expect(ok({ externalId: 'box-7', token: malformed })).toBe(false);
    expect(ok({ externalId: 'box-7', endReason: 'it broke' })).toBe(false);
  });

  it('passes an issued token through to the model unchanged', async () => {
    const answer = fixtures.responses.external_register.result;
    const issued = {
      ...answer,
      token: {
        token: `auric_cap_${'b'.repeat(43)}`,
        kind: 'external_run',
        resourceId: answer.agent.id,
        actions: ['external_stop'],
        expiresAt: 1_800_000_000_000,
      },
    };
    expect(parseControlResponse('external_register', { id: 1, ok: true, result: issued })).toEqual({
      ok: true,
      result: issued,
    });
    const call = vi.fn(async () => issued) as unknown as ControlCaller;
    const text = await capture(call).get('register_external_agent')!.execute({
      externalId: 'box-7',
      projectPath: '/tmp/example-project',
      name: 'Fix the parser',
      provider: 'claude',
      state: 'running',
      tokenTtlSeconds: 3600,
    });
    expect(vi.mocked(call).mock.lastCall?.[1]).toMatchObject({ tokenTtlSeconds: 3600 });
    expect(JSON.parse(text)).toEqual(issued);
  });

  it("passes what the model sent to the socket and answers with the socket's words", async () => {
    const answer = { agents: [] };
    const call = vi.fn(async () => answer) as unknown as ControlCaller;
    const text = await capture(call).get('list_external_agents')!.execute({});
    expect(vi.mocked(call).mock.lastCall).toEqual(['external_list', {}]);
    expect(JSON.parse(text)).toEqual(answer);
  });

  /* testuuid: t_wt4mk7qx covers: el_markwt01,el_clrwt001 categories: happy,negative level: unit */
  it('park and release an agent on purpose, with the rules in the description', async () => {
    const call = vi.fn(async () => ({})) as unknown as ControlCaller;
    const tools = capture(call);
    const mark = tools.get('mark_agent_waiting')!;
    const clear = tools.get('clear_agent_waiting')!;
    for (const phrase of ['2 h', '24 h', 'new', 'question', 'finishes', 'Stall escalated']) {
      expect(mark.description).toContain(phrase);
    }
    expect(mark.parameters.safeParse({ agentId: 'agent-5', reason: 'deploy' }).success).toBe(true);
    expect(
      mark.parameters.safeParse({ agentId: 'agent-5', reason: 'deploy', until: '90m' }).success
    ).toBe(true);
    for (const bad of [
      { agentId: 'agent-5' },
      { agentId: 'agent-5', reason: '  ' },
      { reason: 'deploy' },
      { agentId: 'agent-5', reason: 'deploy', supervisor: 'other' },
    ]) {
      expect(mark.parameters.safeParse(bad).success).toBe(false);
    }
    await mark.execute({ agentId: 'agent-5', reason: 'deploy', until: '2h' });
    expect(vi.mocked(call).mock.lastCall).toEqual([
      'mark_waiting',
      { agentId: 'agent-5', reason: 'deploy', until: '2h' },
    ]);
    await clear.execute({ agentId: 'agent-5' });
    expect(vi.mocked(call).mock.lastCall).toEqual(['clear_waiting', { agentId: 'agent-5' }]);
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
