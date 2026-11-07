import { describe, expect, it } from 'vitest';
import {
  ControlError,
  TOKEN_DENIED_REASONS,
  capabilityToken,
  parseControlParams,
  parseControlResponse,
} from './agentControl.contract';
import controlFixtures from './agentControl.fixtures.json';
import tokenFixtures from './capabilityTokens.fixtures.json';
import {
  EXTERNAL_STALE_REGISTERED_AFTER_MS,
  EXTERNAL_STALE_RUNNING_AFTER_MS,
  externalCountsAsOn,
  externalOnMs,
  externalStateLabel,
  formatExternalSpan,
  isExternalStale,
  type ExternalAgent,
} from './externalAgents';
import fixtures from './externalAgents.fixtures.json';

type DisplayEntry = Pick<ExternalAgent, 'state' | 'lastSeenAt' | 'onSpans'>;

function refusalCode(method: 'external_register' | 'external_stop', params: unknown): string {
  try {
    parseControlParams(method, params);
  } catch (error) {
    return error instanceof ControlError ? error.code : 'not a ControlError';
  }
  return 'accepted';
}

describe('external agents: parameters', () => {
  /* testuuid: t_xr4gq1vd covers: el_extreg01 categories: happy,negative level: unit */
  describe('register', () => {
    for (const { name, params } of fixtures.registerParams.accept) {
      it(`accepts ${name}, unchanged`, () => {
        expect(parseControlParams('external_register', params)).toEqual(params);
      });
    }
    for (const { name, params, code } of fixtures.registerParams.reject) {
      it(`refuses ${name}`, () => {
        expect(refusalCode('external_register', params)).toBe(code);
      });
    }
  });

  /* testuuid: t_b7mz02ks covers: el_extstp01 categories: happy,negative level: unit */
  describe('stop', () => {
    for (const { name, params } of fixtures.stopParams.accept) {
      it(`accepts ${name}, unchanged`, () => {
        expect(parseControlParams('external_stop', params)).toEqual(params);
      });
    }
    for (const { name, params, code } of fixtures.stopParams.reject) {
      it(`refuses ${name}`, () => {
        expect(refusalCode('external_stop', params)).toBe(code);
      });
    }
  });

  it('does not take an ordinary word for a credential', () => {
    const base = fixtures.registerParams.accept[0].params;
    // "task-12" holds "sk-" and "boxoxo" holds "xox"; neither is a key.
    for (const name of ['Fix task-12', 'Run on boxoxo', 'bearer of news']) {
      expect(refusalCode('external_register', { ...base, name }), name).toBe('accepted');
    }
  });

  it('finds a credential shape after a separator, whatever comes before it', () => {
    const base = fixtures.registerParams.accept[0].params;
    for (const shape of fixtures.credentialShapes) {
      expect(refusalCode('external_register', { ...base, name: `${shape}abc` }), shape).toBe(
        'invalid_params'
      );
      expect(refusalCode('external_register', { ...base, name: `key=${shape}abc` }), shape).toBe(
        'invalid_params'
      );
    }
  });
});

describe('external agents: display', () => {
  it('uses the limits the fixtures name', () => {
    expect(EXTERNAL_STALE_RUNNING_AFTER_MS).toBe(fixtures.stale.runningAfterMs);
    expect(EXTERNAL_STALE_REGISTERED_AFTER_MS).toBe(fixtures.stale.registeredAfterMs);
  });

  for (const { name, entry, now, expected } of fixtures.display) {
    it(name, () => {
      const external = entry as DisplayEntry;
      expect(isExternalStale(external, now)).toBe(expected.stale);
      expect(externalOnMs(external, now)).toBe(expected.onMs);
      expect(externalCountsAsOn(external, now)).toBe(expected.countsAsOn);
    });
  }

  it('reads a final entry by its own end, never by now, if a span was left open', () => {
    const entry = {
      state: 'stopped',
      lastSeenAt: 1000,
      finishedAt: 5000,
      onSpans: [{ from: 1000, to: null }],
    } as const;
    expect(externalOnMs({ ...entry, onSpans: [...entry.onSpans] }, 1_000_000)).toBe(4000);
  });

  it('labels each state, with stale above the stored one', () => {
    const at = (state: ExternalAgent['state'], lastSeenAt = 0) => ({ state, lastSeenAt });
    expect(externalStateLabel(at('running'), 1)).toBe('Running');
    expect(externalStateLabel(at('registered'), 1)).toBe('Off');
    expect(externalStateLabel(at('stopped'), 1)).toBe('Stopped');
    expect(externalStateLabel(at('failed'), 1)).toBe('Failed');
    expect(externalStateLabel(at('running'), EXTERNAL_STALE_RUNNING_AFTER_MS + 1)).toBe('Stale?');
  });

  it('writes a span without a trailing zero', () => {
    expect(formatExternalSpan(9 * 3_600_000)).toBe('9h');
    expect(formatExternalSpan(2.5 * 3_600_000)).toBe('2h 30m');
    expect(formatExternalSpan(48 * 3_600_000)).toBe('2d');
  });
});

