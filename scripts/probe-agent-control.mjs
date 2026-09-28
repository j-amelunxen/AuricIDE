#!/usr/bin/env node
// Real-lane probe for agent control (docs/design-agent-control.md): drives the
// bundled MCP runtime in `--control` mode over stdio, exactly as an external
// Claude Code session would, against the AuricIDE that is running right now.
// The Vitest suite checks the client against a mock socket built from the
// fixtures; only this checks it against the real app.
//
//   node scripts/probe-agent-control.mjs [--agent <id>] [--send "<text>"] [--runtime <server.mjs>]
//   node scripts/probe-agent-control.mjs --spawn <projectPath> --prompt "<text>"
//   node scripts/probe-agent-control.mjs --kill <id>
//
// Lists the agents, then prints the tail of one agent's output (the one named
// with --agent, else the first). With --send and --agent it also types the
// text into that agent, followed by Enter. --spawn starts an agent in that
// project folder and --kill stops one; both go through the IDE's frontend and
// print what the app answered. Exits non-zero on any tool error.
// Needs `pnpm mcp:bundle` first unless --runtime points elsewhere.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? '');
};
const agentFlag = flag('--agent');
const sendText = flag('--send');
const spawnPath = flag('--spawn');
const spawnPrompt = flag('--prompt');
const killId = flag('--kill');
const runtime =
  flag('--runtime') ??
  join(resolve(import.meta.dirname, '..'), 'src-tauri', 'resources', 'auric-mcp', 'server.mjs');

if (sendText !== null && !agentFlag) {
  console.error('--send needs --agent <id>: typing into a guessed agent could approve a prompt');
  process.exit(2);
}
if (spawnPath !== null && !spawnPrompt) {
  console.error('--spawn needs --prompt "<text>"');
  process.exit(2);
}
if (!existsSync(runtime)) {
  console.error(`MCP runtime not found at ${runtime}; run pnpm mcp:bundle`);
  process.exit(2);
}

// The environment passes through unchanged: run from inside an IDE agent
// (AURIC_AGENT_CWD set), the runtime refuses control mode, and so does this.
const child = spawn(process.execPath, [runtime, '--control'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let nextId = 1;
const pending = new Map();
let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  }
});
child.on('exit', (code) => {
  for (const waiter of pending.values()) waiter({ error: { message: `runtime exited (${code})` } });
  pending.clear();
});

function rpc(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((done) => pending.set(id, done));
}

async function tool(name, toolArgs = {}) {
  const reply = await rpc('tools/call', { name, arguments: toolArgs });
  if (reply.error) throw new Error(`${name}: ${reply.error.message}`);
  const text = reply.result.content.map((part) => part.text).join('\n');
  if (reply.result.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  const init = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'probe-agent-control', version: '1' },
  });
  if (init.error) throw new Error(`initialize: ${init.error.message}`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  if (spawnPath !== null) {
    const { agentId } = await tool('spawn_agent', { projectPath: spawnPath, prompt: spawnPrompt });
    console.log(`spawn_agent: started ${agentId} in ${spawnPath}`);
  }
  if (killId) {
    const killed = await tool('kill_agent', { agentId: killId });
    console.log(`kill_agent: ${killed.agentId} killed`);
  }

  const { agents } = await tool('list_agents');
  console.log(`list_agents: ${agents.length} agent(s)`);
  for (const agent of agents) {
    console.log(
      `  ${agent.id}  ${agent.status.padEnd(7)}  ${agent.provider}/${agent.model}  ` +
        `${agent.headless ? 'headless  ' : ''}${agent.outputBytes} B  ${agent.name}`
    );
  }

  const target = agentFlag ?? agents[0]?.id;
  if (!target) return;
  const output = await tool('read_agent_output', { agentId: target, tailBytes: 2048 });
  console.log(
    `\nread_agent_output ${target}: bytes ${output.startOffset}-${output.endOffset}` +
      `${output.truncated ? ' (older output exists)' : ''}\n${'-'.repeat(60)}\n${output.text}` +
      `\n${'-'.repeat(60)}`
  );

  if (sendText !== null) {
    const sent = await tool('send_agent_input', { agentId: target, text: sendText });
    console.log(`\nsend_agent_input ${target}: ${sent.bytesWritten} byte(s) written`);
  }
}

main()
  .then(() => {
    child.kill();
  })
  .catch((error) => {
    console.error(`probe failed: ${error.message}`);
    child.kill();
    process.exitCode = 1;
  });
