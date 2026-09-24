import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const repositoryRoot = resolve(import.meta.dirname, '..');
const runtime = join(repositoryRoot, 'src-tauri/resources/auric-mcp/server.mjs');

async function createProject(label) {
  const root = await mkdtemp(join(tmpdir(), `auric-${label}-`));
  await mkdir(join(root, '.auric'));
  await (await open(join(root, '.auric', 'project.db'), 'w')).close();
  return root;
}

function startClient(projectRoot, notificationsPath) {
  const child = spawn(process.execPath, [runtime, '--project-root', projectRoot], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AURIC_NOTIFICATIONS_DB: notificationsPath },
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined) pending.get(message.id)?.(message);
    } catch {
      // A non-JSON line cannot satisfy a protocol request.
    }
  });

  const request = (method, params = {}) =>
    new Promise((resolveResponse, reject) => {
      const id = nextId++;
      const timeout = setTimeout(
        () => reject(new Error(`Timed out waiting for ${method}: ${stderr}`)),
        10_000
      );
      pending.set(id, (message) => {
        clearTimeout(timeout);
        pending.delete(id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolveResponse(message.result);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  return {
    async initialize() {
      await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'auric-isolation-e2e', version: '1' },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`
      );
    },
    async call(name, args = {}) {
      const result = await request('tools/call', { name, arguments: args });
      const text = result.content?.find((item) => item.type === 'text')?.text;
      return JSON.parse(text);
    },
    stop() {
      child.kill('SIGTERM');
      lines.close();
    },
  };
}

const alphaRoot = await createProject('alpha');
const betaRoot = await createProject('beta');
const notificationsRoot = await mkdtemp(join(tmpdir(), 'auric-notifications-'));
const notificationsPath = join(notificationsRoot, 'notifications.db');
const alpha = startClient(alphaRoot, notificationsPath);
const beta = startClient(betaRoot, notificationsPath);

try {
  await Promise.all([alpha.initialize(), beta.initialize()]);
  await Promise.all([
    alpha.call('create_epic', { name: 'ALPHA_ONLY' }),
    beta.call('create_epic', { name: 'BETA_ONLY' }),
  ]);

  const [alphaEpics, betaEpics] = await Promise.all([
    alpha.call('list_epics'),
    beta.call('list_epics'),
  ]);
  assert.deepEqual(
    alphaEpics.map((epic) => epic.name),
    ['ALPHA_ONLY']
  );
  assert.deepEqual(
    betaEpics.map((epic) => epic.name),
    ['BETA_ONLY']
  );
  const alphaSchedule = await alpha.call('schedule_create', {
    name: 'ALPHA_SCHEDULE',
    specKind: 'cron',
    cronExpr: '0 0 9 * * MON',
  });
  await beta.call('schedule_create', {
    name: 'BETA_SCHEDULE',
    specKind: 'cron',
    cronExpr: '0 0 10 * * TUE',
  });
  assert.deepEqual(
    (await alpha.call('schedule_list')).map((row) => row.name),
    ['ALPHA_SCHEDULE']
  );
  assert.deepEqual(
    (await beta.call('schedule_list')).map((row) => row.name),
    ['BETA_SCHEDULE']
  );
  assert.deepEqual(await beta.call('schedule_delete', { id: alphaSchedule.id }), {
    deleted: false,
  });
  process.stdout.write('Concurrent MCP sessions remained isolated across two project databases.\n');
} finally {
  alpha.stop();
  beta.stop();
  await Promise.all([
    rm(alphaRoot, { recursive: true, force: true }),
    rm(betaRoot, { recursive: true, force: true }),
    rm(notificationsRoot, { recursive: true, force: true }),
  ]);
}
