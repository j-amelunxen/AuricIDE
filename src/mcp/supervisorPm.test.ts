import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { FastMCP } from 'fastmcp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import { ControlError } from '../lib/agents/agentControl.contract';
import { openDatabase } from './db';
import {
  firstSentence,
  PmGateway,
  pmChildTarget,
  PmStdioChild,
  PM_CHILD_ENV,
  type PmToolResult,
} from './supervisorPm';
import type { ControlCaller } from './tools/agentControl';
import { registerSupervisorTools } from './tools/supervisor';

/**
 * The gateway against the real `--project-root` server over stdio, in temp
 * folders. The control call is a stand-in here: Rust's resolver has its own tests
 * with real folders and links (`control_socket/tests.rs`, `mod pm_target`). What
 * this file shows is what the gateway does with its answer: refused means no
 * process and nothing changed, allowed means exactly that folder.
 */

const REPO_ROOT = resolve(__dirname, '../..');
const SERVER = join(REPO_ROOT, 'src/mcp/server.ts');
const RUNTIME = { execPath: process.execPath, execArgv: ['--import', 'tsx'], entry: SERVER };

interface CapturedTool {
  parameters: ZodType;
  execute: (args: Record<string, unknown>) => Promise<string | PmToolResult>;
}

function textOf(result: PmToolResult): string {
  return result.content.map((part) => (part as { text?: string }).text ?? '').join('');
}

function isGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the condition');
    await new Promise((done) => setTimeout(done, 25));
  }
}

let root: string;
let alpha: string;
let beta: string;
let gamma: string;

function project(name: string): string {
  const dir = join(root, name);
  mkdirSync(join(dir, '.auric'), { recursive: true });
  openDatabase(join(dir, '.auric', 'project.db')).close();
  return dir;
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'auric-pm-gateway-')));
  [alpha, beta, gamma] = ['alpha', 'beta', 'gamma'].map(project);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A gateway over real children with a policy the test can change at any time. */
function rig(options: { maxChildren?: number; timeoutMs?: number } = {}) {
  const allowed = new Set<string>([alpha, beta]);
  const started: PmStdioChild[] = [];
  const startedPaths: string[] = [];
  const call = (async (_method: string, params: { project?: string }) => {
    const wanted = params.project ?? [...allowed][0];
    if (!wanted || !allowed.has(wanted)) {
      throw new ControlError('unknown_project', `No project matches '${wanted}'.`);
    }
    return { path: wanted, name: wanted.split('/').pop() };
  }) as unknown as ControlCaller;
  const gateway = new PmGateway({
    call,
    maxChildren: options.maxChildren,
    start: (path, onGone) => {
      const target = pmChildTarget(
        path,
        {
          ...process.env,
          AURIC_CONTROL_SOCKET: '/nowhere/control.sock',
          AURIC_AGENT_CWD: '/must/not/arrive',
          [PM_CHILD_ENV]: JSON.stringify({ AURIC_NOTIFICATIONS_DB: join(root, 'inbox.db') }),
        },
        RUNTIME
      );
      const child = new PmStdioChild(target, path, onGone, options.timeoutMs);
      started.push(child);
      startedPaths.push(path);
      return child;
    },
  });
  const tools = new Map<string, CapturedTool>();
  registerSupervisorTools(
    {
      addTool: (tool: CapturedTool & { name: string }) => tools.set(tool.name, tool),
    } as unknown as FastMCP,
    call,
    gateway
  );
  gateways.push(gateway);
  return {
    gateway,
    allowed,
    started,
    startedPaths,
    pmTools: (args: Record<string, unknown>) =>
      tools.get('pm_tools')!.execute(args) as Promise<string>,
    pmCall: (args: Record<string, unknown>) =>
      tools.get('pm_call')!.execute(args) as Promise<PmToolResult>,
    parameters: (name: string) => tools.get(name)!.parameters,
  };
}

const gateways: PmGateway[] = [];

afterEach(() => {
  for (const gateway of gateways.splice(0)) gateway.close();
});

