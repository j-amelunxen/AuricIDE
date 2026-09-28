#!/usr/bin/env node
// Probes how the Antigravity CLI (`agy`) behaves when AuricIDE runs it the way
// the conductor does: headless, unattended, under a PTY, with the permission
// flags from dynamic-providers/antigravity.json. `agy` is third-party and not
// pinned, so its behaviour is measured here rather than assumed. Run it again
// after an `agy` update; every case prints what actually happened.
//
//   node scripts/probe-agy-headless.mjs [--only A,B] [--model <id>] [--long] [--root <dir>]
//
// Costs real model turns. Each case runs in its own throwaway git repo under
// the OS temp dir and has a hard outer timeout, so a hang shows up as TIMEOUT
// instead of blocking the probe. Case F adds a probe entry to agy's global MCP
// config and removes it again, even when the run is interrupted.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? '');
};
const only =
  flag('--only')
    ?.split(',')
    .map((s) => s.trim().toUpperCase()) ?? null;
const model = flag('--model') ?? 'gemini-3.8-flash-low';
const long = args.includes('--long');
// Where the throwaway repos go. The OS temp dir by default; pass a folder under
// $HOME to see whether the sandbox treats a temp-dir workspace differently.
const probeRoot = flag('--root') ?? tmpdir();

// What antigravity.json produces for permission mode `auto`.
const PERMISSION = '--sandbox --dangerously-skip-permissions';
const PROBE_MCP = 'auric-agy-probe';

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function makeRepo(label) {
  const dir = mkdtempSync(join(probeRoot, `agy-probe-${label}-`));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'probe@example.invalid');
  git('config', 'user.name', 'probe');
  writeFileSync(join(dir, 'README.md'), '# probe\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  return dir;
}

function makeWorktree(label) {
  const main = makeRepo(`${label}-main`);
  const wt = `${main}-wt`;
  spawnSync('git', ['worktree', 'add', '-q', wt, '-b', 'probe'], { cwd: main });
  return { main, wt };
}

/**
 * Runs one agy command under a PTY (`script`), the way the IDE's PTY does,
 * and resolves with exit code, duration and the output tail.
 */
function runAgy({ cwd, prompt, extra = '', timeoutMs, env = {} }) {
  const cmd = `agy --model ${model} -p ${shellQuote(prompt)} ${extra} ${PERMISSION}`;
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn('script', ['-q', '/dev/null', '/bin/zsh', '-c', cmd], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        cmd,
        code: timedOut ? 'TIMEOUT' : code,
        seconds: Math.round((Date.now() - started) / 1000),
        tail: out
          .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
          .trim()
          .split('\n')
          .slice(-12)
          .join('\n'),
      });
    });
  });
}

const MIN = 60_000;

// A shell command that outlasts agy's default 5m print timeout.
const LONG_SLEEP = long ? 330 : 20;

