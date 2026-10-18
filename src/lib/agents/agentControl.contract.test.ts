import { describe, expect, it } from 'vitest';
import fixtures from './agentControl.fixtures.json';
import {
  AGENT_ROLES,
  buildControlRequest,
  CLIENT_ERROR_CODES,
  CONTROL_ERROR_CODES,
  CONTROL_LIMITS,
  CONTROL_METHODS,
  ControlError,
  parseControlRequestLine,
  parseControlResponse,
  RUN_RESULT_SOURCES,
  RUN_SOURCES,
  type ControlMethod,
} from './agentControl.contract';

describe('agent control contract', () => {
  it('knows exactly the error codes the fixtures name', () => {
    expect([...CONTROL_ERROR_CODES].sort()).toEqual([...fixtures.errorCodes].sort());
    for (const code of fixtures.clientOnlyErrorCodes) {
      expect(CLIENT_ERROR_CODES).toContain(code);
    }
  });

  it('uses the limits the fixtures name', () => {
    expect(CONTROL_LIMITS.defaultTailBytes).toBe(fixtures.limits.defaultTailBytes);
    expect(CONTROL_LIMITS.maxTailBytes).toBe(fixtures.limits.maxTailBytes);
    expect(CONTROL_LIMITS.inputQuietSeconds).toBe(fixtures.limits.inputQuietSeconds);
    expect(CONTROL_LIMITS.frontendTimeoutMs).toBe(fixtures.limits.frontendTimeoutMs);
    expect(CONTROL_LIMITS.defaultAwaitSeconds).toBe(fixtures.limits.defaultAwaitSeconds);
    expect(CONTROL_LIMITS.maxAwaitSeconds).toBe(fixtures.limits.maxAwaitSeconds);
    expect(CONTROL_LIMITS.awaitClientGraceSeconds).toBe(fixtures.limits.awaitClientGraceSeconds);
  });

  it('knows exactly the roles, run sources and run result sources the fixtures name', () => {
    expect([...AGENT_ROLES]).toEqual(fixtures.roles);
    expect([...RUN_SOURCES]).toEqual(fixtures.runSources);
    expect([...RUN_RESULT_SOURCES]).toEqual(fixtures.runResultSources);
  });

  describe('requests', () => {
    for (const request of fixtures.requests) {
      it(`parses: ${request.name}`, () => {
        const parsed = parseControlRequestLine(request.raw);
        if ('expected' in request && request.expected) {
          expect(parsed).toEqual({ ok: true, request: request.expected });
        } else {
          expect(parsed).toMatchObject({
            ok: false,
            id: request.expectedError!.id,
            code: request.expectedError!.code,
          });
        }
      });
    }

    it('builds every valid fixture request from its raw params', () => {
      for (const request of fixtures.requests) {
        if (!('expected' in request) || !request.expected) continue;
        const raw = JSON.parse(request.raw) as {
          id: number | string;
          method: ControlMethod;
          params?: Record<string, unknown>;
        };
        expect(buildControlRequest(raw.id, raw.method, (raw.params ?? {}) as never)).toEqual(
          request.expected
        );
      }
    });

    it('refuses to build a request the socket would refuse, as invalid_params', () => {
      expect(() =>
        buildControlRequest(1, 'send_input', { agentId: 'a', text: '', enter: false })
      ).toThrow(ControlError);
      try {
        buildControlRequest(1, 'read_output', { agentId: 'a', sinceOffset: -1 });
        expect.unreachable();
      } catch (error) {
        expect((error as ControlError).code).toBe('invalid_params');
        expect((error as ControlError).message).toMatch(/sinceOffset/);
      }
    });
  });

  describe('responses', () => {
    const { error, ...byMethod } = fixtures.responses;

    for (const [method, response] of Object.entries(byMethod)) {
      it(`accepts the ${method} fixture`, () => {
        const parsed = parseControlResponse(method as ControlMethod, response, response.id);
        expect(parsed).toEqual({ ok: true, result: response.result });
      });
    }

    it('preserves finished supervisor children and their result metadata', () => {
      const live = fixtures.responses.list_agents.result.agents[0];
      const agents = [{ ...live, status: 'done', finishedAt: 42, answerPreview: 'ANSWER: done' }];
      expect(
        parseControlResponse('list_agents', { id: 1, ok: true, result: { agents } }, 1)
      ).toEqual({ ok: true, result: { agents } });
    });

    it('preserves watchdog metrics in list and pending await responses', () => {
      const metrics = { idleForMs: 900000, stalledSinceMs: 42 };
      const agents = [{ ...fixtures.responses.list_agents.result.agents[0], ...metrics }];
      expect(parseControlResponse('list_agents', { id: 1, ok: true, result: { agents } })).toEqual({
        ok: true,
        result: { agents },
      });
      const result = {
        done: false,
        agentId: 'a',
        status: 'running',
        outputBytes: 0,
        waitingForInput: false,
        ...metrics,
      };
      expect(parseControlResponse('await_result', { id: 1, ok: true, result })).toEqual({
        ok: true,
        result,
      });
    });

    it('accepts the error fixture', () => {
      expect(parseControlResponse('send_input', error, 5)).toEqual({
        ok: false,
        error: error.error,
      });
    });

    it('accepts an invalid_request answer that could not echo the id', () => {
      const raw = { id: null, ok: false, error: { code: 'invalid_request', message: 'bad' } };
      expect(parseControlResponse('kill', raw, 8)).toMatchObject({ ok: false });
    });

    for (const extra of fixtures.additionalResponses) {
      it(`accepts: ${extra.name}`, () => {
        const parsed = parseControlResponse(extra.method as ControlMethod, extra.raw, extra.raw.id);
        expect(parsed).toEqual(
          extra.raw.ok
            ? { ok: true, result: (extra.raw as { result: unknown }).result }
            : { ok: false, error: (extra.raw as { error: unknown }).error }
        );
      });
    }

    it('rejects a supervisor_denied reason the policy fixtures do not name', () => {
      const raw = {
        id: 7,
        ok: false,
        error: { code: 'supervisor_denied', message: 'no', reason: 'feeling_lucky' },
      };
      expect(() => parseControlResponse('spawn', raw, 7)).toThrow(/reason/);
    });

    for (const invalid of fixtures.invalidResponses) {
      it(`rejects: ${invalid.name}`, () => {
        expect(() => parseControlResponse(invalid.method as ControlMethod, invalid.raw)).toThrow(
          ControlError
        );
      });
    }

    it('names method, field, expectation and the value it got', () => {
      const [, , badStatus] = fixtures.invalidResponses;
      try {
        parseControlResponse('read_output', badStatus.raw);
        expect.unreachable();
      } catch (e) {
        const err = e as ControlError;
        expect(err.code).toBe('contract_violation');
        expect(err.message).toContain("'read_output'");
        expect(err.message).toContain('result.status');
        expect(err.message).toContain('"sleeping"');
      }
    });

    it('rejects an answer to a different request id', () => {
      expect(() => parseControlResponse('kill', fixtures.responses.kill, 99)).toThrow(/id/);
    });
  });

  it('covers every method', () => {
    expect([...CONTROL_METHODS].sort()).toEqual(
      Object.keys(fixtures.responses)
        .filter((key) => key !== 'error')
        .sort()
    );
  });
});
