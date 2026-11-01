import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { type ContentResult, UserError } from 'fastmcp';
import { z } from 'zod';
import { ControlError } from '../lib/agents/agentControl.contract';
import type { BridgeTarget } from './configBridge';
import type { ControlCaller } from './tools/agentControl';

/**
 * The PM tools of a supervisor's projects, reached through `pm_tools` and
 * `pm_call` on its own server (`docs/design-agent-control.md`, "Supervisor
 * scope"; ADR 0004, amendment 2026-11-01). A server per project on every start
 * cost one Node process per project and listed every tool name per project.
 *
 * Every call asks Rust first (`pm_target`), and only then looks at the children,
 * so a project the policy no longer permits is out of reach at once, with its
 * child still cached. The child is the unchanged `--project-root` server: one
 * process per project keeps `McpSessionIsolation.lean` true. Which order is
 * proved in `verification/lean/AuricIDE/PmScope.lean`; a test replays its traces
 * against `PmGateway`.
 */

/** The environment of the project servers, set by Rust (`supervisor_server_env`). */
export const PM_CHILD_ENV = 'AURIC_PM_CHILD_ENV';
/** `cacheLimit` in `PmScope.lean`. */
const PM_MAX_CHILDREN = 8;
/** A slow answer gets this long; then the child goes. */
const PM_CALL_TIMEOUT_MS = 120_000;
const PM_KILL_GRACE_MS = 2_000;
const STDERR_TAIL_CHARS = 400;
const MCP_PROTOCOL_VERSION = '2025-06-18';

/** What one child server can be asked. */
export interface PmChild {
  request(method: string, params: object): Promise<unknown>;
  close(): void;
}

interface PmGatewayOptions {
  call: ControlCaller;
  /** Starts the server for a folder `pm_target` answered, and nothing else. */
  start: (path: string, onGone: () => void) => PmChild;
  maxChildren?: number;
}

const pmTarget = z.object({ path: z.string().startsWith('/') });

const contentResult = z.object({
  content: z.array(z.object({ type: z.string() }).passthrough()),
  isError: z.boolean().optional(),
});
export type PmToolResult = ContentResult;

const listedTools = z.object({
  tools: z.array(
    z
      .object({ name: z.string(), description: z.string().optional(), inputSchema: z.unknown() })
      .passthrough()
  ),
});
type ListedTool = z.infer<typeof listedTools>['tools'][number];

/** A refusal or failure, with the one sentence the supervisor plans around. */
function refusal(error: unknown): UserError {
  if (error instanceof UserError) return error;
  if (error instanceof ControlError) {
    const code = error.reason ? `${error.code} (${error.reason})` : error.code;
    return new UserError(`${code}: ${error.message}`);
  }
  return new UserError(`internal: ${error instanceof Error ? error.message : String(error)}`);
}

/** The first sentence, so the full list stays a list. */
export function firstSentence(description: string | undefined): string {
  const text = (description ?? '').trim().replace(/\s+/g, ' ');
  const sentence = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
}

export class PmGateway {
  /** Least recently used first: a `Map` keeps insertion order. */
  private readonly children = new Map<string, PmChild>();
  /** Calls under way per folder; such a child is not closed to make room. */
  private readonly busy = new Map<string, number>();
  /** Every project runs the same runtime with the same environment. */
  private tools: ListedTool[] | null = null;
  private readonly maxChildren: number;

  constructor(private readonly options: PmGatewayOptions) {
    this.maxChildren = options.maxChildren ?? PM_MAX_CHILDREN;
  }

  /** The children kept for reuse, most recently used first. */
  cachedPaths(): string[] {
    return [...this.children.keys()].reverse();
  }

  /** `pm_tools`: names and first sentences, or one tool's description and schema. */
  async describe(project: string | undefined, tool: string | undefined): Promise<string> {
    const target = await this.target(project);
    const tools = await this.listTools(target.path);
    if (tool === undefined) {
      return tools.map((entry) => `${entry.name}: ${firstSentence(entry.description)}`).join('\n');
    }
    const found = tools.find((entry) => entry.name === tool);
    if (!found) throw new UserError(`unknown_tool: ${tool}. Call pm_tools without tool.`);
    return JSON.stringify({
      name: found.name,
      description: found.description,
      inputSchema: found.inputSchema,
    });
  }

