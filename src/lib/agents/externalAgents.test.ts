import { describe, expect, it } from 'vitest';
import { ControlError, parseControlParams } from './agentControl.contract';
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