describe('external agents: capability tokens', () => {
  it('accepts exactly the token shapes the fixtures accept', () => {
    for (const token of tokenFixtures.tokenShape.accept) {
      expect(capabilityToken.safeParse(token).success, token).toBe(true);
    }
    for (const token of tokenFixtures.tokenShape.reject) {
      expect(capabilityToken.safeParse(token).success, token).toBe(false);
    }
  });

  it('builds a token of the length the fixtures describe', () => {
    // 32 random bytes in base64url without padding are 43 characters.
    const body = 'A'.repeat(Math.ceil((tokenFixtures.token.randomBytes * 4) / 3));
    expect(capabilityToken.safeParse(`${tokenFixtures.token.prefix}${body}`).success).toBe(true);
  });

  it('knows every token_denied reason and refuses one without a known reason', () => {
    expect(controlFixtures.errorCodes).toContain(tokenFixtures.error.code);
    expect([...TOKEN_DENIED_REASONS].sort()).toEqual(
      Object.keys(tokenFixtures.error.reasons).sort()
    );
    for (const reason of TOKEN_DENIED_REASONS) {
      const answer = parseControlResponse('external_stop', {
        id: 1,
        ok: false,
        error: { code: 'token_denied', message: 'no', reason },
      });
      expect(answer).toEqual({
        ok: false,
        error: { code: 'token_denied', message: 'no', reason },
      });
    }
    for (const error of [
      { code: 'token_denied', message: 'no' },
      { code: 'token_denied', message: 'no', reason: 'token_stolen' },
    ]) {
      expect(() => parseControlResponse('external_stop', { id: 1, ok: false, error })).toThrow(
        /token_denied must carry a known reason key/
      );
    }
  });
});

describe('external agents: the view', () => {
  const base = controlFixtures.responses.external_stop.result;
  const parse = (agent: object) =>
    parseControlResponse('external_stop', {
      id: 1,
      ok: true,
      result: { ...base, agent: { ...base.agent, ...agent } },
    });

  it('takes every end reason and closedBy value the fixtures name, and nothing else', () => {
    for (const endReason of fixtures.endReasons) {
      expect(parse({ endReason }).ok, endReason).toBe(true);
    }
    expect(() => parse({ endReason: 'it broke' })).toThrow(/agent\.endReason/);
    for (const closedBy of Object.keys(fixtures.closedBy).filter((key) => key !== 'absent')) {
      expect(parse({ closedBy }).ok, closedBy).toBe(true);
    }
    expect(parse({ closedBy: null }).ok).toBe(true);
    expect(() => parse({ closedBy: 'someone' })).toThrow(/agent\.closedBy/);
  });

  it('takes a correction with the earlier values', () => {
    const correction = {
      at: 1_793_750_500_000,
      forcedBy: 'human',
      agentId: null,
      wasBooked: true,
      previous: {
        state: 'stopped',
        finishedAt: 1_793_750_400_000,
        closedBy: 'token',
        endReason: 'completed',
        report: null,
        model: 'opus',
      },
    };
    expect(parse({ corrections: [correction] }).ok).toBe(true);
    for (const forcedBy of fixtures.corrections.forcedBy) {
      expect(parse({ corrections: [{ ...correction, forcedBy }] }).ok, forcedBy).toBe(true);
    }
    expect(() => parse({ corrections: [{ ...correction, forcedBy: 'token' }] })).toThrow(
      /forcedBy/
    );
    const { endReason: _unset, ...withoutReason } = correction.previous;
    expect(parse({ corrections: [{ ...correction, previous: withoutReason }] }).ok).toBe(true);
  });
});
