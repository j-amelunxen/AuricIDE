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

    it('parses a run-skill action with only the required fields', () => {
      const action = {
        id: 'skill',
        label: 'Changelog starten',
        kind: 'run-skill',
        skillId: 's1',
        skillLabel: 'Changelog',
        prompt: '/changelog',
        repoPath: '/repo',
      };
      expect(parse([action])).toEqual([action]);
    });

    it('keeps the optional run-skill preset fields', () => {
      const action = {
        id: 'skill',
        label: 'Changelog starten',
        kind: 'run-skill',
        skillId: 's1',
        skillLabel: 'Changelog',
        prompt: '/changelog',
        repoPath: '/repo',
        providerId: 'claude',
        model: 'opus',
        permissionMode: 'acceptEdits',
        invocation: '/changelog',
      };
      expect(parse([action])).toEqual([action]);
    });

    it('keeps Crush yolo as a permissionMode on run-skill', () => {
      const action = {
        id: 'skill',
        label: 'Changelog starten',
        kind: 'run-skill',
        skillId: 's1',
        skillLabel: 'Changelog',
        prompt: '/changelog',
        repoPath: '/repo',
        permissionMode: 'yolo',
      };
      expect(parse([action])).toEqual([action]);
    });

    it('parses a run-conductor action with only the required fields', () => {
      const action = {
        id: 'conductor',
        label: 'Conductor starten',
        kind: 'run-conductor',
        repoPath: '/repo',
        ticketBudget: 5,
      };
      expect(parse([action])).toEqual([action]);
    });

    it('keeps the optional run-conductor fields', () => {
      const action = {
        id: 'conductor',
        label: 'Conductor starten',
        kind: 'run-conductor',
        repoPath: '/repo',
        ticketBudget: 5,
        maxConcurrent: 2,
        goalId: 'g1',
        goalName: 'Ship v2',
        requireReview: true,
        launch: 'auto',
      };
      expect(parse([action])).toEqual([action]);
    });

    it.each(['direct', 'dialog'] as const)(
      'parses a run-conductor action with launch %s',
      (launch) => {
        const action = {
          id: 'conductor',
          label: 'Conductor starten',
          kind: 'run-conductor',
          repoPath: '/repo',
          ticketBudget: 5,
          launch,
        };
        expect(parse([action])).toEqual([action]);
      }
    );

    it.each([1, 8])('parses a run-combo action with %s step(s)', (count) => {
      const action = {
        id: 'combo',
        label: 'Blog-Write starten',
        kind: 'run-combo',
        comboId: 'c1',
        comboLabel: 'Blog-Write',
        repoPath: '/repo',
        steps: Array.from({ length: count }, (_, i) => ({
          id: `s${i + 1}`,
          label: `Step ${i + 1}`,
          prompt: `/step-${i + 1}`,
        })),
      };
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

    it.each([
      ['an empty prompt', { prompt: '   ', repoPath: '/repo' }],
      ['a missing repoPath', { prompt: '/changelog' }],
      ['an empty repoPath', { prompt: '/changelog', repoPath: '   ' }],
    ])('drops a run-skill action with %s', (_label, extra) => {
      expect(
        parse([
          {
            id: 'skill',
            label: 'Changelog starten',
            kind: 'run-skill',
            skillId: 's1',
            skillLabel: 'Changelog',
            ...extra,
          },
        ])
      ).toEqual([]);
    });

    it.each([
      ['a zero ticketBudget', { ticketBudget: 0 }],
      ['a negative ticketBudget', { ticketBudget: -1 }],
      ['a non-integer ticketBudget', { ticketBudget: 2.5 }],
      ['a missing repoPath', { repoPath: undefined, ticketBudget: 5 }],
      ['an empty repoPath', { repoPath: '   ', ticketBudget: 5 }],
      ['a zero maxConcurrent', { ticketBudget: 5, maxConcurrent: 0 }],
      ['an unknown launch value', { ticketBudget: 5, launch: 'immediately' }],
    ])('drops a run-conductor action with %s', (_label, extra) => {
      expect(
        parse([
          {
            id: 'conductor',
            label: 'Conductor starten',
            kind: 'run-conductor',
            repoPath: '/repo',
            ...extra,
          },
        ])
      ).toEqual([]);
    });

    it.each([
      ['empty steps', []],
      ['a step with an empty prompt', [{ id: 's1', label: 'Draft', prompt: '   ' }]],
      [
        'nine steps',
        Array.from({ length: 9 }, (_, i) => ({
          id: `s${i}`,
          label: `Step ${i}`,
          prompt: `/step-${i}`,
        })),
      ],
    ])('drops a run-combo action with %s', (_label, steps) => {
      expect(
        parse([
          {
            id: 'combo',
            label: 'Blog-Write starten',
            kind: 'run-combo',
            comboId: 'c1',
            comboLabel: 'Blog-Write',
            repoPath: '/repo',
            steps,
          },
        ])
      ).toEqual([]);
    });

    it.each([
      ['a missing repoPath', { steps: [{ id: 's1', label: 'Draft', prompt: '/draft' }] }],
      [
        'an empty repoPath',
        { repoPath: '   ', steps: [{ id: 's1', label: 'Draft', prompt: '/draft' }] },
      ],
    ])('drops a run-combo action with %s', (_label, extra) => {
      expect(
        parse([
          {
            id: 'combo',
            label: 'Blog-Write starten',
            kind: 'run-combo',
            comboId: 'c1',
            comboLabel: 'Blog-Write',
            ...extra,
          },
        ])
      ).toEqual([]);
    });

    it('drops a run-combo whose step has an unknown permissionMode', () => {
      expect(
        parse([
          {
            id: 'combo',
            label: 'Blog-Write starten',
            kind: 'run-combo',
            comboId: 'c1',
            comboLabel: 'Blog-Write',
            repoPath: '/repo',
            steps: [{ id: 's1', label: 'Draft', prompt: '/draft', permissionMode: 'sudo' }],
          },
        ])
      ).toEqual([]);
    });

    it('drops a run-skill action with an unknown permissionMode', () => {
      expect(
        parse([
          {
            id: 'skill',
            label: 'Changelog starten',
            kind: 'run-skill',
            skillId: 's1',
            skillLabel: 'Changelog',
            prompt: '/changelog',
            repoPath: '/repo',
            permissionMode: 'sudo',
          },
        ])
      ).toEqual([]);
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

    it('keeps the valid siblings of a rejected run-skill or run-combo', () => {
      const skill = {
        id: 'skill',
        label: 'Changelog starten',
        kind: 'run-skill',
        skillId: 's1',
        skillLabel: 'Changelog',
        prompt: '/changelog',
        repoPath: '/repo',
      };
      const badCombo = {
        id: 'combo',
        label: 'Blog-Write starten',
        kind: 'run-combo',
        comboId: 'c1',
        comboLabel: 'Blog-Write',
        repoPath: '/repo',
        steps: [],
      };
      expect(parse([badCombo, skill])).toEqual([skill]);
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
