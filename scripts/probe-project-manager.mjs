#!/usr/bin/env node
// Real-lane probe for Project Managers (docs/design-project-manager.md). The
// Rust and Vitest suites check the registry, the launch rules and the prompt
// against their fixtures; only this checks a running app: a run promoted on
// disk, opened by its key over control.sock and the supervisor link, refused
// while archived, and its memory checked when the session ends.
//
//   node scripts/probe-project-manager.mjs --app-data <dir> --project <projectPath>
//                                          [--runs-root <dir>] [--driver <test binary>]
//                                          [--argv-log <dir>] [--keep]
//
// RUN IT AGAINST AN ISOLATED INSTANCE. It promotes, renames, archives and
// removes a manager in the registry under --app-data. The recipe: build once
// (`node scripts/build-mcp-runtime.mjs && next build --webpack && tauri build
// --debug --no-bundle`), copy `src-tauri/target/debug/auric-ide` into
// `<iso>/bin/`, and give it `<iso>/Resources/` (a bare binary resolves its
// resource dir as `<exe>/../Resources`; without it every supervisor spawn fails
// with "Could not resolve MCP runtime directory") holding `auric-mcp/` and a
// `dynamic-providers/claude.json` whose `executable` is a script that writes
// its arguments to --argv-log and then waits; the same file in `<iso>/bin/
// dynamic-providers/` too, since a later directory wins over an earlier one.
// Start the binary with `HOME=<short path> CFFIXED_USER_HOME=<same>` (socket
// paths are limited to 104 bytes) and pass --app-data under that short path.
// Pre-seed `supervisor-policy.json` (0600) allowing --project. No model runs
// and nothing is spent: the "claude" the app starts is that script. With an
// isolated HOME, okf is not found (`okf: missing`), which the probe accepts.
//
// WHY A DRIVER
//   Promote, rename, archive, restore, remove and the runs list are Tauri
//   commands; nothing outside the webview can call one. The probe runs the
//   ignored test `supervisor::probe_driver::project_manager_probe_driver`,
//   which calls the functions those commands wrap on the isolated app's files.
//   Without --driver it builds the lib tests once and finds the binary.
//   Everything after that is the running app's own answer: the launch rules in
//   `admit_supervisor`, the prompt the frontend builds, the arguments Rust
//   adds, `lastLaunch`, `supervisor.json` and `validation.json`.
//
// NOT REACHABLE FROM HERE
//   Resuming a named folder (`manager_key_mismatch`, `manager_key_foreign_folder`)
//   is a UI path: neither socket takes a run folder. Those rows are covered by
//   the `launchKey` fixture test in Rust. Keying a supervisor that is live while
//   it is promoted needs the Tauri command too.
//
// Exit code 0 when every check passes, 1 on a failed check, 2 on bad usage.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(
  readFileSync(join(repo, 'src/lib/agents/supervisorManagers.fixtures.json'), 'utf8')
);

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? '');
};
const appData = flag('--app-data');
const projectArg = flag('--project');
const keep = args.includes('--keep');
if (!appData || !projectArg) {
  console.error(
    'usage: node scripts/probe-project-manager.mjs --app-data <dir> --project <projectPath> ' +
      '[--runs-root <dir>] [--driver <test binary>] [--argv-log <dir>] [--keep]'
  );
  process.exit(2);
}
const runsRoot = flag('--runs-root') ?? join(homedir(), '.auric', 'supervisors');
const argvLog = flag('--argv-log');
const controlSocket = join(appData, 'control.sock');
const linkSocket = join(appData, 'supervisor-link.sock');
const registryPath = join(appData, fixture.registryFileName);

const failures = [];
let passed = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (ok) passed += 1;
  else failures.push(label);
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
/** A Rust refusal sentence, recognised by the fixture's pattern for `code`. */
const refusedAs = (message, code) => new RegExp(fixture.refusals[code]).test(message ?? '');

// ── The driver: the Tauri-only registry operations ──────────────────────────

function findDriver() {
  const given = flag('--driver');
  if (given) return given;
  const out = execFileSync(
    'cargo',
    [
      'test',
      '--lib',
      '--no-run',
      '--message-format=json',
      '--manifest-path',
      'src-tauri/Cargo.toml',
    ],
    { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28 }
  );
  const artifact = out
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((message) => message.reason === 'compiler-artifact' && message.profile?.test);
  if (!artifact?.executable) throw new Error('cargo built no lib test binary');
  return artifact.executable;
}

