import { describe, expect, it } from 'vitest';
import fixtures from './agentControl.fixtures.json';
import {
  buildControlRequest,
  CLIENT_ERROR_CODES,
  CONTROL_ERROR_CODES,
  CONTROL_LIMITS,
  CONTROL_METHODS,
  ControlError,
  parseControlRequestLine,
  parseControlResponse,
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
    expect(CONTROL_LIMITS.frontendTimeoutMs).toBe(fixtures.limits.frontendTimeoutMs);
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
