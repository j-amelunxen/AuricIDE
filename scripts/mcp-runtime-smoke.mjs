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

const child = spawn(
  process.execPath,
  [join(root, 'src-tauri/resources/auric-mcp/server.mjs'), '--project-root', project],
  {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AURIC_NOTIFICATIONS_DB: notifications },
  }
);
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
      () => reject(new Error(`Timed out waiting for ${method}: ${stderr}`)),
      10_000
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
  assert.equal(initialized.result?.serverInfo?.name, 'auric-pm');
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`
  );
  const tools = await request(2, 'tools/list');
  assert.equal(tools.result?.tools?.length, 63, 'expected the complete packaged Auric tool set');
  for (const name of [
    'notify',
    'notify_ask',
    'notify_answer_get',
    'schedule_list',
    'materialize_goal_plan',
  ]) {
    assert.ok(
      tools.result.tools.some((tool) => tool.name === name),
      `missing tool ${name}`
    );
  }
  process.stdout.write(`Packaged MCP runtime ready with ${tools.result.tools.length} tools.\n`);
} finally {
  child.kill('SIGTERM');
  lines.close();
  await rm(project, { recursive: true, force: true });
}