describe('pm_tools and pm_call against a real project server', () => {
  it('lists names and first sentences, gives one schema, and runs a tool', async () => {
    const r = rig();
    const list = await r.pmTools({});
    const lines = list.split('\n');
    expect(lines.length).toBeGreaterThan(40);
    expect(lines.find((line) => line.startsWith('list_epics: '))).toBeDefined();
    expect(list).not.toContain('inputSchema');

    const schema = JSON.parse(await r.pmTools({ tool: 'create_epic' })) as {
      name: string;
      description: string;
      inputSchema: { properties: Record<string, unknown> };
    };
    expect(schema.name).toBe('create_epic');
    expect(schema.inputSchema.properties.name).toBeDefined();

    const created = await r.pmCall({
      project: alpha,
      tool: 'create_epic',
      arguments: { name: 'Only in alpha' },
    });
    expect(created.isError).toBeFalsy();
    const inAlpha = await r.pmCall({ project: alpha, tool: 'list_epics' });
    expect(textOf(inAlpha)).toContain('Only in alpha');
    const inBeta = await r.pmCall({ project: beta, tool: 'list_epics' });
    expect(textOf(inBeta), 'one process per project').not.toContain('Only in alpha');
    expect(r.startedPaths).toEqual([alpha, beta]);
  }, 60_000);

  it('asks the tool list of a child only once', async () => {
    const r = rig();
    await r.pmTools({});
    await r.pmTools({ project: beta });
    await r.pmTools({ tool: 'list_epics' });
    expect(r.startedPaths).toEqual([alpha]);
  }, 30_000);

  it('passes on a tool error unchanged, and spawning stays refused', async () => {
    const r = rig();
    const list = await r.pmTools({});
    expect(list, 'the inbox environment reached the child').toContain('request_agent_launch: ');
    const result = await r.pmCall({
      project: alpha,
      tool: 'request_agent_launch',
      arguments: { prompt: 'x', goalId: 'x' },
    });
    expect(result.isError, textOf(result)).toBe(true);
    expect(textOf(result)).toContain('AURIC_AGENT_CWD');
  }, 30_000);

  it('reports an unknown tool and bad arguments, and the child lives on', async () => {
    const r = rig();
    await expect(r.pmCall({ project: alpha, tool: 'no_such_tool' })).rejects.toThrow(
      /no_such_tool/
    );
    await expect(
      r.pmCall({ project: alpha, tool: 'create_epic', arguments: { name: 42 } })
    ).rejects.toThrow(/pm_tools/);
    await expect(r.pmTools({ tool: 'no_such_tool' })).rejects.toThrow('unknown_tool');
    expect((await r.pmCall({ project: alpha, tool: 'list_epics' })).isError).toBeFalsy();
    expect(r.startedPaths).toEqual([alpha]);
  }, 30_000);
});

