import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fixtures from '../lib/agents/agentControl.fixtures.json';
import {
  ControlError,
  parseControlRequestLine,
  type ControlMethod,
  type ControlRequest,
} from '../lib/agents/agentControl.contract';
import { callControl, controlSocketPath } from './controlClient';

type Answer = (request: ControlRequest) => unknown;

/** `net.createServer` that remembers its connections so teardown can drop them. */
function createServer(onConnection: (socket: Socket) => void): Server {
  return createNetServer((socket) => {
    openSockets.add(socket);
    onConnection(socket);
  });
}

/** A stand-in for the Rust socket: NDJSON in, whatever `answer` returns out. */
function startMockSocket(
  path: string,
  answer: Answer,
  received: ControlRequest[]
): Promise<Server> {
  const server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const parsed = parseControlRequestLine(line);
        if (!parsed.ok) throw new Error(`client sent an invalid request: ${parsed.message}`);
        received.push(parsed.request);
        const reply = answer(parsed.request);
        if (reply !== undefined) socket.write(`${JSON.stringify(reply)}\n`);
        newline = buffer.indexOf('\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(path, () => resolve(server)));
}

const byMethod = fixtures.responses as unknown as Record<string, { id: unknown }>;

/** The fixture answer for the method, with the id of the request it answers. */
const fixtureAnswer: Answer = (request) => ({ ...byMethod[request.method], id: request.id });

const openSockets = new Set<Socket>();

describe('callControl', () => {
  let dir: string;
  let socketPath: string;
  let server: Server | null;
  let received: ControlRequest[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auric-ctl-'));
    socketPath = join(dir, 'control.sock');
    server = null;
    received = [];
  });

  afterEach(async () => {
    if (server) {
      // A half-closed connection would keep close() waiting forever.
      for (const socket of openSockets) socket.destroy();
      await new Promise((resolve) => server!.close(resolve));
    }
    openSockets.clear();
    rmSync(dir, { recursive: true, force: true });
  });

  const cases: [ControlMethod, Record<string, unknown>][] = [
    ['list_agents', {}],
    ['read_output', { agentId: 'agent-1', sinceOffset: 5098 }],
    ['send_input', { agentId: 'agent-2', text: 'hallo' }],
    ['kill', { agentId: 'agent-3' }],
    ['spawn', { projectPath: '/tmp/example-project', prompt: 'run the tests' }],
    ['list_projects', {}],
  ];

  for (const [method, params] of cases) {
    it(`${method}: sends the contract request and returns the validated result`, async () => {
      server = await startMockSocket(socketPath, fixtureAnswer, received);
      const result = await callControl(method, params as never, { socketPath });
      expect(result).toEqual((byMethod[method] as unknown as { result: unknown }).result);
      expect(received).toHaveLength(1);
      expect(received[0].method).toBe(method);
    });
  }

  it('fills the defaults in before sending', async () => {
    server = await startMockSocket(socketPath, fixtureAnswer, received);
    await callControl('send_input', { agentId: 'agent-2', text: 'hallo' }, { socketPath });
    expect(received[0].params).toEqual({ agentId: 'agent-2', text: 'hallo', enter: true });
  });

  it('turns an error answer into a ControlError with the socket code', async () => {
    server = await startMockSocket(
      socketPath,
      (request) => ({ ...fixtures.responses.error, id: request.id }),
      received
    );
    const error = await callControl('send_input', { agentId: 'agent-2', text: 'x' }, { socketPath })
      .then(() => null)
      .catch((e: unknown) => e as ControlError);
    expect(error).toBeInstanceOf(ControlError);
    expect(error?.code).toBe('headless_no_stdin');
    expect(error?.message).toBe('agent-2 runs headless and does not read input');
  });

  it('reports app_not_running with the socket path when there is no socket', async () => {
    await expect(callControl('list_agents', {}, { socketPath })).rejects.toMatchObject({
      code: 'app_not_running',
      message: `AuricIDE is not running (no control socket at ${socketPath})`,
    });
  });

  it('reports a contract violation precisely', async () => {
    const [, , badStatus] = fixtures.invalidResponses;
    server = await startMockSocket(
      socketPath,
      (request) => ({ ...badStatus.raw, id: request.id }),
      received
    );
    const error = await callControl('read_output', { agentId: 'agent-1' }, { socketPath }).catch(
      (e: unknown) => e as ControlError
    );
    expect(error).toMatchObject({ code: 'contract_violation' });
    expect((error as ControlError).message).toMatch(/'read_output'.*result\.status.*"sleeping"/);
  });

  it('reports a line that is not JSON as a contract violation', async () => {
    server = createServer((socket) => socket.on('data', () => socket.write('nope\n')));
    await new Promise<void>((resolve) => server!.listen(socketPath, resolve));
    await expect(callControl('list_agents', {}, { socketPath })).rejects.toMatchObject({
      code: 'contract_violation',
    });
  });

  it('decodes a character split across two chunks', async () => {
    const text = 'Grüße ✓\n';
    server = createServer((socket) =>
      socket.on('data', (line) => {
        const { id } = JSON.parse(line.toString('utf8')) as { id: number };
        const reply = Buffer.from(
          `${JSON.stringify({ ...fixtures.responses.read_output, id, result: { ...fixtures.responses.read_output.result, text } })}\n`
        );
        // Cut inside the three-byte check mark.
        const cut = reply.indexOf(Buffer.from('✓')) + 1;
        socket.write(reply.subarray(0, cut));
        setTimeout(() => socket.write(reply.subarray(cut)), 10);
      })
    );
    await new Promise<void>((resolve) => server!.listen(socketPath, resolve));
    const result = await callControl('read_output', { agentId: 'agent-1' }, { socketPath });
    expect(result.text).toBe(text);
  });

  it('reports a refused caller as forbidden_agent_caller, not as an id mismatch', async () => {
    server = createServer((socket) => {
      const refusal = {
        id: null,
        ok: false,
        error: { code: 'forbidden_agent_caller', message: 'caller descends from an IDE agent' },
      };
      socket.end(`${JSON.stringify(refusal)}\n`);
    });
    await new Promise<void>((resolve) => server!.listen(socketPath, resolve));
    await expect(callControl('list_agents', {}, { socketPath })).rejects.toMatchObject({
      code: 'forbidden_agent_caller',
      message: 'caller descends from an IDE agent',
    });
  });

  it('gives up after the timeout when the app does not answer', async () => {
    server = await startMockSocket(socketPath, () => undefined, received);
    await expect(
      callControl('list_agents', {}, { socketPath, timeoutMs: 50 })
    ).rejects.toMatchObject({ code: 'timeout', message: expect.stringMatching(/list_agents/) });
  });

  it('refuses invalid params before connecting', async () => {
    await expect(
      callControl('send_input', { agentId: 'a', text: '', enter: false }, { socketPath })
    ).rejects.toMatchObject({ code: 'invalid_params' });
  });
});

describe('controlSocketPath', () => {
  it('prefers AURIC_CONTROL_SOCKET', () => {
    expect(controlSocketPath({ AURIC_CONTROL_SOCKET: '/tmp/x.sock' })).toBe('/tmp/x.sock');
  });

  it("defaults to the app's data dir", () => {
    expect(controlSocketPath({})).toMatch(
      /Library\/Application Support\/com\.auricide\.ide\/control\.sock$/
    );
  });
});