const driver = findDriver();

/** Runs registry steps; one answer `{ ok, value | error }` per step. */
function registry(...steps) {
  const out = execFileSync(
    driver,
    [
      '--ignored',
      '--exact',
      'supervisor::probe_driver::project_manager_probe_driver',
      '--nocapture',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        AURIC_PROBE_APP_DATA: appData,
        AURIC_PROBE_RUNS_ROOT: runsRoot,
        AURIC_PROBE_OPS: JSON.stringify(steps),
      },
    }
  );
  return out
    .split('\n')
    .filter((line) => line.startsWith('PROBE_RESULT '))
    .map((line) => JSON.parse(line.slice('PROBE_RESULT '.length)));
}
const one = (step) => registry(step)[0];

// ── control.sock: one request per connection, as src/mcp/controlClient.ts ───

function control(method, params = {}, timeoutMs = 40_000) {
  return new Promise((resolve) => {
    const socket = net.createConnection(controlSocket);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, error: { code: 'timeout', message: `${method}: no answer` } });
    }, timeoutMs);
    socket.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: { code: 'unreachable', message: error.message } });
    });
    socket.on('connect', () => socket.write(`${JSON.stringify({ id: 1, method, params })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      resolve(JSON.parse(buffer.slice(0, newline)));
    });
  });
}

// ── supervisor-link.sock: a minimal RFC 6455 client, as probe-supervisor-link ─

function linkSession() {
  const socket = net.connect(linkSocket);
  const key = randomBytes(16).toString('base64');
  const accept = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  const waiting = new Map();
  let pending = Buffer.alloc(0);
  let upgraded = false;
  let nextId = 1;
  const frame = (text) => {
    const payload = Buffer.from(text, 'utf8');
    const mask = randomBytes(4);
    const head =
      payload.length < 126
        ? Buffer.from([0x81, 0x80 | payload.length])
        : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
    return Buffer.concat([head, mask, Buffer.from(payload.map((b, i) => b ^ mask[i % 4]))]);
  };
  const ready = new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('connect', () =>
      socket.write(
        `GET /v1 HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      )
    );
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (!upgraded) {
        const end = pending.indexOf('\r\n\r\n');
        if (end === -1) return;
        const head = pending.subarray(0, end).toString('utf8');
        if (!head.startsWith('HTTP/1.1 101') || !head.includes(accept)) {
          reject(new Error(`handshake refused: ${head.split('\r\n')[0]}`));
          return;
        }
        upgraded = true;
        pending = pending.subarray(end + 4);
        resolve();
      }
      while (pending.length >= 2) {
        let length = pending[1] & 0x7f;
        let start = 2;
        if (length === 126) [length, start] = [pending.readUInt16BE(2), 4];
        else if (length === 127) [length, start] = [Number(pending.readBigUInt64BE(2)), 10];
        if (pending.length < start + length) break;
        const opcode = pending[0] & 0x0f;
        const data = pending.subarray(start, start + length);
        pending = pending.subarray(start + length);
        if (opcode !== 0x1) continue;
        const message = JSON.parse(data.toString('utf8'));
        if (message.type === 'response' && waiting.has(message.id)) {
          waiting.get(message.id)(message);
          waiting.delete(message.id);
        }
      }
    });
  });
  return {
    ready,
    request(method, params = {}) {
      const id = nextId++;
      socket.write(frame(JSON.stringify({ v: 1, id, method, params })));
      return new Promise((resolve) => waiting.set(id, resolve));
    },
    close: () => socket.end(),
  };
}

// ── helpers over the running app ────────────────────────────────────────────

async function agentById(id) {
  const reply = await control('list_agents');
  return reply.ok ? reply.result.agents.find((agent) => agent.id === id) : undefined;
}

async function consoleOf(id, waitFor, seconds = 20) {
  let text = '';
  let offset = 0;
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const reply = await control('read_output', { agentId: id, sinceOffset: offset });
    if (reply.ok) {
      text += reply.result.text;
      offset = reply.result.endOffset;
      if (waitFor.every((needle) => text.includes(needle))) break;
    }
    await sleep(500);
  }
  return text;
}