describe('refusals never start anything', () => {
  it('is refused for every spelling outside the policy, with no process', async () => {
    const r = rig();
    const link = join(root, 'link-to-gamma');
    if (!existsSync(link)) symlinkSync(gamma, link);
    for (const spelling of [gamma, link, `${alpha}/../gamma`, '..', 'auric-pm-gamma', 'gamma']) {
      await expect(r.pmCall({ project: spelling, tool: 'list_epics' }), spelling).rejects.toThrow(
        'unknown_project'
      );
      await expect(r.pmTools({ project: spelling }), spelling).rejects.toThrow('unknown_project');
    }
    expect(r.startedPaths).toEqual([]);
    expect(r.gateway.cachedPaths()).toEqual([]);
  });

  it('takes an empty project for a mistake, not for the first usable one', async () => {
    const r = rig();
    await expect(r.pmCall({ project: '', tool: 'list_epics' })).rejects.toThrow('unknown_project');
    await expect(r.pmTools({ project: '' })).rejects.toThrow('unknown_project');
    expect(r.startedPaths).toEqual([]);
  });

  it('shows a refusal with its reason and starts nothing', async () => {
    const call = (async () => {
      throw new ControlError('supervisor_denied', 'has no database', 'project_not_initialized');
    }) as unknown as ControlCaller;
    const started: string[] = [];
    const gateway = new PmGateway({
      call,
      start: (path) => {
        started.push(path);
        throw new Error('must not start');
      },
    });
    await expect(gateway.call('/p', 'list_epics', {})).rejects.toThrow(
      'supervisor_denied (project_not_initialized): has no database'
    );
    expect(started).toEqual([]);
  });

  it('starts nothing on a control answer that is not a path', async () => {
    const started: string[] = [];
    for (const answer of [{}, { path: 'relative/project' }, { path: 7 }, null]) {
      const gateway = new PmGateway({
        call: (async () => answer) as unknown as ControlCaller,
        start: (path) => {
          started.push(path);
          throw new Error('must not start');
        },
      });
      await expect(gateway.call('x', 'list_epics', {})).rejects.toThrow('pm_bad_answer');
    }
    expect(started).toEqual([]);
  });

  it('refuses a tool name that is not one before it goes anywhere', () => {
    const r = rig();
    const parameters = r.parameters('pm_call');
    for (const tool of [
      '',
      'x'.repeat(65),
      'list_epics\n{"jsonrpc":"2.0"}',
      '../list',
      'a b',
      'a"b',
    ]) {
      expect(parameters.safeParse({ project: alpha, tool }).success, tool).toBe(false);
    }
    expect(parameters.safeParse({ project: alpha, tool: 'list_epics' }).success).toBe(true);
    expect(parameters.safeParse({ tool: 'list_epics' }).success, 'project is required').toBe(false);
  });

  it('a hostile tool name past the schema stays one string on the wire', async () => {
    const r = rig();
    const hostile =
      'x"}\n{"jsonrpc":"2.0","id":99,"method":"tools/call","params":{"name":"list_epics"}}';
    await expect(r.gateway.call(alpha, hostile, {})).rejects.toThrow();
    const after = await r.pmCall({ project: alpha, tool: 'list_epics' });
    expect(after.isError).toBeFalsy();
    expect(r.startedPaths).toEqual([alpha]);
  }, 30_000);
});

describe('the policy decides on every call, the child cache never does', () => {
  it('refuses a revoked project at once, with its child still cached, and reuses it later', async () => {
    const r = rig();
    await r.pmCall({ project: alpha, tool: 'list_epics' });
    expect(r.gateway.cachedPaths()).toEqual([alpha]);

    r.allowed.delete(alpha);
    await expect(r.pmCall({ project: alpha, tool: 'list_epics' })).rejects.toThrow(
      'unknown_project'
    );
    expect(r.gateway.cachedPaths(), 'a refusal changes nothing').toEqual([alpha]);

    r.allowed.add(alpha);
    await r.pmCall({ project: alpha, tool: 'list_epics' });
    expect(r.startedPaths, 'still the first child').toEqual([alpha]);
  }, 30_000);

  it('closes the least recently used child at the limit', async () => {
    const r = rig({ maxChildren: 2 });
    r.allowed.add(gamma);
    await r.pmCall({ project: alpha, tool: 'list_epics' });
    await r.pmCall({ project: beta, tool: 'list_epics' });
    await r.pmCall({ project: alpha, tool: 'list_epics' });
    await r.pmCall({ project: gamma, tool: 'list_epics' });
    expect(r.gateway.cachedPaths()).toEqual([gamma, alpha]);
    const betaPid = r.started[1].pid!;
    await until(() => isGone(betaPid));
    expect(isGone(r.started[0].pid!), 'alpha was used more recently').toBe(false);
  }, 60_000);
});

