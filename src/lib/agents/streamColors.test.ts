import { describe, expect, it } from 'vitest';
import { STREAM_COLORS, streamColorFor } from './streamColors';
import { AGENT_COLORS } from './colors';

describe('streamColorFor', () => {
  it('gives the same agent the same colour every time', () => {
    const first = streamColorFor('agent-7f3a');
    expect(streamColorFor('agent-7f3a')).toBe(first);
    expect(streamColorFor('agent-7f3a')).toBe(first);
  });

  it('does not depend on the order agents are asked about', () => {
    // Handing out palette slots by arrival order would make a colour change
    // the moment an earlier agent is dismissed.
    const a = streamColorFor('alpha');
    streamColorFor('beta');
    streamColorFor('gamma');
    expect(streamColorFor('alpha')).toBe(a);
  });

  it('always returns a colour from the palette', () => {
    for (const id of ['a', 'bb', 'ccc', '', 'agent-0000-1111', '🙂']) {
      expect(STREAM_COLORS).toContain(streamColorFor(id));
    }
  });

  it('spreads a realistic fleet over several hues', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `agent-${i}`);
    const used = new Set(ids.map((id) => streamColorFor(id)));
    // Not a guarantee of zero collisions — a hash cannot promise that — but a
    // palette that collapsed to one or two hues would be useless.
    expect(used.size).toBeGreaterThanOrEqual(4);
  });

  it("lets the user's own marker win over the automatic hue", () => {
    const automatic = streamColorFor('agent-7f3a');
    const marked = streamColorFor('agent-7f3a', 'red');
    expect(marked).not.toBe(automatic);
    expect(marked).toBe(AGENT_COLORS.find((c) => c.key === 'red')?.hex);
  });

  it('falls back to the automatic hue when no marker is set', () => {
    const automatic = streamColorFor('agent-7f3a');
    expect(streamColorFor('agent-7f3a', null)).toBe(automatic);
    expect(streamColorFor('agent-7f3a', undefined)).toBe(automatic);
  });

  it('keeps clear of the status palette', () => {
    // Status owns emerald/amber/red/accent. An identity hue landing on one of
    // them would make a calm agent's name read as an alarm.
    const statusHexes = ['#34d399', '#fbbf24', '#f87171', '#6ae5ff'];
    for (const hex of STREAM_COLORS) {
      expect(statusHexes).not.toContain(hex.toLowerCase());
    }
  });

  it('has no duplicate entries in the palette', () => {
    expect(new Set(STREAM_COLORS).size).toBe(STREAM_COLORS.length);
  });
});
