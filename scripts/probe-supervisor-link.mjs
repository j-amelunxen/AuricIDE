#!/usr/bin/env node
// Real-lane probe for the supervisor link (docs/design-supervisor-link.md):
// connects to the running AuricIDE's supervisor-link.sock exactly as a
// client of the Supervisor Control API would and prints what it answers. The Rust tests drive the
// link against a fake backend; only this checks it against the real app.
//
//   node scripts/probe-supervisor-link.mjs                 hello, agents.list, documents.projects, jobs.list
//   node scripts/probe-supervisor-link.mjs --watch 20      ...then print events for 20 s
//   node scripts/probe-supervisor-link.mjs --spawn "<task>"  start a supervisor first
//   node scripts/probe-supervisor-link.mjs --search "<query>"
//
// Dependency-free on purpose (a minimal RFC 6455 client over node:net), so it
// runs without installing anything. Exits non-zero on a refused request.
// Must not run inside an IDE agent's shell: the link refuses those.

import { createHash, randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? '');
};
const socketPath =
  process.env.AURIC_LINK_SOCKET ??
  join(homedir(), 'Library/Application Support/com.auricide.ide/supervisor-link.sock');
const watchSeconds = Number(flag('--watch') ?? 0);
const spawnTask = flag('--spawn');
const searchQuery = flag('--search');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(text) {
  const payload = Buffer.from(text, 'utf8');
  const mask = randomBytes(4);
  const length = payload.length;
  const head =
    length < 126
      ? Buffer.from([0x81, 0x80 | length])
      : length < 65536
        ? Buffer.from([0x81, 0x80 | 126, length >> 8, length & 0xff])
        : Buffer.concat([Buffer.from([0x81, 0x80 | 127]), bigLength(length)]);
  const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
  return Buffer.concat([head, mask, masked]);
}

function bigLength(length) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(length));
  return out;
}

/** Splits server frames off `buffer`; returns [messages, rest]. Server frames are unmasked. */
function parseFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset] & 0x0f;
    let length = buffer[offset + 1] & 0x7f;
    let start = offset + 2;
    if (length === 126) {
      if (buffer.length < start + 2) break;
      length = buffer.readUInt16BE(start);
      start += 2;
    } else if (length === 127) {
      if (buffer.length < start + 8) break;
      length = Number(buffer.readBigUInt64BE(start));
      start += 8;
    }
    if (buffer.length < start + length) break;
    messages.push({ opcode, data: buffer.subarray(start, start + length) });
    offset = start + length;
  }
  return [messages, buffer.subarray(offset)];
}

const socket = connect(socketPath);
const key = randomBytes(16).toString('base64');
const expectedAccept = createHash('sha1')
  .update(key + GUID)
  .digest('base64');
let upgraded = false;
let pending = Buffer.alloc(0);
const waiting = new Map();
let nextId = 1;
let failed = false;

function request(method, params = {}) {
  const id = nextId++;
  socket.write(frame(JSON.stringify({ v: 1, id, method, params })));
  return new Promise((resolve) => waiting.set(id, resolve));
}

function onMessage(message) {
  if (message.type === 'response' && waiting.has(message.id)) {
    waiting.get(message.id)(message);
    waiting.delete(message.id);
    return;
  }
  if (message.type === 'event') {
    const data =
      message.event === 'agent.output'
        ? `${message.data.agentId} +${message.data.text.length} chars: ${JSON.stringify(message.data.text.slice(-120))}`
        : JSON.stringify(message.data).slice(0, 240);
    console.log(`event #${message.seq} ${message.event} ${data}`);
    return;
  }
  console.log('server:', JSON.stringify(message));
  if (message.type === 'error') failed = true;
}

function report(label, response) {
  if (!response.ok) failed = true;
  console.log(`\n== ${label}: ${response.ok ? 'ok' : `REFUSED ${response.error.code}`}`);
  console.log(
    JSON.stringify(response.ok ? response.result : response.error, null, 2).slice(0, 4000)
  );
}

async function run() {
  report('session.hello', await request('session.hello', { client: 'probe' }));
  if (spawnTask !== null) {
    report('supervisors.spawn', await request('supervisors.spawn', { task: spawnTask }));
  }
  const listed = await request('agents.list');
  report(
    'agents.list',
    listed.ok
      ? {
          ...listed,
          result: listed.result.agents.map((a) => `${a.id} ${a.role} ${a.status} ${a.name}`),
        }
      : listed
  );
  report('documents.projects', await request('documents.projects'));
  report('jobs.list', await request('jobs.list', { limit: 10 }));
  if (searchQuery !== null) {
    report('documents.search', await request('documents.search', { query: searchQuery }));
  }
  if (watchSeconds > 0) {
    report('events.subscribe', await request('events.subscribe'));
    console.log(`\nwatching for ${watchSeconds} s…`);
    await new Promise((resolve) => setTimeout(resolve, watchSeconds * 1000));
  }
  socket.end();
  process.exit(failed ? 1 : 0);
}

socket.on('connect', () => {
  socket.write(
    [
      'GET /v1 HTTP/1.1',
      'Host: localhost',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n')
  );
});

socket.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  if (!upgraded) {
    const end = pending.indexOf('\r\n\r\n');
    if (end === -1) return;
    const head = pending.subarray(0, end).toString('utf8');
    if (!head.startsWith('HTTP/1.1 101') || !head.includes(expectedAccept)) {
      console.error(`handshake refused:\n${head}`);
      process.exit(1);
    }
    upgraded = true;
    pending = pending.subarray(end + 4);
    void run();
  }
  const [messages, rest] = parseFrames(pending);
  pending = rest;
  for (const { opcode, data } of messages) {
    if (opcode === 0x1) onMessage(JSON.parse(data.toString('utf8')));
    if (opcode === 0x8) {
      console.log(`closed by the server (${data.length >= 2 ? data.readUInt16BE(0) : '-'})`);
      process.exit(failed ? 1 : 0);
    }
  }
});

socket.on('error', (error) => {
  console.error(`cannot reach ${socketPath}: ${error.message}`);
  console.error('Is AuricIDE running (dev or installed)?');
  process.exit(1);
});
