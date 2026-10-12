import { describe, expect, it } from 'vitest';
import fixtures from './agentWindow.fixtures.json';
import {
  AGENT_WINDOW_CLIENT_EVENTS,
  AGENT_WINDOW_HOST_EVENTS,
  AGENT_WINDOW_LABELS,
  AGENT_WINDOW_RUST_EVENTS,
  AgentWindowContractError,
  DEFAULT_PTY_SIZE,
  parseWindowMessage,
  type AgentWindowMessageKind,
} from './agentWindow.contract';

const withoutComment = (group: Record<string, string>) =>
  Object.fromEntries(Object.entries(group).filter(([key]) => key !== '_comment'));

describe('agent window contract', () => {
  it('names the windows and events the fixtures name', () => {
    expect(AGENT_WINDOW_LABELS).toEqual({
      main: fixtures.windows.main,
      agents: fixtures.windows.agents,
    });
    expect(AGENT_WINDOW_RUST_EVENTS).toEqual(withoutComment(fixtures.rustEvents));
    expect(AGENT_WINDOW_HOST_EVENTS).toEqual(withoutComment(fixtures.hostEvents));
    expect(AGENT_WINDOW_CLIENT_EVENTS).toEqual(withoutComment(fixtures.clientEvents));
    expect(DEFAULT_PTY_SIZE).toEqual(fixtures.defaultPtySize);
  });

  it('keeps every event name distinct', () => {
    const names = [
      ...Object.values(AGENT_WINDOW_RUST_EVENTS),
      ...Object.values(AGENT_WINDOW_HOST_EVENTS),
      ...Object.values(AGENT_WINDOW_CLIENT_EVENTS),
    ];
    expect(new Set(names).size).toBe(names.length);
  });

  describe('valid messages', () => {
    for (const [kind, cases] of Object.entries(fixtures.messages)) {
      for (const { name, raw } of cases as { name: string; raw: unknown }[]) {
        it(`${kind}: ${name}`, () => {
          expect(parseWindowMessage(kind as AgentWindowMessageKind, raw)).toEqual(raw);
        });
      }
    }
  });

  describe('invalid messages', () => {
    for (const { name, message, raw } of fixtures.invalidMessages) {
      it(`${message}: ${name}`, () => {
        expect(() => parseWindowMessage(message as AgentWindowMessageKind, raw)).toThrow(
          AgentWindowContractError
        );
      });
    }
  });

  it('names the message and the field in a violation', () => {
    expect(() =>
      parseWindowMessage('snapshot', {
        agentId: 'agent-1',
        data: '',
        rows: 24,
        cols: 80,
        endOffset: -1,
      })
    ).toThrow(/snapshot\.endOffset/);
  });

  it('lets fields it does not know about through on a roster entry', () => {
    const [entry] = fixtures.messages.roster;
    const parsed = parseWindowMessage('roster', entry.raw);
    expect(parsed.agents[0].finishedAt).toBe(1760000005000);
    expect(parsed.agents[0].awaitingInput).toBe(false);
  });

  it('counts the output offsets of the fixtures in UTF-8 bytes', () => {
    let offset = 0;
    for (const { raw } of fixtures.messages.agentOutput) {
      offset += new TextEncoder().encode(raw.line).length;
      expect(raw.endOffset).toBe(offset);
    }
  });
});
