import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../db';

/**
 * The schemas exactly as an agent's client receives them: the real server over
 * stdio, every environment gate the IDE sets switched on. A schema the model
 * API rejects kills the whole agent session the moment the tool is loaded
 * (400 "tools.N.custom.input_schema: JSON schema is invalid"), so every tool
 * must pass here, including the ones only an IDE-started agent sees.
 */

interface WireTool {
  name: string;
  inputSchema: Record<string, unknown>;
}

const REPO_ROOT = resolve(__dirname, '../../..');

async function listToolsOverStdio(env: NodeJS.ProcessEnv): Promise<WireTool[]> {
  const child = spawn(
    join(REPO_ROOT, 'node_modules/.bin/tsx'),
    ['--tsconfig', 'tsconfig.json', 'src/mcp/server.ts', '--project-root', env.AURIC_AGENT_CWD!],
    { cwd: REPO_ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  // A server that dies on startup must fail the test with its reason, not hang it.
  const exited = new Promise<never>((_, reject) =>
    child.on('exit', (code) => reject(new Error(`auric-pm exited (${code}): ${stderr}`)))
  );
  const lines = createInterface({ input: child.stdout });
  const responses = new Map<number, (message: Record<string, unknown>) => void>();
  lines.on('line', (line) => {
    const message = JSON.parse(line) as { id?: number };
    if (message.id !== undefined) responses.get(message.id)?.(message);
  });
  const request = (id: number, method: string, params: object) =>
    Promise.race([
      new Promise<Record<string, unknown>>((done) => {
        responses.set(id, done);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      }),
      exited,
    ]);

  try {
    await request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'schema-test', version: '0' },
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
    );
    const listed = await request(2, 'tools/list', {});
    return (listed.result as { tools: WireTool[] }).tools;
  } finally {
    child.removeAllListeners('exit');
    child.kill();
  }
}

/** Every `pattern` in a schema, with its JSON path. */
function patternsOf(node: unknown, path = ''): Array<{ path: string; pattern: string }> {
  if (Array.isArray(node)) return node.flatMap((item, i) => patternsOf(item, `${path}/${i}`));
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) =>
    key === 'pattern' && typeof value === 'string'
      ? [{ path: `${path}/pattern`, pattern: value }]
      : patternsOf(value, `${path}/${key}`)
  );
}

/**
 * A `[` inside a character class is literal to JavaScript but opens a nested
 * class in stricter dialects (Rust `regex`, Python's set operations), which
 * then reject the pattern as unclosed. The model API is one of them.
 */
function unescapedBracketInClass(pattern: string): number | null {
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\') {
      i++;
    } else if (inClass && char === '[') {
      return i;
    } else if (char === '[') {
      inClass = true;
      if (pattern[i + 1] === '^') i++;
      if (pattern[i + 1] === ']') i++;
    } else if (inClass && char === ']') {
      inClass = false;
    }
  }
  return null;
}

describe('unescapedBracketInClass', () => {
  it('finds the bracket that broke request_agent_launch', () => {
    expect(unescapedBracketInClass('^[A-Za-z0-9._:/@+[\\]-]{0,127}$')).toBe(17);
  });

  it('accepts escaped brackets and brackets outside a class', () => {
    expect(unescapedBracketInClass('^[A-Za-z0-9._:/@+\\[\\]-]{0,127}$')).toBeNull();
    expect(unescapedBracketInClass('^\\[a\\]$')).toBeNull();
    expect(unescapedBracketInClass('^[^a]+$')).toBeNull();
  });
});

describe('auric-pm tool schemas on the wire (all IDE gates on)', () => {
  let dir: string;
  let tools: WireTool[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'auric-schemas-'));
    mkdirSync(join(dir, '.auric'));
    openDatabase(join(dir, '.auric', 'project.db')).close();
    tools = await listToolsOverStdio({
      ...process.env,
      AURIC_NOTIFICATIONS_DB: join(dir, 'notifications.db'),
      AURIC_AGENT_CWD: dir,
      AURIC_AGENT_PROVIDERS: '[]',
    });
  }, 60_000);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('includes the gated launch and notification tools', () => {
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['request_agent_launch', 'list_agent_providers', 'notify'])
    );
  });

  it('gives every tool an object schema', () => {
    const notObject = tools.filter((tool) => tool.inputSchema.type !== 'object');
    expect(notObject.map((tool) => tool.name)).toEqual([]);
  });

  it('uses only patterns that compile in strict regex dialects', () => {
    const broken = tools.flatMap((tool) =>
      patternsOf(tool.inputSchema).flatMap(({ path, pattern }) => {
        try {
          new RegExp(pattern, 'u');
        } catch (error) {
          return [`${tool.name} ${path}: ${pattern} (${String(error)})`];
        }
        const at = unescapedBracketInClass(pattern);
        return at === null ? [] : [`${tool.name} ${path}: ${pattern} (unescaped [ at ${at})`];
      })
    );
    expect(broken).toEqual([]);
  });
});