describe('a child that goes away', () => {
  it('fails the running call clearly and the next call starts a fresh one', async () => {
    const r = rig();
    await r.pmCall({ project: alpha, tool: 'list_epics' });
    const first = r.started[0];
    const running = r.pmCall({ project: alpha, tool: 'list_epics' });
    process.kill(first.pid!, 'SIGKILL');
    await running.then(
      () => {}, // It may have answered first; the point is what comes next.
      (error: Error) => expect(error.message).toContain('pm_child_gone')
    );
    await until(() => !r.gateway.cachedPaths().includes(alpha));
    const again = await r.pmCall({ project: alpha, tool: 'list_epics' });
    expect(again.isError).toBeFalsy();
    expect(r.started).toHaveLength(2);
  }, 30_000);

  it('says why when the server cannot start, and tries again next time', async () => {
    const r = rig();
    const missing = join(root, 'removed');
    r.allowed.add(missing);
    await expect(r.pmCall({ project: missing, tool: 'list_epics' })).rejects.toThrow(
      /pm_child_gone.*does not exist/
    );
    expect(r.gateway.cachedPaths()).toEqual([]);
  }, 30_000);
});

/** A server written in a line of Node, for what the real one does not do on demand. */
function scriptChild(script: string, onGone: () => void = () => {}, timeoutMs?: number) {
  return new PmStdioChild(
    { command: process.execPath, args: ['-e', script], env: { PATH: process.env.PATH ?? '' } },
    '/p',
    onGone,
    timeoutMs
  );
}

describe('the wire', () => {
  it('answers ping and roots/list from the server, and refuses anything else', async () => {
    const child = scriptChild(`
      const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
      const seen = {};
      require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
        const m = JSON.parse(line);
        if (m.method === 'initialize') {
          send({ jsonrpc: '2.0', id: 'a', method: 'ping' });
          send({ jsonrpc: '2.0', id: 'b', method: 'roots/list' });
          send({ jsonrpc: '2.0', id: 'c', method: 'sampling/createMessage' });
          send({ jsonrpc: '2.0', id: m.id, result: {} });
        } else if (m.id === 'a' || m.id === 'b' || m.id === 'c') {
          seen[m.id] = m;
        } else if (m.method === 'tools/call') {
          send({ jsonrpc: '2.0', id: m.id, result: { content: [], seen } });
        }
      });
    `);
    const answer = (await child.request('tools/call', {})) as {
      seen: Record<string, { result?: { roots?: unknown }; error?: { code: number } }>;
    };
    expect(answer.seen.a.result).toEqual({});
    expect(answer.seen.b.result).toEqual({ roots: [] });
    expect(answer.seen.c.error?.code).toBe(-32601);
    child.close();
  }, 20_000);

  it('gives up on a server that never answers, and ends it', async () => {
    const child = scriptChild(`process.stdin.resume();`, () => {}, 200);
    await expect(child.request('tools/list', {})).rejects.toThrow('pm_timeout');
    await until(() => isGone(child.pid!));
  }, 20_000);

  it('ignores a line that is not JSON and still reads the answer', async () => {
    const child = scriptChild(`
      process.stdout.write('not json\\n');
      require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
        const m = JSON.parse(line);
        if (m.id) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { ok: 1 } }) + '\\n');
      });
    `);
    await expect(child.request('tools/list', {})).resolves.toEqual({ ok: 1 });
    child.close();
  }, 20_000);
});

