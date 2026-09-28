import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  buildControlRequest,
  ControlError,
  parseControlResponse,
  type ControlMethod,
  type ControlParamsInput,
  type ControlResult,
} from '../lib/agents/agentControl.contract';

/**
 * Talks to the running IDE over its control socket (`docs/design-agent-control.md`).
 * One connection per call: the calls are rare and human-paced, and a fresh
 * connection keeps a stuck answer from blocking the next question.
 */

/** Spawn and kill wait on the frontend (up to 30 s in Rust), so they get more room. */
const FRONTEND_METHOD_TIMEOUT_MS = 35_000;
const DEFAULT_TIMEOUT_MS = 5_000;

export interface ControlCallOptions {
  socketPath?: string;
  timeoutMs?: number;
}

export function controlSocketPath(
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  return (
    env.AURIC_CONTROL_SOCKET ||
    join(homedir(), 'Library', 'Application Support', 'com.auricide.ide', 'control.sock')
  );
}

function timeoutFor(method: ControlMethod): number {
  return method === 'spawn' || method === 'kill' ? FRONTEND_METHOD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

let nextRequestId = 1;

function connectionError(error: NodeJS.ErrnoException, socketPath: string): ControlError {
  if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
    return new ControlError(
      'app_not_running',
      `AuricIDE is not running (no control socket at ${socketPath})`
    );
  }
  return new ControlError('internal', `control socket ${socketPath}: ${error.message}`);
}

/**
 * Sends one request and returns its validated result. Every failure is a
 * `ControlError`: the socket's own code for an error answer, `app_not_running`,
 * `timeout` or `contract_violation` for what only the client can notice.
 */
export function callControl<M extends ControlMethod>(
  method: M,
  params: ControlParamsInput<M>,
  options: ControlCallOptions = {}
): Promise<ControlResult<M>> {
  const socketPath = options.socketPath ?? controlSocketPath();
  const timeoutMs = options.timeoutMs ?? timeoutFor(method);

  return new Promise((resolve, reject) => {
    let request;
    try {
      request = buildControlRequest(nextRequestId++, method, params);
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let buffer = '';
    const socket = createConnection(socketPath);

    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      outcome();
    };
    const fail = (error: ControlError) => finish(() => reject(error));

    const timer = setTimeout(
      () =>
        fail(
          new ControlError('timeout', `AuricIDE did not answer ${method} within ${timeoutMs} ms`)
        ),
      timeoutMs
    );

    // A multi-byte character can straddle two chunks; decoding per chunk would
    // turn both halves into U+FFFD.
    socket.setEncoding('utf8');
    const answer = (line: string) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        fail(
          new ControlError(
            'contract_violation',
            `AuricIDE control contract violation in '${method}' response: not JSON (got ${JSON.stringify(line.slice(0, 120))})`
          )
        );
        return;
      }
      try {
        // An error answer may carry `id: null` — a refused caller hears
        // `forbidden_agent_caller` right after connecting, before it asked.
        const response = parseControlResponse(method, value, request.id);
        if (response.ok) finish(() => resolve(response.result));
        else fail(new ControlError(response.error.code, response.error.message));
      } catch (error) {
        fail(error as ControlError);
      }
    };

    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('error', (error: NodeJS.ErrnoException) => {
      // The app may answer and hang up before our request is written; the
      // write then fails, but the answer is still on its way to 'data'/'close'.
      if (error.code === 'EPIPE' || error.code === 'ECONNRESET') return;
      fail(connectionError(error, socketPath));
    });
    socket.on('close', () => {
      if (buffer.trim()) answer(buffer);
      fail(
        new ControlError(
          'internal',
          `AuricIDE closed the control connection before answering ${method}`
        )
      );
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline >= 0) answer(buffer.slice(0, newline));
    });
  });
}
