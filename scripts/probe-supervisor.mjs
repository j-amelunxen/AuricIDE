#!/usr/bin/env node
// Real-lane probe for the supervisor agent (ADR 0004, docs/design-agent-control.md
// "Supervisor scope"). The Rust tests drive the dispatcher against a fake
// backend and the policy against its fixtures; only this checks the running
// app: a supervisor started over the control socket, a headless child it
// spawns itself, the answer coming back, and a refusal at the socket.
//
//   node scripts/probe-supervisor.mjs --project <projectPath> [--timeout 240] [--keep]
//                                     [--socket <control.sock>] [--policy <supervisor-policy.json>]
//
// WHAT IT DOES
//   1. Pre-flight (no agent started): reads supervisor-policy.json and checks
//      that <projectPath> is listed with allowed: true, that the file is mode
//      0600, and that the socket answers.
//   2. Starts a supervisor as an external client (`spawn { role: "supervisor" }`)
//      with a scripted prompt. The prompt tells it to
//        a. call list_projects for that project,
//        b. spawn ONE headless agent in <projectPath> with the smallest-rank
//           model the policy offers for it, prompt "Reply with exactly: ANSWER: PONG",
//        c. await_agent_result and print a line   RESULT=<the answer's text after ANSWER:>
//        d. then try ONCE to spawn a headless agent with the model
//           "no-such-model-xyz" on the same provider, expect a refusal and
//           print a line   DENIED=<the reason key of the refusal>
//           (it must not retry, switch model or provider).
//   3. Polls the supervisor's console (read_output, sinceOffset) until both
//      lines are there or --timeout seconds pass.
//   4. Checks from outside: the supervisor is listed with role "supervisor";
//      the child is listed with spawnedByAgentId = the supervisor and ran
//      headless; no agent the supervisor started is interactive; no second
//      child was started by the refused spawn.
//   5. Kills the supervisor and any child still running (skipped with --keep).
//
// PASS = RESULT=PONG and DENIED=model_not_allowed|model_not_offered, plus the
// checks in 4. Exit code 0 on pass, 1 on a failed check, 2 on bad usage or a
// failed pre-flight.
//
// WHY THE NEGATIVE CHECK GOES THROUGH THE SUPERVISOR
//   The probe is an external process: the socket calls it External and admits
//   every method, so a refusal cannot be provoked from here (an external spawn
//   of a disallowed model simply works — that is ADR 0003's design). The
//   scope checks (supervisor_denied, unknown_agent, outside_supervisor_scope)
//   only exist for the supervisor's own connection, so the supervisor is asked
//   to run into one. Its console is a terminal UI that redraws, so the two
//   result lines are matched loosely (the prompt itself spells them with
//   placeholders so an echo of the prompt cannot satisfy the match).
//
// Needs a running AuricIDE (dev or installed), a supervisor-policy.json that
// allows <projectPath> with `claude` and at least one headless-capable model,
// and a project that has been opened once in the IDE (.auric/project.db).
// This starts real model runs and costs a few cents. Never run it in CI.

import net from 'node:net';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? '');
};
const keep = args.includes('--keep');
const projectArg = flag('--project');
const timeoutSeconds = Number(flag('--timeout') ?? 240);
const appData = join(homedir(), 'Library', 'Application Support', 'com.auricide.ide');
const socketPath =
  flag('--socket') ?? process.env.AURIC_CONTROL_SOCKET ?? join(appData, 'control.sock');
const policyPath = flag('--policy') ?? join(appData, 'supervisor-policy.json');

if (!projectArg || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
  console.error(
    'usage: node scripts/probe-supervisor.mjs --project <projectPath> [--timeout 240] [--keep]'
  );
  process.exit(2);
}

const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(label);
};