describe('what the project servers run with', () => {
  it('takes this runtime and its own environment, without the socket or a launch folder', () => {
    const target = pmChildTarget(
      '/p',
      {
        PATH: '/bin',
        AURIC_IDE_AGENT: '1',
        AURIC_CONTROL_SOCKET: '/s',
        AURIC_AGENT_CWD: '/inherited',
        [PM_CHILD_ENV]: JSON.stringify({
          AURIC_NOTIFICATIONS_DB: '/n.db',
          AURIC_AGENT_CWD: '/declared',
        }),
      },
      { execPath: '/bin/node', execArgv: [], entry: '/rt/server.mjs' }
    );
    expect(target.command).toBe('/bin/node');
    expect(target.args).toEqual(['/rt/server.mjs', '--project-root', '/p']);
    expect(target.env).toEqual({
      PATH: '/bin',
      AURIC_IDE_AGENT: '1',
      AURIC_NOTIFICATIONS_DB: '/n.db',
    });
  });

  it('fails clearly on a broken environment variable', () => {
    const broken = { [PM_CHILD_ENV]: JSON.stringify({ A: 1 }) };
    expect(() => pmChildTarget('/p', broken, { ...RUNTIME })).toThrow(PM_CHILD_ENV);
    expect(() => pmChildTarget('/p', { [PM_CHILD_ENV]: '{' }, { ...RUNTIME })).toThrow(
      PM_CHILD_ENV
    );
  });

  it('keeps a description to its first sentence', () => {
    expect(firstSentence('Lists epics. Then does more.')).toBe('Lists epics.');
    expect(firstSentence('See v1.2 here. Next.')).toBe('See v1.2 here.');
    expect(firstSentence('No full stop')).toBe('No full stop');
    expect(firstSentence(undefined)).toBe('');
    expect(firstSentence('x'.repeat(300))).toHaveLength(160);
  });
});

/** The whole `--supervisor` server in a process of its own, as a CLI starts it. */
describe('the --supervisor server', () => {
  let socketServer: Server;
  let parent: ChildProcess | null = null;

  async function startParent() {
    const socket = join(root, 'c.sock');
    socketServer = createServer((connection) => {
      createInterface({ input: connection }).on('line', (line) => {
        const request = JSON.parse(line) as { id: number; method: string };
        connection.write(
          `${JSON.stringify({ id: request.id, ok: true, result: { path: alpha, name: 'alpha' } })}\n`
        );
      });
    });
    await new Promise<void>((done) => socketServer.listen(socket, done));
    const child = spawn(process.execPath, ['--import', 'tsx', SERVER, '--supervisor'], {
      cwd: REPO_ROOT,
      env: { ...process.env, AURIC_CONTROL_SOCKET: socket },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    parent = child;
    const responses = new Map<number, (result: unknown) => void>();
    createInterface({ input: child.stdout! }).on('line', (line) => {
      const message = JSON.parse(line) as { id?: number; result?: unknown };
      if (message.id !== undefined) responses.get(message.id)?.(message.result);
    });
    let id = 0;
    const request = (method: string, params: object) =>
      new Promise<unknown>((done) => {
        id += 1;
        responses.set(id, done);
        child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    child.stdin!.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
    return { child, request };
  }

  /** Children are found by parent pid: the process table is the one thing that cannot lie. */
  async function childPidsOf(pid: number): Promise<number[]> {
    const list = spawn('pgrep', ['-P', String(pid)]);
    let out = '';
    list.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    await new Promise((done) => list.on('exit', done));
    return out.split('\n').filter(Boolean).map(Number);
  }

  afterEach(async () => {
    parent?.kill('SIGKILL');
    parent = null;
    await new Promise((done) => socketServer.close(done));
  });

  async function startWithChild() {
    const { child, request } = await startParent();
    const listed = (await request('tools/list', {})) as { tools: Array<{ name: string }> };
    expect(listed.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['pm_tools', 'pm_call'])
    );
    expect(listed.tools.length, 'two more, not one per project').toBeLessThan(25);
    const called = (await request('tools/call', {
      name: 'pm_call',
      arguments: { project: 'alpha', tool: 'list_epics' },
    })) as PmToolResult;
    expect(called.isError).toBeFalsy();
    const pids = await childPidsOf(child.pid!);
    expect(pids).toHaveLength(1);
    return { child, childPid: pids[0] };
  }

  it('runs a PM tool end to end, and its child ends when its stdin does', async () => {
    const { child, childPid } = await startWithChild();
    child.stdin!.end();
    await until(() => isGone(childPid));
  }, 60_000);

  it('leaves no child behind when it is killed outright', async () => {
    const { child, childPid } = await startWithChild();
    child.kill('SIGKILL');
    await until(() => isGone(childPid));
  }, 60_000);
});
