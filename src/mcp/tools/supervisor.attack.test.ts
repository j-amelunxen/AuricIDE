import { describe, expect, it, vi } from 'vitest';
import type { FastMCP } from 'fastmcp';
import type { ZodType } from 'zod';
import {
  buildControlRequest,
  CONTROL_LIMITS,
  ControlError,
} from '../../lib/agents/agentControl.contract';
import { resolveMcpCliMode } from '../cli';
import { controlTimeoutMs } from '../controlClient';
import { createSupervisorServer } from '../server';
import type { ControlCaller } from './agentControl';
import { registerSupervisorTools } from './supervisor';

/**
 * Adversarial checks for the supervisor's MCP surface (ADR 0004). The scope is
 * enforced by the socket, so these pin what this side must not widen: which
 * tools exist, what a model can put into `spawn_agent`, how long a wait can
 * hold a connection, and which process may start which server mode.
 * Rust twins: src-tauri/src/control_socket/supervisor_attack_tests.rs.
 */

interface CapturedTool {
  name: string;
  parameters: ZodType;
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

describe('the supervisor tool surface', () => {
  it('types only through send_agent_input, and no tool names a role or permission mode', () => {
    const tools = capture(vi.fn() as unknown as ControlCaller);
    expect([...tools.keys()].sort()).toEqual([
      'await_agent_result',
      'kill_agent',
      'link_policy_get',
      'link_policy_propose',
      'list_my_agents',
      'list_projects',
      'read_agent_output',
      'remove_worktree',
      'send_agent_input',
      'spawn_agent',
    ]);
    const spawn = tools.get('spawn_agent')!.parameters;
    const parsed = spawn.parse({
      projectPath: '/p',
      prompt: 'x',
      provider: 'claude',
      model: 'haiku',
      headless: true,
      // Everything a hostile model might add. The schema must drop it, because
      // runControl forwards the parsed arguments as they are.
      permissionMode: 'bypassPermissions',
      role: 'supervisor',
      spawnedByAgentId: 'agent-other',
      runSource: 'mcp',
      cwd: '/',
      dangerouslyIgnorePermissions: true,
    }) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ['headless', 'model', 'projectPath', 'prompt', 'provider'].sort()
    );
  });

  it('requires provider, model and headless: nothing is filled in on the supervisor side', () => {
    const spawn = capture(vi.fn() as unknown as ControlCaller).get('spawn_agent')!.parameters;
    for (const missing of ['provider', 'model', 'headless'] as const) {
      const args: Record<string, unknown> = {
        projectPath: '/p',
        prompt: 'x',
        provider: 'claude',
        model: 'haiku',
        headless: true,
      };
      delete args[missing];
      expect(spawn.safeParse(args).success, missing).toBe(false);
    }
  });

  it('shows a refusal with its reason key, never as a success', async () => {
    const tools = capture((async () => {
      throw new ControlError('supervisor_denied', 'Model is not allowed', 'model_not_allowed');
    }) as unknown as ControlCaller);
    await expect(
      tools.get('spawn_agent')!.execute({ projectPath: '/p', prompt: 'x' })
    ).rejects.toThrow('supervisor_denied (model_not_allowed): Model is not allowed');
  });
});

describe('await_result cannot hold a connection past the contract', () => {
  it('clamps a huge wait to the maximum, so the client timeout stays bounded', () => {
    for (const huge of [Number.MAX_SAFE_INTEGER, 1e15, 121]) {
      const request = buildControlRequest(1, 'await_result', { agentId: 'a', waitSeconds: huge });
      expect(request.params.waitSeconds).toBe(CONTROL_LIMITS.maxAwaitSeconds);
      expect(controlTimeoutMs('await_result', request.params)).toBe(
        (CONTROL_LIMITS.maxAwaitSeconds + CONTROL_LIMITS.awaitClientGraceSeconds) * 1000
      );
    }
  });

  it('refuses negative, fractional and non-finite waits before they reach the socket', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '60']) {
      expect(
        () =>
          buildControlRequest(1, 'await_result', {
            agentId: 'a',
            waitSeconds: bad as unknown as number,
          }),
        String(bad)
      ).toThrow();
    }
  });
});

describe('which process may start which server mode', () => {
  it('refuses --control inside any IDE agent, a supervisor included', () => {
    expect(() => resolveMcpCliMode(['--control'], { AURIC_IDE_AGENT: '1' })).toThrow(
      /outside AuricIDE/
    );
    expect(() => resolveMcpCliMode(['--control'], { AURIC_AGENT_CWD: '/p' })).toThrow();
  });

  it('refuses --supervisor combined with anything else', () => {
    for (const args of [
      ['--supervisor', '--control'],
      ['--control', '--supervisor'],
      ['--supervisor', '--project-root', '/p'],
      ['--project-root', '/p', '--supervisor'],
    ]) {
      expect(() => resolveMcpCliMode(args, {}), args.join(' ')).toThrow();
    }
  });

  it('starts --supervisor inside an agent: the socket, not the marker, decides', () => {
    expect(resolveMcpCliMode(['--supervisor'], { AURIC_IDE_AGENT: '1' })).toEqual({
      mode: 'supervisor',
    });
  });

  it('serves nothing but the supervisor tools in supervisor mode', () => {
    const names: string[] = [];
    const server = createSupervisorServer();
    // FastMCP keeps its tools on a private list; reading it is the only way to
    // see that no PM or control tool leaked into this server.
    const registered = (server as unknown as { tools?: Array<{ name: string }> }).tools ?? [];
    for (const tool of registered) names.push(tool.name);
    expect(names).not.toContain('send_agent_input');
    expect(names).not.toContain('list_agents');
    expect(names).not.toContain('create_ticket');
  });
});

describe('SV-9: a supervisor-mode server run by an external process', () => {
  it('is not narrowed: the same tools reach every agent, because the socket calls it external', async () => {
    // Documents the boundary rather than a bug: scope follows the process
    // ancestry, never the MCP mode. `auric-mcp --supervisor` started from a
    // terminal therefore lists and kills ANY agent. Harmless (a terminal
    // process may use --control anyway) but it means "supervisor mode" is a
    // label on the tool set, not a restriction. The Rust test
    // `guard_ids_that_are_not_my_children...` pins the real enforcement.
    const call = vi.fn(async () => ({ agents: [] })) as unknown as ControlCaller;
    const tools = capture(call);
    await tools.get('list_my_agents')!.execute({});
    expect(call).toHaveBeenCalledWith('list_agents', {});
  });
});