const cases = {
  A: {
    title: `Long task, default --print-timeout (sleep ${LONG_SLEEP}s)`,
    run: () =>
      runAgy({
        cwd: makeRepo('a'),
        prompt: `Run the shell command \`sleep ${LONG_SLEEP}\` and wait for it. Then reply with exactly DONE.`,
        timeoutMs: 12 * MIN,
      }),
  },
  B: {
    title: `Long task, --print-timeout 24h (sleep ${LONG_SLEEP}s)`,
    run: () =>
      runAgy({
        cwd: makeRepo('b'),
        prompt: `Run the shell command \`sleep ${LONG_SLEEP}\` and wait for it. Then reply with exactly DONE.`,
        extra: '--print-timeout 24h',
        timeoutMs: 12 * MIN,
      }),
  },
  B0: {
    title: 'Short task, --print-timeout 0 (what does 0 mean?)',
    run: () =>
      runAgy({
        cwd: makeRepo('b0'),
        prompt: 'Reply with exactly PONG.',
        extra: '--print-timeout 0',
        timeoutMs: 4 * MIN,
      }),
  },
  C: {
    title: 'Prompt starts with /goal (conductor ticket prompt shape)',
    run: () =>
      runAgy({
        cwd: makeRepo('c'),
        prompt: '/goal\n\n## Task\nReply with exactly PONG.',
        timeoutMs: 4 * MIN,
      }),
  },
  C2: {
    title: 'Prompt starts with /goal, --disable-slash-commands',
    run: () =>
      runAgy({
        cwd: makeRepo('c2'),
        prompt: '/goal\n\n## Task\nReply with exactly PONG.',
        extra: '--disable-slash-commands',
        timeoutMs: 4 * MIN,
      }),
  },
  D: {
    title: 'Sandbox: write inside/outside, network, npm registry, git commit',
    run: async () => {
      const cwd = makeRepo('d');
      const outside = join(homedir(), `agy-probe-outside-${Date.now()}.txt`);
      const result = await runAgy({
        cwd,
        prompt:
          'Run each of these shell commands separately and report each exit code on its own line ' +
          'as "<n>: <exit code>". Do not ask for permission, do not retry outside the sandbox.\n' +
          `1. echo hi > inside.txt\n2. echo hi > ${outside}\n3. curl -sS -o /dev/null -w "%{http_code}" https://example.com\n` +
          '4. npm view left-pad version\n5. git add -A && git commit -m probe',
        timeoutMs: 8 * MIN,
      });
      const log = spawnSync('git', ['log', '--oneline'], { cwd, encoding: 'utf8' }).stdout;
      result.checks = {
        insideWritten: existsSync(join(cwd, 'inside.txt')),
        outsideWritten: existsSync(outside),
        committed: log.includes('probe'),
      };
      rmSync(outside, { force: true });
      return result;
    },
  },
  D2: {
    title: 'Sandbox in a git worktree: commit (its .git lives outside the cwd)',
    run: async () => {
      const { main, wt } = makeWorktree('d2');
      const result = await runAgy({
        cwd: wt,
        prompt:
          'Run: echo hi > wt.txt && git add -A && git commit -m probe-wt ; then report the exit code. ' +
          'Do not retry outside the sandbox.',
        timeoutMs: 6 * MIN,
      });
      const log = spawnSync('git', ['log', '--oneline', 'probe'], { cwd: main, encoding: 'utf8' });
      result.checks = { committed: log.stdout.includes('probe-wt') };
      return result;
    },
  },
  D3: {
    title: 'Sandbox: file-edit tool (not the shell) writes inside the cwd',
    run: async () => {
      const cwd = makeRepo('d3');
      const result = await runAgy({
        cwd,
        prompt:
          'Create the file note.txt containing "hi" with your file writing tool. Do not use the shell. Then reply DONE.',
        timeoutMs: 4 * MIN,
      });
      result.checks = { written: existsSync(join(cwd, 'note.txt')) };
      return result;
    },
  },
  D4: {
    title: 'Sandbox: shell write + commit with --add-dir <cwd>',
    run: async () => {
      const cwd = makeRepo('d4');
      const result = await runAgy({
        cwd,
        prompt:
          'Run: echo hi > inside.txt && git add -A && git commit -m probe ; then report the exit code. ' +
          'Do not retry outside the sandbox.',
        extra: `--add-dir ${shellQuote(cwd)}`,
        timeoutMs: 4 * MIN,
      });
      const log = spawnSync('git', ['log', '--oneline'], { cwd, encoding: 'utf8' }).stdout;
      result.checks = {
        written: existsSync(join(cwd, 'inside.txt')),
        committed: log.includes('probe'),
      };
      return result;
    },
  },
  E: {
    title: 'Command waiting on stdin (read x)',
    run: () =>
      runAgy({
        cwd: makeRepo('e'),
        prompt:
          'Run the shell command `read x; echo got:$x` exactly once. Whatever happens, then reply DONE.',
        timeoutMs: 10 * MIN,
      }),
  },
  F: {
    title: 'Global MCP server: does it inherit the env of the agy process?',
    run: async () => {
      const dir = makeRepo('f');
      const server = join(dir, 'probe-mcp.mjs');
      writeFileSync(server, PROBE_SERVER);
      const added = spawnSync('agy', ['mcp', 'add', PROBE_MCP, process.execPath, server], {
        encoding: 'utf8',
      });
      try {
        const result = await runAgy({
          cwd: dir,
          prompt: `Call the MCP tool env_probe from the ${PROBE_MCP} server once and reply with its exact output.`,
          env: { AURIC_PROBE_TOKEN: 'inherited-7f3a' },
          timeoutMs: 6 * MIN,
        });
        result.checks = {
          added: added.status === 0,
          inherited: result.tail.includes('inherited-7f3a'),
        };
        return result;
      } finally {
        spawnSync('agy', ['mcp', 'remove', PROBE_MCP]);
      }
    },
  },
  F2: {
    title: 'Global MCP server that serves no tools (unbound): does the turn still run?',
    run: async () => {
      const dir = makeRepo('f2');
      const server = join(dir, 'probe-mcp.mjs');
      writeFileSync(server, PROBE_SERVER);
      spawnSync('agy', ['mcp', 'add', PROBE_MCP, '--', process.execPath, server, '--no-tools']);
      try {
        return await runAgy({ cwd: dir, prompt: 'Reply with exactly PONG.', timeoutMs: 4 * MIN });
      } finally {
        spawnSync('agy', ['mcp', 'remove', PROBE_MCP]);
      }
    },
  },
  G: {
    title: 'Agent gives up: exit code?',
    run: () =>
      runAgy({
        cwd: makeRepo('g'),
        prompt:
          'You cannot complete this task. Reply with "I could not complete the task" and stop.',
        timeoutMs: 4 * MIN,
      }),
  },
};

