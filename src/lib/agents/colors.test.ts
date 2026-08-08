import { describe, expect, it } from 'vitest';
import { AGENT_COLORS, agentColorHex, agentColorLabel } from './colors';

describe('agent marker colours', () => {
  it('offers a handful of obviously distinct choices', () => {
    // Few enough to tell apart while scrolling a list; more shades would
    // defeat the point of the marker.
    expect(AGENT_COLORS.length).toBeGreaterThanOrEqual(4);
    expect(AGENT_COLORS.length).toBeLessThanOrEqual(8);
  });

  it('gives every colour a distinct key, label and hex', () => {
    expect(new Set(AGENT_COLORS.map((c) => c.key)).size).toBe(AGENT_COLORS.length);
    expect(new Set(AGENT_COLORS.map((c) => c.label)).size).toBe(AGENT_COLORS.length);
    expect(new Set(AGENT_COLORS.map((c) => c.hex)).size).toBe(AGENT_COLORS.length);
  });

  it('pins concrete hex values rather than theme tokens', () => {
    // "The red one" has to stay the red one whatever accent colour is set.
    AGENT_COLORS.forEach((c) => expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i));
  });

  it('resolves a colour to its hex', () => {
    expect(agentColorHex('red')).toBe(AGENT_COLORS[0].hex);
    expect(agentColorLabel('red')).toBe('Red');
  });

  it('reports no colour for an unmarked agent', () => {
    expect(agentColorHex(undefined)).toBeNull();
    expect(agentColorHex(null)).toBeNull();
    expect(agentColorLabel(null)).toBeNull();
  });
});