/** The newest argv the dummy provider logged since `since` (ms), if it logs any. */
function argvSince(since) {
  if (!argvLog || !existsSync(argvLog)) return null;
  const newest = readdirSync(argvLog)
    .map((name) => join(argvLog, name))
    .filter((file) => statSync(file).mtimeMs >= since)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return newest ? readFileSync(newest, 'utf8') : null;
}

async function kill(id) {
  await control('kill', { agentId: id });
  for (let i = 0; i < 20 && (await agentById(id))?.status === 'running'; i += 1) await sleep(250);
}

async function waitForFile(file, seconds) {
  for (let i = 0; i < seconds * 4 && !existsSync(file); i += 1) await sleep(250);
  return existsSync(file);
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const recordOf = (key) => readJson(registryPath).managers.find((m) => m.key === key);
const denyRules = fixture.instructions.denyRules;

// ── 1. Pre-flight ───────────────────────────────────────────────────────────

const project = realpathSync(projectArg);
const pong = await control('list_agents', {}, 5000);
if (!pong.ok) {
  console.error(`control.sock at ${controlSocket} does not answer: ${pong.error.message}`);
  process.exit(2);
}
const link = linkSession();
try {
  await link.ready;
} catch (error) {
  console.error(`supervisor-link.sock does not answer: ${error.message}`);
  process.exit(2);
}
const hello = await link.request('session.hello', { client: 'probe-project-manager' });
check(hello.ok, 'the supervisor link answers', hello.ok ? '' : hello.error?.code);

// ── 2. Promote ──────────────────────────────────────────────────────────────

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const runName = `probe-${stamp}`;
const otherRun = `probe-${stamp}-other`;
const run = join(runsRoot, runName);
mkdirSync(run, { recursive: true });
mkdirSync(join(runsRoot, otherRun), { recursive: true });
const NOTE = 'notes written before the promotion\n';
writeFileSync(join(run, 'notes.md'), NOTE);
const KEY = `probe-desk-${stamp.slice(-6)}`;
const NAME = `Probe Desk ${stamp.slice(-6)}`;

// The key comes from the run's supervisor.json, as a run with an address keeps it.
writeFileSync(join(run, 'supervisor.json'), JSON.stringify({ key: KEY }));
const promoted = one({ op: 'promote', runDir: runName, name: NAME });
check(promoted.ok, 'promote answers a record', promoted.error ?? '');
check(
  promoted.value?.key === KEY,
  'the run keeps the key its supervisor.json names',
  promoted.value?.key
);

const mode = statSync(registryPath).mode & 0o777;
check(mode === 0o600, `${fixture.registryFileName} is private`, `mode ${mode.toString(8)}`);
const onDisk = readJson(registryPath);
const record = onDisk.managers.find((m) => m.key === KEY);
check(
  onDisk.version === fixture.registryVersion &&
    record?.runDir === runName &&
    record?.name === NAME &&
    record?.archivedAt === null,
  'the registry holds the record: folder name, name, not archived',
  JSON.stringify(record)
);
const instructionsFile = join(run, fixture.instructions.fileName);
check(
  existsSync(instructionsFile) &&
    readFileSync(instructionsFile, 'utf8').startsWith(`# Instructions for ${NAME}`),
  'promotion wrote INSTRUCTIONS.md from the template'
);
const bundle = join(run, fixture.memory.bundleDir);
const rootIndex = existsSync(join(bundle, 'index.md'))
  ? readFileSync(join(bundle, 'index.md'), 'utf8')
  : '';
check(
  rootIndex.includes(`okf_version: "${fixture.memory.okfVersion}"`),
  'promotion wrote knowledge/index.md with the okf version'
);
check(readFileSync(join(run, 'notes.md'), 'utf8') === NOTE, 'the folder keeps what was in it');

const [taken, nameTaken, nameInvalid, missing] = registry(
  { op: 'promote', runDir: runName, name: 'Another Name' },
  { op: 'promote', runDir: otherRun, name: NAME.toLowerCase() },
  { op: 'promote', runDir: otherRun, name: '   ' },
  { op: 'promote', runDir: `${runName}-gone`, name: 'Gone' }
);
check(refusedAs(taken.error, 'manager_run_taken'), 'a folder is promoted once', taken.error);
check(
  refusedAs(nameTaken.error, 'manager_name_taken'),
  'names are unique ignoring case',
  nameTaken.error
);
check(
  refusedAs(nameInvalid.error, 'manager_name_invalid'),
  'a blank name is refused',
  nameInvalid.error
);
check(
  refusedAs(missing.error, 'manager_run_missing'),
  'a missing folder is refused',
  missing.error
);

// ── 3. Rename and the runs list ─────────────────────────────────────────────

const RENAMED = `${NAME} Two`;
const renamed = one({ op: 'rename', key: KEY, name: RENAMED });
check(
  renamed.ok && renamed.value.key === KEY && renamed.value.name === RENAMED,
  'rename changes the name, never the key',
  renamed.error ?? `${renamed.value?.key} / ${renamed.value?.name}`
);
const runs = one({ op: 'runs' }).value ?? [];
const managerRun = runs.find((entry) => entry.name === runName);
const plainRun = runs.find((entry) => entry.name === otherRun);
check(
  managerRun?.manager?.key === KEY &&
    managerRun.manager.name === RENAMED &&
    (plainRun?.manager ?? null) === null,
  'the runs list marks the manager folder and only it',
  JSON.stringify(managerRun?.manager)
);

// ── 4. Open by key over control.sock ────────────────────────────────────────

const MARKER = `PROBE-MARKER-${randomBytes(4).toString('hex')}`;
appendFileSync(instructionsFile, `\n- ${MARKER}\n`);
const opened = Date.now();
const spawned = await control('spawn', {
  projectPath: project,
  prompt: 'probe: say hello and wait',
  role: 'supervisor',
  supervisorKey: KEY,
});
check(spawned.ok, 'spawn { role: supervisor, supervisorKey } starts', spawned.error?.message ?? '');
const managerId = spawned.result?.agentId;
const listed = managerId ? await agentById(managerId) : undefined;
check(
  listed?.repoPath && realpathSync(listed.repoPath) === realpathSync(run),
  "a new launch under the key resumes the manager's folder",
  listed?.repoPath
);
check(listed?.supervisorKey === KEY, 'it runs under the key', listed?.supervisorKey);
check(listed?.name === RENAMED, "its card carries the manager's name", listed?.name);

const screen = managerId
  ? await consoleOf(managerId, [MARKER, `You are the Project Manager "${RENAMED}"`])
  : '';
check(
  screen.includes(`You are the Project Manager "${RENAMED}"`) &&
    screen.includes(`Instructions for ${RENAMED}`),
  'the launch prompt has the manager sections'
);
check(screen.includes(MARKER), 'the launch prompt carries INSTRUCTIONS.md');

const instructionsText = readFileSync(instructionsFile, 'utf8');
const launched = recordOf(KEY)?.lastLaunch;
check(
  launched?.instructionsSha256 === createHash('sha256').update(instructionsText).digest('hex'),
  'lastLaunch holds the hash of what was injected',
  launched?.instructionsSha256?.slice(0, 12)
);
check(
  existsSync(join(run, 'supervisor.json')) && readJson(join(run, 'supervisor.json')).key === KEY,
  'supervisor.json names the registry key'
);
const managerArgv = argvSince(opened);
if (managerArgv !== null) {
  check(
    denyRules.every((rule) => managerArgv.includes(rule)) &&
      managerArgv.includes('--disallowedTools'),
    'the manager launch carries the INSTRUCTIONS.md deny rules',
    denyRules.join(' ')
  );
}

// ── 5. One instance per key ─────────────────────────────────────────────────

const again = await control('spawn', {
  projectPath: project,
  prompt: 'x',
  role: 'supervisor',
  supervisorKey: KEY,
});
check(
  !again.ok && again.error.code === 'supervisor_key_in_use',
  'a second launch under the key is refused',
  again.ok ? 'started' : again.error.code
);
const existing = await link.request('supervisors.spawn', { key: KEY, if: 'existing' });
check(
  existing.ok && existing.result.agentId === managerId && existing.result.existing === true,
  'supervisors.spawn { key, if: existing } answers the live manager',
  existing.ok ? JSON.stringify(existing.result) : existing.error?.code
);

// ── 6. A plain supervisor next to it ────────────────────────────────────────

const plainStarted = Date.now();
const plain = await control('spawn', { projectPath: project, prompt: 'x', role: 'supervisor' });
const plainAgent = plain.ok ? await agentById(plain.result.agentId) : undefined;
check(
  plainAgent?.repoPath && realpathSync(plainAgent.repoPath) !== realpathSync(run),
  'a supervisor without a key gets a folder of its own',
  plainAgent?.repoPath
);
await consoleOf(plain.result?.agentId ?? '', ['--permission-mode'], 10);
const plainArgv = argvSince(plainStarted);
if (plainArgv !== null) {
  check(
    !plainArgv.includes('--disallowedTools') && !plainArgv.includes(fixture.instructions.fileName),
    'a plain supervisor launch carries no deny rules'
  );
}
if (plain.ok) await kill(plain.result.agentId);

// ── 7. Session end: the memory check ────────────────────────────────────────

const facts = join(bundle, 'facts');
mkdirSync(facts, { recursive: true });
writeFileSync(join(facts, 'no-front-matter.md'), 'A concept without front matter.\n');
const validationFile = join(appData, 'managers', KEY, fixture.validationFileName);
if (managerId) await kill(managerId);
const validated = await waitForFile(validationFile, 30);
check(validated, 'ending the session writes validation.json');
if (validated) {
  const summary = readJson(validationFile);
  check(
    ['ok', 'findings', 'missing', 'outdated', 'unrecognised', 'failed'].includes(summary.okf) &&
      typeof summary.checkedAt === 'string',
    'validation.json carries an okf state and a check time',
    `okf ${summary.okf}`
  );
  check(
    summary.findings?.some(
      (finding) => finding.source === 'layout' && finding.path?.includes('no-front-matter.md')
    ),
    'the layout check names the broken concept',
    `${summary.findings?.length ?? 0} findings`
  );
}

// ── 8. Archive, restore, remove ─────────────────────────────────────────────

const archived = one({ op: 'archive', key: KEY });
check(archived.ok && typeof archived.value.archivedAt === 'string', 'archive sets archivedAt');
const refusedControl = await control('spawn', {
  projectPath: project,
  prompt: 'x',
  role: 'supervisor',
  supervisorKey: KEY,
});
check(
  !refusedControl.ok && refusedAs(refusedControl.error.message, 'manager_archived'),
  'control.sock refuses an archived manager',
  refusedControl.ok ? 'started' : `${refusedControl.error.code}: ${refusedControl.error.message}`
);
const refusedLink = await link.request('supervisors.spawn', { key: KEY });
check(
  !refusedLink.ok && refusedAs(refusedLink.error.message, 'manager_archived'),
  'the link refuses an archived manager',
  refusedLink.ok ? 'started' : `${refusedLink.error.code}: ${refusedLink.error.message}`
);
for (const reply of [refusedControl, refusedLink]) {
  if (reply.ok) await kill(reply.result.agentId);
}
check(
  refusedLink.ok || refusedLink.error.code === 'manager_archived',
  'the link names the refusal by its code',
  refusedLink.ok ? '' : refusedLink.error.code
);

const restored = one({ op: 'restore', key: KEY });
check(restored.ok && restored.value.archivedAt === null, 'restore clears archivedAt');
const reopened = await link.request('supervisors.spawn', { key: KEY });
const reopenedAgent = reopened.ok ? await agentById(reopened.result.agentId) : undefined;
check(
  reopenedAgent?.repoPath && realpathSync(reopenedAgent.repoPath) === realpathSync(run),
  'after restore, supervisors.spawn { key } resumes the folder again',
  reopened.ok ? reopenedAgent?.repoPath : reopened.error?.code
);
if (reopened.ok && !keep) await kill(reopened.result.agentId);

const notArchived = one({ op: 'remove', key: KEY });
check(
  refusedAs(notArchived.error, 'manager_not_archived'),
  'remove needs an archived manager',
  notArchived.error
);
if (!keep) {
  const [, removed, after] = registry(
    { op: 'archive', key: KEY },
    { op: 'remove', key: KEY },
    { op: 'runs' }
  );
  const back = after.value?.find((entry) => entry.name === runName);
  check(
    removed.ok &&
      !recordOf(KEY) &&
      existsSync(instructionsFile) &&
      back &&
      (back.manager ?? null) === null,
    'remove forgets the record; the folder stays an ordinary run'
  );
}

link.close();
console.log(
  `\n${passed} of ${passed + failures.length} checks passed` +
    (failures.length ? `\nprobe FAILED: ${failures.join('; ')}` : '\nprobe passed')
);
process.exit(failures.length ? 1 : 0);