// Minimal stdio MCP server: one tool that echoes AURIC_PROBE_TOKEN from its env.
const PROBE_SERVER = `
import { createInterface } from 'node:readline';
const noTools = process.argv.includes('--no-tools');
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  if (req.id === undefined) return;
  if (req.method === 'initialize') {
    send({ jsonrpc: '2.0', id: req.id, result: {
      protocolVersion: req.params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} }, serverInfo: { name: 'probe', version: '0.0.0' } } });
  } else if (req.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: req.id, result: { tools: noTools ? [] : [{
      name: 'env_probe', description: 'Returns a token from the environment',
      inputSchema: { type: 'object', properties: {} } }] } });
  } else if (req.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text',
      text: 'token=' + (process.env.AURIC_PROBE_TOKEN ?? '<unset>') }] } });
  } else {
    send({ jsonrpc: '2.0', id: req.id, result: {} });
  }
});
`;

process.on('SIGINT', () => {
  spawnSync('agy', ['mcp', 'remove', PROBE_MCP]);
  process.exit(130);
});

const selected = Object.entries(cases).filter(([id]) => !only || only.includes(id));
// F and F2 share the global MCP entry, so they run after the parallel batch, one at a time.
const serial = new Set(['F', 'F2']);
const results = {};
await Promise.all(
  selected.filter(([id]) => !serial.has(id)).map(async ([id, c]) => (results[id] = await c.run()))
);
for (const [id, c] of selected.filter(([id]) => serial.has(id))) results[id] = await c.run();

console.log(
  `\nagy ${spawnSync('agy', ['--version'], { encoding: 'utf8' }).stdout.trim()}, model ${model}\n`
);
for (const [id, c] of selected) {
  const r = results[id];
  console.log(`=== ${id}: ${c.title}`);
  console.log(
    `exit=${r.code} after ${r.seconds}s${r.checks ? ` checks=${JSON.stringify(r.checks)}` : ''}`
  );
  console.log(r.tail.replace(/^/gm, '  | '));
  console.log('');
}
if (existsSync(join(homedir(), '.gemini/config/mcp_config.json'))) {
  const cfg = readFileSync(join(homedir(), '.gemini/config/mcp_config.json'), 'utf8');
  if (cfg.includes(PROBE_MCP)) console.log(`WARNING: ${PROBE_MCP} is still in mcp_config.json`);
}