  /** `pm_call`: the child's result, its `isError` included, as it came. */
  async call(project: string, tool: string, args: Record<string, unknown>): Promise<PmToolResult> {
    const target = await this.target(project);
    const answer = await this.useChild(target.path, (child) =>
      child.request('tools/call', { name: tool, arguments: args })
    );
    // Same server library on both ends; ours re-validates what it sends on.
    return parseChild(contentResult, answer, `the server of ${target.path}`) as PmToolResult;
  }

  /** Closes every child; a later call would start fresh ones. */
  close(): void {
    for (const child of this.children.values()) child.close();
    this.children.clear();
  }

  /** The policy in force at this call decides. Nothing is cached here, on purpose. */
  private async target(project: string | undefined) {
    let answer: unknown;
    try {
      answer = await this.options.call('pm_target', project === undefined ? {} : { project });
    } catch (error) {
      throw refusal(error);
    }
    return parseChild(pmTarget, answer, 'the control socket');
  }

  private async listTools(path: string): Promise<ListedTool[]> {
    if (this.tools) return this.tools;
    const answer = await this.useChild(path, (child) => child.request('tools/list', {}));
    this.tools = parseChild(listedTools, answer, `the server of ${path}`).tools;
    return this.tools;
  }

  private async useChild<T>(path: string, work: (child: PmChild) => Promise<T>): Promise<T> {
    const child = this.acquire(path);
    this.busy.set(path, (this.busy.get(path) ?? 0) + 1);
    try {
      return await work(child);
    } catch (error) {
      throw refusal(error);
    } finally {
      const left = (this.busy.get(path) ?? 1) - 1;
      if (left > 0) this.busy.set(path, left);
      else this.busy.delete(path);
    }
  }

  private acquire(path: string): PmChild {
    const cached = this.children.get(path);
    if (cached) {
      this.children.delete(path);
      this.children.set(path, cached);
      return cached;
    }
    if (this.children.size >= this.maxChildren) this.closeLeastRecentlyUsed();
    const child = this.options.start(path, () => {
      if (this.children.get(path) === child) this.children.delete(path);
    });
    this.children.set(path, child);
    return child;
  }

  private closeLeastRecentlyUsed(): void {
    for (const [path, child] of this.children) {
      if (this.busy.has(path)) continue;
      this.children.delete(path);
      child.close();
      return;
    }
    throw new UserError(
      `pm_busy: ${this.maxChildren} projects are in use at once. Wait for one of those calls.`
    );
  }
}

function parseChild<T>(schema: z.ZodType<T>, answer: unknown, from: string): T {
  const parsed = schema.safeParse(answer);
  if (parsed.success) return parsed.data;
  throw new UserError(`pm_bad_answer: ${from} answered in an unexpected form.`);
}

interface RpcMessage {
  id?: number | string | null;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string };
}

const SERVER_REQUEST_ANSWERS: Record<string, object> = { ping: {}, 'roots/list': { roots: [] } };

/**
 * One `--project-root` server over stdio, newline JSON-RPC as `configBridge.ts`
 * speaks it. The handshake runs first and the requests queue behind it.
 */
export class PmStdioChild implements PmChild {
  private readonly process: ChildProcess;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly ready: Promise<unknown>;
  private nextId = 1;
  private gone: string | null = null;
  private stderrTail = '';