/** One request, one connection, as src/mcp/controlClient.ts does. */
function callSocket(method, params = {}, timeoutMs = 40_000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`${method}: no answer within ${timeoutMs} ms`));
    }, timeoutMs);
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`${method}: ${error.message}`));
    });
    socket.on('connect', () => socket.write(`${JSON.stringify({ id: 1, method, params })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      socket.end();
      const reply = JSON.parse(buffer.slice(0, newline));
      if (reply.ok) resolve(reply.result);
      else {
        const { code, message, reason } = reply.error;
        reject(Object.assign(new Error(`${method}: ${code}: ${message}`), { code, reason }));
      }
    });
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ── 1. Pre-flight ───────────────────────────────────────────────────────────

let project;
try {
  project = realpathSync(projectArg);
} catch {
  console.error(`project does not exist: ${projectArg}`);
  process.exit(2);
}
if (!existsSync(join(project, '.auric', 'project.db'))) {
  console.error(`${project} is not an AuricIDE project (no .auric/project.db); open it once first`);
  process.exit(2);
}
if (!existsSync(policyPath)) {
  console.error(
    `no supervisor policy at ${policyPath}; allow the project under Settings → Supervisor`
  );
  process.exit(2);
}
const mode = statSync(policyPath).mode & 0o777;
check(mode === 0o600, 'supervisor-policy.json is private', `mode ${mode.toString(8)}`);
let policy;
try {
  policy = JSON.parse(readFileSync(policyPath, 'utf8'));
} catch (error) {
  console.error(`policy is not valid JSON: ${error.message}`);
  process.exit(2);
}
const entry = Object.entries(policy.projects ?? {}).find(([key]) => {
  try {
    return realpathSync(key) === project;
  } catch {
    return false;
  }
})?.[1];
if (!entry?.allowed) {
  console.error(`the policy does not allow ${project}; allow it under Settings → Supervisor`);
  process.exit(2);
}
console.log(
  `policy: ${project} allowed; providers ${JSON.stringify(entry.providers ?? 'any')}, ` +
    `models ${JSON.stringify(entry.models ?? {})}, interactive ${Boolean(entry.allowInteractive)}, ` +
    `maxRunning ${entry.maxRunning ?? 2}`
);
if (failures.length) process.exit(2);
try {
  await callSocket('list_agents', {}, 5000);
} catch (error) {
  console.error(`the control socket at ${socketPath} does not answer: ${error.message}`);
  process.exit(2);
}

// ── 2. Start the supervisor ─────────────────────────────────────────────────

const PROMPT = [
  'You are being probed. Follow these steps exactly, using only your auric-supervisor tools.',
  `1. Call list_projects with project ${project}. Note the claude models it allows there ("all" means every claude entry of the catalog) and their rank in the catalog.`,
  `2. Call spawn_agent once: projectPath ${project}, provider claude, headless true, model = the allowed claude model with the SMALLEST rank, prompt "Reply with exactly: ANSWER: PONG".`,
  '3. Call await_agent_result on the returned agentId until done is true (repeat on done false).',
  '4. Print one line that starts with RESULT= followed directly by the text after "ANSWER:" in the child\'s answer.',
  `5. Call spawn_agent exactly once more: projectPath ${project}, provider claude, headless true, model "no-such-model-xyz", prompt "x". It must be refused. Do not retry, do not change model or provider, do not start anything else.`,
  '6. Print one line that starts with DENIED= followed directly by the reason key of the refusal (the word in brackets after supervisor_denied, such as model_not_allowed).',
  '7. Stop. Do not use Bash, Edit or any tool other than the auric-supervisor tools.',
].join('\n');

const { agentId: supervisorId } = await callSocket('spawn', {
  projectPath: project,
  prompt: PROMPT,
  role: 'supervisor',
  name: 'probe-supervisor',
});
console.log(`supervisor started: ${supervisorId}`);

// ── 3. Wait for both lines ──────────────────────────────────────────────────

let offset = 0;
let text = '';
const deadline = Date.now() + timeoutSeconds * 1000;
const found = () => ({
  result: /RESULT=(PONG)\b/.exec(text)?.[1] ?? null,
  denied: /DENIED=([a-z_]+)/.exec(text)?.[1] ?? null,
});
while (Date.now() < deadline) {
  await sleep(3000);
  try {
    const chunk = await callSocket('read_output', {
      agentId: supervisorId,
      sinceOffset: offset,
      tailBytes: 65_536,
    });
    text += chunk.text;
    offset = chunk.endOffset;
    if (chunk.status !== 'running' && chunk.status !== 'queued') break;
  } catch (error) {
    console.warn(`read_output: ${error.message}`);
  }
  const now = found();
  if (now.result && now.denied) break;
}
const seen = found();
console.log(`\nconsole tail:\n${'-'.repeat(60)}\n${text.slice(-1500)}\n${'-'.repeat(60)}`);

// ── 4. Checks from outside ──────────────────────────────────────────────────

check(
  seen.result === 'PONG',
  "the supervisor got the headless child's answer",
  `RESULT=${seen.result}`
);
check(
  seen.denied === 'model_not_allowed' || seen.denied === 'model_not_offered',
  'the socket refused the disallowed model with a reason key',
  `DENIED=${seen.denied}`
);

const { agents } = await callSocket('list_agents', {});
const self = agents.find((agent) => agent.id === supervisorId);
const children = agents.filter((agent) => agent.spawnedByAgentId === supervisorId);
check(
  self?.role === 'supervisor',
  'the supervisor is listed with role "supervisor"',
  `role ${self?.role}`
);
// A finished headless child leaves the live list; the one the refused spawn
// would have made must not be there either way.
check(
  children.every((child) => child.headless === true),
  'every agent the supervisor started is headless',
  `${children.length} listed`
);
check(
  children.every((child) => child.model !== 'no-such-model-xyz'),
  'the refused spawn started nothing'
);

// ── 5. Clean up ─────────────────────────────────────────────────────────────

if (!keep) {
  for (const id of [...children.map((child) => child.id), supervisorId]) {
    try {
      await callSocket('kill', { agentId: id });
      console.log(`killed ${id}`);
    } catch (error) {
      if (!/agent_not_running|unknown_agent/.test(error.message)) console.warn(error.message);
    }
  }
}

console.log(failures.length ? `\nprobe FAILED: ${failures.join('; ')}` : '\nprobe passed');
process.exit(failures.length ? 1 : 0);
