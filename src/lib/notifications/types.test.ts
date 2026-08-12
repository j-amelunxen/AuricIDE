import { describe, expect, it } from 'vitest';
import { isAnsweredNotification, parseNotificationActions, type NotificationAction } from './types';

/**
 * Actions arrive from outside the app — an MCP agent, a scheduled reminder,
 * a row someone wrote straight into the database. The parser is the trust
 * boundary: everything downstream may assume what it returns is renderable
 * and executable.
 */

const KNOWN_COMMANDS = new Set(['git.commit', 'view.goals']);
const isKnownCommand = (id: string) => KNOWN_COMMANDS.has(id);

function parse(raw: unknown): NotificationAction[] {
  return parseNotificationActions(raw, isKnownCommand);
}

const answer = { id: 'yes', label: 'Ja', kind: 'answer', value: 'yes' };

describe('parseNotificationActions', () => {
  describe('accepts the closed vocabulary', () => {
    it('parses an answer action', () => {
      expect(parse([answer])).toEqual([answer]);
    });

    it('parses a spawn-agent action with only the required task', () => {
      const action = { id: 'run', label: 'Agent starten', kind: 'spawn-agent', task: 'scan' };
      expect(parse([action])).toEqual([action]);
    });

    it('keeps the optional spawn-agent targeting fields', () => {
      const action = {
        id: 'run',
        label: 'Agent starten',
        kind: 'spawn-agent',
        task: 'scan',
        repoPath: '/repo',
        ticketId: 't1',
        goalId: 'g1',
        provider: 'claude',
        model: 'opus',
      };
      expect(parse([action])).toEqual([action]);
    });

    it.each([
      ['file', { type: 'file', path: '/a/b.md' }],
      ['file with line', { type: 'file', path: '/a/b.md', line: 12 }],
      ['ticket', { type: 'ticket', ticketId: 't1' }],
      ['goal', { type: 'goal', goalId: 'g1' }],
      ['agent', { type: 'agent', agentId: 'a1' }],
    ])('parses an open action targeting a %s', (_label, target) => {
      const action = { id: 'go', label: 'Öffnen', kind: 'open', target };
      expect(parse([action])).toEqual([action]);
    });

    it('parses a command action whose id exists in the manifest', () => {
      const action = { id: 'c', label: 'Commit', kind: 'command', commandId: 'git.commit' };
      expect(parse([action])).toEqual([action]);
    });
  });

  describe('drops what cannot be rendered or executed', () => {
    it('drops a command action whose id is not in the manifest', () => {
      const action = { id: 'c', label: 'Böse', kind: 'command', commandId: 'rm.everything' };
      expect(parse([action])).toEqual([]);
    });

    it('drops an unknown action kind', () => {
      expect(parse([{ id: 'x', label: 'Shell', kind: 'exec', cmd: 'rm -rf /' }])).toEqual([]);
    });

    it('drops an action missing its label', () => {
      expect(parse([{ id: 'yes', kind: 'answer', value: 'yes' }])).toEqual([]);
    });

    it('drops a spawn-agent action with an empty task', () => {
      expect(parse([{ id: 'r', label: 'Start', kind: 'spawn-agent', task: '   ' }])).toEqual([]);
    });

    it('drops an open action with an unknown target type', () => {
      const action = { id: 'go', label: 'Öffnen', kind: 'open', target: { type: 'url', url: 'x' } };
      expect(parse([action])).toEqual([]);
    });

    // One bad entry must not cost the user the buttons that are fine — the
    // notification is still worth acting on.
    it('keeps the valid siblings of a rejected action', () => {
      expect(parse([{ id: 'bad', kind: 'answer' }, answer])).toEqual([answer]);
    });

    // Two buttons answering to the same id would make the recorded answer
    // ambiguous, and the answer is what a waiting agent reads back.
    it('drops a later action that reuses an earlier id', () => {
      const clash = { id: 'yes', label: 'Nein', kind: 'answer', value: 'no' };
      expect(parse([answer, clash])).toEqual([answer]);
    });
  });

  describe('tolerates the shapes the wire actually produces', () => {
    it('parses a JSON string, because the column stores TEXT', () => {
      expect(parse(JSON.stringify([answer]))).toEqual([answer]);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an object', { id: 'yes' }],
      ['a non-JSON string', 'not json'],
      ['a JSON scalar', '42'],
    ])('returns an empty list for %s', (_label, raw) => {
      expect(parse(raw)).toEqual([]);
    });

    it('returns an empty list for an empty array', () => {
      expect(parse([])).toEqual([]);
    });
  });
});

describe('isAnsweredNotification', () => {
  it('is false while an ask is still open', () => {
    expect(isAnsweredNotification({ kind: 'ask', answeredAt: null })).toBe(false);
  });

  it('is true once an ask carries an answer timestamp', () => {
    expect(isAnsweredNotification({ kind: 'ask', answeredAt: '2026-08-12 10:00:00' })).toBe(true);
  });

  // An info notification has nothing to answer, so its buttons are one-shot
  // navigation — it never enters the answered state.
  it('is false for an info notification', () => {
    expect(isAnsweredNotification({ kind: 'info', answeredAt: null })).toBe(false);
  });
});
