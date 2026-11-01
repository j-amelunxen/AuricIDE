#!/usr/bin/env node
/**
 * What a supervisor start costs in tool names, MCP config and (with --real) in
 * tokens: one PM server per project against the single `auric-supervisor` server
 * with its `pm_tools` / `pm_call` gateway.
 *
 *   node scripts/measure-supervisor-start.mjs --work-dir <empty temp dir> [--projects 27] [--real]
 *
 * The tool names come from the real server: it runs against a temporary project
 * database and answers `tools/list`. `--real` also asks the Claude CLI for one
 * word under each config and reads the usage from its JSON. Nothing here reads
 * or writes the running app's data: the control socket it names does not exist.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'work-dir': { type: 'string' },
    projects: { type: 'string', default: '27' },
    real: { type: 'boolean', default: false },
    model: { type: 'string', default: 'claude-haiku-5-5' },
  },
});
if (!values['work-dir']) throw new Error('--work-dir <empty temp dir> is required');
const workDir = resolve(values['work-dir']);
const projectCount = Number(values.projects);
const REPO_ROOT = resolve(import.meta.dirname, '..');
const NODE = process.execPath;
const SERVER = join(REPO_ROOT, 'src/mcp/server.ts');
// Absolute: the CLI starts these servers from its own working directory.
const TSX = createRequire(join(REPO_ROOT, 'package.json')).resolve('tsx');
const RUNTIME = ['--import', pathToFileURL(TSX).href, SERVER];
const NO_SOCKET = join(workDir, 'no-such-control.sock');
// The path aliases too: the working directory is not this repository.
const TSCONFIG = { TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.json') };
const CHILD_ENV = {
  ...TSCONFIG,
  AURIC_NOTIFICATIONS_DB: join(workDir, 'inbox.db'),
  AURIC_AGENT_PROVIDERS: 'claude,codex',
};

/** Asks one server for its tools over newline JSON-RPC. */
async function listTools(args, env) {
  const child = spawn(NODE, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const answers = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    answers.get(message.id)?.(message.result);
  });
  const request = (id, method, params) =>
    new Promise((done) => {
      answers.set(id, done);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  await request(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'measure', version: '0' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const { tools } = await request(2, 'tools/list', {});
  child.kill();
  return tools.map((tool) => tool.name);
}

function makeProject(index) {
  const dir = join(workDir, `project-${String(index).padStart(2, '0')}`);
  mkdirSync(join(dir, '.auric'), { recursive: true });
  // The server creates its schema on first open, once a listing or call runs it.
  return dir;
}

function createDatabase(dir) {
  const result = spawnSync(
    NODE,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `import { openDatabase } from ${JSON.stringify(join(REPO_ROOT, 'src/mcp/db.ts'))};` +
        `openDatabase(${JSON.stringify(join(dir, '.auric/project.db'))}).close();`,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
  if (result.status !== 0) throw new Error(result.stderr);
}

const serverName = (index) => `auric-pm-project-${String(index).padStart(2, '0')}`;

const projects = Array.from({ length: projectCount }, (_, index) => makeProject(index));
createDatabase(projects[0]);
const [pmTools, supervisorTools] = await Promise.all([
  listTools([...RUNTIME, '--project-root', projects[0]], CHILD_ENV),
  listTools([...RUNTIME, '--supervisor'], {
    AURIC_CONTROL_SOCKET: NO_SOCKET,
    AURIC_PM_CHILD_ENV: JSON.stringify(CHILD_ENV),
  }),
]);

const supervisorEntry = (extraEnv) => ({
  command: NODE,
  args: [...RUNTIME, '--supervisor'],
  env: { ...TSCONFIG, AURIC_CONTROL_SOCKET: NO_SOCKET, ...extraEnv },
});

const before = {
  mcpServers: {
    'auric-supervisor': supervisorEntry({}),
    ...Object.fromEntries(
      projects.map((dir, index) => [
        serverName(index),
        { command: NODE, args: [...RUNTIME, '--project-root', dir], env: CHILD_ENV },
      ])
    ),
  },
};
const after = {
  mcpServers: {
    'auric-supervisor': supervisorEntry({ AURIC_PM_CHILD_ENV: JSON.stringify(CHILD_ENV) }),
  },
};

const prefixed = (server, names) => names.map((name) => `mcp__${server}__${name}`);
const withoutGateway = supervisorTools.filter((name) => name !== 'pm_tools' && name !== 'pm_call');
const namesBefore = [
  ...prefixed('auric-supervisor', withoutGateway),
  ...projects.flatMap((_, index) => prefixed(serverName(index), pmTools)),
];
const namesAfter = prefixed('auric-supervisor', supervisorTools);

const beforeFile = join(workDir, 'before.mcp.json');
const afterFile = join(workDir, 'after.mcp.json');
writeFileSync(beforeFile, JSON.stringify(before, null, 2));
writeFileSync(afterFile, JSON.stringify(after, null, 2));

const bytes = (text) => Buffer.byteLength(text);
const row = (names, config) => {
  const list = bytes(names.join('\n'));
  return {
    tools: names.length,
    nodeProcessesAtStart: Object.keys(config.mcpServers).length,
    toolNameBytes: list,
    toolNameTokensEstimate: Math.round(list / 4),
    mcpConfigBytes: bytes(JSON.stringify(config, null, 2)),
  };
};
const report = {
  projects: projectCount,
  pmToolsPerProject: pmTools.length,
  before: row(namesBefore, before),
  after: row(namesAfter, after),
};

/** One word from the CLI under one config; usage is what the start really carried. */
function realRun(configFile, cwd) {
  const result = spawnSync(
    'claude',
    [
      '-p',
      'reply ok',
      '--model',
      values.model,
      '--output-format',
      'stream-json',
      '--verbose',
      '--strict-mcp-config',
      '--mcp-config',
      configFile,
      '--tools',
      'ToolSearch',
    ],
    {
      cwd,
      // Wait for every server, or the first request goes out before they listed a tool.
      env: { ...process.env, MCP_CONNECTION_NONBLOCKING: 'false', MCP_TIMEOUT: '180000' },
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  if (result.status !== 0)
    return { failed: result.stderr || result.stdout || String(result.error) };
  const messages = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const init = messages.find((message) => message.subtype === 'init');
  const {
    usage,
    is_error: isError,
    total_cost_usd: cost,
  } = messages.find((message) => message.type === 'result');
  // A server that did not connect lists no tools; its row would flatter the old form.
  const serverStatus = {};
  for (const { status } of init.mcp_servers) serverStatus[status] = (serverStatus[status] ?? 0) + 1;
  return {
    isError,
    serverStatus,
    toolsAtInit: init.tools.length,
    input: usage.input_tokens,
    cacheCreation: usage.cache_creation_input_tokens,
    cacheRead: usage.cache_read_input_tokens,
    total: usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens,
    cost,
  };
}

if (values.real) {
  for (const dir of projects.slice(1)) createDatabase(dir);
  const cwd = join(workDir, 'cwd');
  mkdirSync(cwd, { recursive: true });
  report.real = { before: realRun(beforeFile, cwd), after: realRun(afterFile, cwd) };
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
