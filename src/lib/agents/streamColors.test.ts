import { describe, expect, it } from 'vitest';
import {
  distinctStreamColors,
  STREAM_COLORS,
  streamColorFor,
  supervisorFamilyColors,
} from './streamColors';
import { AGENT_COLORS } from './colors';
import type { AgentInfo } from '../tauri/agents';

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

describe('distinctStreamColors', () => {
  const ids = Array.from({ length: 200 }, (_, i) => `agent-${i}`);

  it('never gives two of the first eight agents the same colour', () => {
    for (let start = 0; start < ids.length - 8; start += 7) {
      const group = ids.slice(start, start + 8);
      const colors = distinctStreamColors(group, {});
      expect(new Set(group.map((id) => colors[id])).size).toBe(group.length);
    }
  });

  it('does not depend on the order the agents are listed in', () => {
    const group = ['agent-1', 'agent-2', 'agent-3', 'agent-4'];
    expect(distinctStreamColors([...group].reverse(), {})).toEqual(distinctStreamColors(group, {}));
  });

  it('keeps a marker and gives nobody else that hue', () => {
    const red = AGENT_COLORS.find((c) => c.key === 'red')?.hex;
    const colors = distinctStreamColors(['agent-1', 'agent-2'], { 'agent-1': 'red' });
    expect(colors['agent-1']).toBe(red);
    expect(colors['agent-2']).not.toBe(red);
  });

  it('still answers for more agents than the palette holds', () => {
    const colors = distinctStreamColors(ids.slice(0, 20), {});
    expect(Object.keys(colors)).toHaveLength(20);
    for (const hex of Object.values(colors)) expect(STREAM_COLORS).toContain(hex);
  });
});

describe('supervisorFamilyColors', () => {
  const agent = (id: string, extra: Partial<AgentInfo> = {}): AgentInfo => ({
    id,
    name: id,
    status: 'running',
    model: 'sonnet',
    provider: 'claude',
    startedAt: 0,
    ...extra,
  });
  const red = AGENT_COLORS.find((c) => c.key === 'red')?.hex;
  const blue = AGENT_COLORS.find((c) => c.key === 'blue')?.hex;

  it('is empty while no supervisor is listed', () => {
    expect(
      supervisorFamilyColors([agent('a'), agent('b', { spawnedByAgentId: 'gone' })], {})
    ).toEqual({});
  });

  it('gives two supervisors two hues and each child its supervisor’s, grandchildren included', () => {
    const colors = supervisorFamilyColors(
      [
        agent('sup-a', { role: 'supervisor' }),
        agent('sup-b', { role: 'supervisor' }),
        agent('a-1', { spawnedByAgentId: 'sup-a' }),
        agent('b-1', { spawnedByAgentId: 'sup-b' }),
        agent('a-1-1', { spawnedByAgentId: 'a-1' }),
      ],
      {}
    );
    expect(colors['sup-a']).not.toBe(colors['sup-b']);
    expect(colors['a-1']).toBe(colors['sup-a']);
    expect(colors['a-1-1']).toBe(colors['sup-a']);
    expect(colors['b-1']).toBe(colors['sup-b']);
    expect(STREAM_COLORS).toContain(colors['sup-a']);
  });

  it('leaves agents outside every family without an entry', () => {
    const colors = supervisorFamilyColors(
      [
        agent('sup', { role: 'supervisor' }),
        agent('plain'),
        // Its supervisor was cleared from the list: no family to belong to.
        agent('orphan', { spawnedByAgentId: 'cleared' }),
      ],
      {}
    );
    expect(Object.keys(colors)).toEqual(['sup']);
  });

  it('colours the whole family with a marker on the supervisor, a child marker only the child', () => {
    const colors = supervisorFamilyColors(
      [
        agent('sup', { role: 'supervisor' }),
        agent('child', { spawnedByAgentId: 'sup' }),
        agent('marked', { spawnedByAgentId: 'sup' }),
      ],
      { sup: 'red', marked: 'blue' }
    );
    expect(colors.sup).toBe(red);
    expect(colors.child).toBe(red);
    expect(colors.marked).toBe(blue);
  });

  it('puts a supervisor started by another supervisor into the top one’s family', () => {
    const colors = supervisorFamilyColors(
      [
        agent('top', { role: 'supervisor' }),
        agent('nested', { role: 'supervisor', spawnedByAgentId: 'top' }),
        agent('leaf', { spawnedByAgentId: 'nested' }),
      ],
      {}
    );
    expect(colors.nested).toBe(colors.top);
    expect(colors.leaf).toBe(colors.top);
  });

  it('survives a parent chain that loops', () => {
    const colors = supervisorFamilyColors(
      [
        agent('sup', { role: 'supervisor' }),
        agent('x', { spawnedByAgentId: 'y' }),
        agent('y', { spawnedByAgentId: 'x' }),
      ],
      {}
    );
    expect(Object.keys(colors)).toEqual(['sup']);
  });
});
