/**
 * `auric-mcp/bridge.mjs`: the auric-pm server for agent CLIs that read MCP
 * servers only from one global config and take no per-launch config (the
 * Antigravity CLI is one). The global entry points here once; which project it
 * serves is decided per agent process, by the IDE.
 *
 * The IDE exports `AURIC_MCP_CONFIG` to a bound agent — the same per-project
 * `mcpServers` file it hands to CLIs with a `--mcp-config` flag. The bridge
 * runs exactly the `auric-pm` entry from that file, so both kinds of CLI get
 * the same server, arguments and environment, and the project comes from the
 * one process that the IDE bound, never from a setting that outlives it.
 *
 * Without that variable (the CLI started outside the IDE, or an unbound agent)
 * the bridge still answers, with no tools. A server that never completes its
 * handshake blocks the Antigravity CLI's whole turn until its print timeout,
 * so "nothing to offer" has to be a fast, valid answer rather than an exit.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

export const BRIDGE_CONFIG_ENV = 'AURIC_MCP_CONFIG';
const SERVER_NAME = 'auric-pm';

export interface BridgeTarget {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type BridgeResolution =
  { kind: 'serve'; target: BridgeTarget } | { kind: 'empty'; why: string };

/** Which server this bridge process should become, read from its environment. */
export function resolveBridgeTarget(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string
): BridgeResolution {
  const path = env[BRIDGE_CONFIG_ENV]?.trim();
  if (!path) return { kind: 'empty', why: `${BRIDGE_CONFIG_ENV} is not set` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFile(path));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: 'empty', why: `${path} could not be read: ${detail}` };
  }
  const entry = (parsed as { mcpServers?: Record<string, unknown> })?.mcpServers?.[SERVER_NAME];
  if (!isServerEntry(entry)) {
    return { kind: 'empty', why: `${path} has no usable "${SERVER_NAME}" server` };
  }
  return {
    kind: 'serve',
    target: { command: entry.command, args: entry.args ?? [], env: entry.env ?? {} },
  };
}

function isServerEntry(
  value: unknown
): value is { command: string; args?: string[]; env?: Record<string, string> } {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.command !== 'string' || entry.command === '') return false;
  if (entry.args !== undefined) {
    if (!Array.isArray(entry.args) || !entry.args.every((a) => typeof a === 'string')) return false;
  }
  if (entry.env !== undefined) {
    if (typeof entry.env !== 'object' || entry.env === null) return false;
    if (!Object.values(entry.env).every((v) => typeof v === 'string')) return false;
  }
  return true;
}

interface JsonRpcRequest {
  id?: string | number | null;
  method?: string;
  params?: { protocolVersion?: string };
}

/** The reply an empty server gives to one request; null for notifications. */
export function emptyServerReply(request: JsonRpcRequest): object | null {
  if (request.id === undefined || request.id === null) return null;
  const reply = (result: object) => ({ jsonrpc: '2.0', id: request.id, result });
  switch (request.method) {
    case 'initialize':
      return reply({
        protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: '0.0.0' },
        instructions: 'AuricIDE did not bind this agent to a project, so no tools are offered.',
      });
    case 'tools/list':
      return reply({ tools: [] });
    case 'ping':
      return reply({});
    default:
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method ?? '<none>'}` },
      };
  }
}

/** Answers each request line as the empty server would. */
function answerEmpty(line: string, output: Writable): void {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    return;
  }
  const reply = emptyServerReply(request);
  if (reply) output.write(`${JSON.stringify(reply)}\n`);
}

export function serveEmpty(why: string, input: Readable, output: Writable): void {
  console.error(`[auric-pm bridge] offering no tools: ${why}`);
  createInterface({ input }).on('line', (line) => answerEmpty(line, output));
}

/**
 * Runs the bound server with the CLI's stdio passed through. If it dies
 * before its first reply (a project that is not initialised, a database it
 * cannot open), the bridge takes over as the empty server and answers the
 * requests the server never did: the agent then works without tools instead
 * of its CLI waiting on a server that is gone. A server that has answered
 * once is the CLI's to lose; its exit ends the bridge with it.
 */
export function serve(
  target: BridgeTarget,
  input: Readable,
  output: Writable,
  exit: (code: number) => void
): ChildProcess {
  const child = spawn(target.command, target.args, {
    env: { ...process.env, ...target.env },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  let answered = false;
  let fallback = false;
  const unanswered: string[] = [];

  const fallBack = (why: string) => {
    if (answered || fallback) return;
    fallback = true;
    console.error(`[auric-pm bridge] offering no tools: ${why}`);
    for (const line of unanswered.splice(0)) answerEmpty(line, output);
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    answered = true;
    unanswered.length = 0;
    output.write(chunk);
  });
  createInterface({ input }).on('line', (line) => {
    if (fallback) return answerEmpty(line, output);
    if (!answered) unanswered.push(line);
    child.stdin?.write(`${line}\n`);
  });
  child.stdin?.on('error', () => {});
  child.on('error', (error) => fallBack(`${target.command} did not start: ${error.message}`));
  child.on('exit', (code, signal) => {
    if (!answered) return fallBack(`the server exited before answering (${signal ?? code})`);
    exit(signal ? 1 : (code ?? 0));
  });
  return child;
}

const isMainModule =
  (import.meta as ImportMeta & { main?: boolean }).main === true ||
  (typeof process !== 'undefined' && process.argv[1]?.endsWith('bridge.mjs'));

if (isMainModule) {
  const resolution = resolveBridgeTarget(process.env, (path) => readFileSync(path, 'utf8'));
  if (resolution.kind === 'serve') {
    const child = serve(resolution.target, process.stdin, process.stdout, (code) =>
      process.exit(code)
    );
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(signal, () => {
        child.kill(signal);
        process.exit(1);
      });
    }
  } else {
    serveEmpty(resolution.why, process.stdin, process.stdout);
  }
}
