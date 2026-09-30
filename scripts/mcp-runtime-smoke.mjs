import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const root = resolve(import.meta.dirname, '..');
const project = await mkdtemp(join(tmpdir(), 'auric-mcp-smoke-'));
const notifications = join(project, 'notifications.db');
await mkdir(join(project, '.auric'));
await (await open(join(project, '.auric', 'project.db'), 'w')).close();

/** Tools the IDE's own flows call by name; a runtime without them is broken
 * whatever else it offers. */
const REQUIRED_TOOLS = [
  'notify',
  'notify_ask',
  'notify_answer_get',
  'schedule_list',
  'materialize_goal_plan',
];

/**
 * Starts one MCP server over stdio and returns the names of its tools. The
 * same project and notification inbox for both runs, so any tool that is
 * registered conditionally is registered (or not) the same way in each.
 */
async function listTools(label, command, args) {
  const child = spawn(command, [...args, '--project-root', project], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AURIC_NOTIFICATIONS_DB: notifications },
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined) pending.get(message.id)?.(message);
    } catch {
      // FastMCP diagnostics belong on stderr; ignore non-protocol stdout here so
      // the assertion below reports the actual missing response with stderr.
    }
  });

  function request(id, method, params = {}) {
    return new Promise((resolveResponse, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`${label}: timed out waiting for ${method}: ${stderr}`)),
        20_000
      );
      pending.set(id, (message) => {
        clearTimeout(timeout);
        pending.delete(id);
        resolveResponse(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  try {
    const initialized = await request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'auric-runtime-smoke', version: '1' },
    });
    assert.equal(initialized.result?.serverInfo?.name, 'auric-pm', `${label}: wrong server`);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`
    );
    const tools = await request(2, 'tools/list');
    assert.ok(Array.isArray(tools.result?.tools), `${label}: tools/list returned no tool array`);
    return tools.result.tools.map((tool) => tool.name).sort();
  } finally {
    child.kill('SIGTERM');
    lines.close();
  }
}

try {
  // The source server is the reference: whatever it registers, the packaged
  // runtime must register too. Comparing against it instead of a fixed count
  // keeps this check honest without an edit every time a tool is added.
  const source = await listTools('source', join(root, 'node_modules/.bin/tsx'), [
    join(root, 'src/mcp/server.ts'),
  ]);
  const packaged = await listTools('packaged', process.execPath, [
    join(root, 'src-tauri/resources/auric-mcp/server.mjs'),
  ]);

  const missing = source.filter((name) => !packaged.includes(name));
  const extra = packaged.filter((name) => !source.includes(name));
  assert.deepEqual(
    { missing, extra },
    { missing: [], extra: [] },
    'packaged runtime differs from the source server (a stale bundle? run pnpm mcp:bundle)'
  );
  for (const name of REQUIRED_TOOLS) {
    assert.ok(packaged.includes(name), `missing tool ${name}`);
  }
  process.stdout.write(`Packaged MCP runtime ready with ${packaged.length} tools.\n`);
} finally {
  await rm(project, { recursive: true, force: true });
}