  constructor(
    target: BridgeTarget,
    private readonly path: string,
    private readonly onGone: () => void,
    private readonly timeoutMs: number = PM_CALL_TIMEOUT_MS
  ) {
    this.process = spawn(target.command, target.args, {
      env: target.env as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.stdin?.on('error', () => {});
    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-STDERR_TAIL_CHARS);
    });
    createInterface({ input: this.process.stdout! }).on('line', (line) => this.receive(line));
    this.process.on('error', (error) => this.markGone(`did not start: ${error.message}`));
    this.process.on('exit', (code, signal) => this.markGone(`exited (${signal ?? code})`));
    this.ready = this.send('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'auric-supervisor', version: '1.0.0' },
    }).then((result) => {
      this.write({ jsonrpc: '2.0', method: 'notifications/initialized' });
      return result;
    });
    // A failed handshake is reported by the request waiting behind it.
    this.ready.catch(() => {});
  }

  /** For tests and diagnostics; `undefined` when it never started. */
  get pid(): number | undefined {
    return this.process.pid;
  }

  async request(method: string, params: object): Promise<unknown> {
    await this.ready;
    return this.send(method, params);
  }

  close(): void {
    if (this.gone) return;
    this.process.stdin?.end();
    this.process.kill('SIGTERM');
    const process_ = this.process;
    const force = setTimeout(() => process_.kill('SIGKILL'), PM_KILL_GRACE_MS);
    force.unref();
    process_.once('exit', () => clearTimeout(force));
  }

  private send(method: string, params: object): Promise<unknown> {
    if (this.gone) return Promise.reject(this.goneError());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // Its answer can no longer reach anyone; a fresh child serves the next call.
        this.close();
        this.markGone('stopped answering');
        reject(
          new UserError(
            `pm_timeout: the server of ${this.path} did not answer ${method} in ` +
              `${Math.round(this.timeoutMs / 1000)} s. A write may still have happened: ` +
              'read before you repeat it.'
          )
        );
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  private write(message: object): void {
    this.process.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }
    if (message.method) {
      if (message.id !== undefined && message.id !== null) this.answerServer(message);
      return;
    }
    const waiting = this.pending.get(message.id as number);
    if (!waiting) return;
    this.pending.delete(message.id as number);
    if (message.error) {
      waiting.reject(
        new UserError(
          `${message.error.message ?? 'the server refused the call'}. ` +
            'pm_tools lists the tools; pm_tools with tool names the arguments.'
        )
      );
    } else {
      waiting.resolve(message.result);
    }
  }

  private answerServer(message: RpcMessage): void {
    const result = SERVER_REQUEST_ANSWERS[message.method ?? ''];
    this.write(
      result
        ? { jsonrpc: '2.0', id: message.id, result }
        : {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `Method not found: ${message.method}` },
          }
    );
  }

  private goneError(): UserError {
    const reason = this.stderrTail.trim().split('\n').pop();
    return new UserError(
      `pm_child_gone: the server of ${this.path} ${this.gone}` +
        `${reason ? ` (${reason})` : ''}. The next call starts a fresh one. A write may ` +
        'already have happened: read before you repeat it.'
    );
  }

  private markGone(why: string): void {
    if (this.gone) return;
    this.gone = why;
    this.onGone();
    const error = this.goneError();
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
  }
}

function declaredChildEnv(raw: string | undefined): Record<string, string> {
  try {
    return z.record(z.string(), z.string()).parse(JSON.parse(raw ?? '{}'));
  } catch {
    throw new UserError(`internal: ${PM_CHILD_ENV} is not a map of strings.`);
  }
}

/** What the project servers run on: this runtime, and only their own environment. */
export function pmChildTarget(
  path: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  runtime: { execPath: string; execArgv: readonly string[]; entry: string | undefined } = {
    execPath: process.execPath,
    execArgv: process.execArgv,
    entry: process.argv[1],
  }
): BridgeTarget {
  if (!runtime.entry) throw new UserError('internal: this server does not know its own entry.');
  const {
    AURIC_CONTROL_SOCKET: _socket,
    AURIC_AGENT_CWD: _cwd,
    [PM_CHILD_ENV]: raw,
    ...inherited
  } = environment;
  const { AURIC_AGENT_CWD: _ownCwd, ...declared } = declaredChildEnv(raw);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...inherited, ...declared })) {
    if (value !== undefined) env[key] = value;
  }
  return {
    command: runtime.execPath,
    args: [...runtime.execArgv, runtime.entry, '--project-root', path],
    env,
  };
}

/** The gateway of a running supervisor server. */
export function createPmGateway(call: ControlCaller): PmGateway {
  return new PmGateway({
    call,
    start: (path, onGone) => new PmStdioChild(pmChildTarget(path), path, onGone),
  });
}

/**
 * No child outlives this server: stdin ending means its client is gone, and a
 * signal or exit closes them too. A parent that is killed outright closes the
 * children's stdin, on which `server.ts` ends them.
 */
export function closeWithParent(gateway: PmGateway): void {
  const close = () => gateway.close();
  process.stdin.once('end', close);
  process.stdin.once('close', close);
  process.once('exit', close);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, () => {
      close();
      process.exit(1);
    });
  }
}
