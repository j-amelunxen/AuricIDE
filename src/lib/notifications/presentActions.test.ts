import { describe, expect, it } from 'vitest';
import type {
  QuickAccessCombo,
  QuickAccessSkill,
  StarredProject,
} from '@/lib/store/starredProjectsSlice';
import { presentNotificationActions, type RepoDirStatus } from './presentActions';
import type { NotificationAction } from './types';

const REPO = '/repo/sample';

const runSkill = (
  overrides: Partial<Extract<NotificationAction, { kind: 'run-skill' }>> = {}
): Extract<NotificationAction, { kind: 'run-skill' }> => ({
  id: 'run',
  label: 'Changelog starten',
  kind: 'run-skill',
  skillId: 's1',
  skillLabel: 'Changelog',
  prompt: '/changelog',
  repoPath: REPO,
  invocation: '/changelog',
  ...overrides,
});

const runCombo = (
  overrides: Partial<Extract<NotificationAction, { kind: 'run-combo' }>> = {}
): Extract<NotificationAction, { kind: 'run-combo' }> => ({
  id: 'run',
  label: 'Blog-Write starten',
  kind: 'run-combo',
  comboId: 'c1',
  comboLabel: 'Blog-Write',
  repoPath: REPO,
  steps: [{ id: 's1', label: 'Draft', prompt: '/draft' }],
  ...overrides,
});

const spawnAgent = (
  overrides: Partial<Extract<NotificationAction, { kind: 'spawn-agent' }>> = {}
): Extract<NotificationAction, { kind: 'spawn-agent' }> => ({
  id: 'run',
  label: 'Agent starten',
  kind: 'spawn-agent',
  task: 'scan',
  ...overrides,
});

function project(overrides: Partial<StarredProject> = {}): StarredProject {
  return {
    path: REPO,
    name: 'sample',
    starredAt: 1,
    ...overrides,
  };
}

function present(
  actions: NotificationAction[],
  starred: StarredProject[] = [],
  status: Record<string, RepoDirStatus> = {}
) {
  return presentNotificationActions(actions, starred, new Map(Object.entries(status)));
}

describe('presentNotificationActions', () => {
  describe('live pin labels', () => {
    it('overlays the live pin label when the skill id still exists', () => {
      const pin: QuickAccessSkill = {
        id: 's1',
        label: 'Weekly Changelog',
        prompt: '/changelog',
      };
      const presented = present([runSkill()], [project({ skills: [pin] })]);

      expect(presented[0].action.label).toBe('Start Weekly Changelog');
    });

    it('overlays the live pin label when only the invocation matches', () => {
      const pin: QuickAccessSkill = {
        id: 'pin-later',
        label: 'Changelog',
        prompt: '/changelog',
        invocation: '/changelog',
      };
      const presented = present(
        [runSkill({ skillId: 'discovered:/changelog', label: 'Old Name starten' })],
        [project({ skills: [pin] })]
      );

      expect(presented[0].action.label).toBe('Start Changelog');
    });

    it('overlays the live combo pin label when the combo id still exists', () => {
      const pin: QuickAccessCombo = {
        id: 'c1',
        label: 'Blog Pipeline',
        steps: [{ id: 's1', label: 'Draft', prompt: '/draft' }],
      };
      const presented = present([runCombo()], [project({ combos: [pin] })]);

      expect(presented[0].action.label).toBe('Start Blog Pipeline');
    });

    it('keeps the snapshot label when no pin matches', () => {
      const skill = runSkill({ label: 'Changelog starten' });
      const combo = runCombo({ label: 'Blog-Write starten' });
      const presented = present([skill, combo], [project({ skills: [], combos: [] })]);

      expect(presented[0].action.label).toBe('Changelog starten');
      expect(presented[1].action.label).toBe('Blog-Write starten');
    });

    it('does not mutate the input action when overlaying a live label', () => {
      const action = runSkill({ label: 'Changelog starten' });
      const pin: QuickAccessSkill = {
        id: 's1',
        label: 'Weekly Changelog',
        prompt: '/changelog',
      };

      present([action], [project({ skills: [pin] })]);

      expect(action.label).toBe('Changelog starten');
    });
  });

  describe('disabledReason', () => {
    it.each([
      ['run-skill', runSkill()],
      ['run-combo', runCombo()],
      ['spawn-agent with repoPath', spawnAgent({ repoPath: REPO })],
    ] as const)('disables %s when the project folder is missing', (_label, action) => {
      const presented = present([action], [], { [REPO]: 'missing' });

      expect(presented[0].disabledReason).toBe('Project folder not found');
    });

    it('does not disable spawn-agent without a repoPath for a missing dir', () => {
      const presented = present([spawnAgent()], [], { [REPO]: 'missing' });

      expect(presented[0].disabledReason).toBeUndefined();
    });

    it('does not disable when the dir status is unknown', () => {
      const presented = present([runSkill(), runCombo(), spawnAgent({ repoPath: REPO })], [], {
        [REPO]: 'unknown',
      });

      expect(presented.every((p) => p.disabledReason === undefined)).toBe(true);
    });

    it('does not disable when the dir status is dir or the path is absent', () => {
      const withDir = present([runSkill()], [], { [REPO]: 'dir' });
      const absent = present([runSkill()], [], {});

      expect(withDir[0].disabledReason).toBeUndefined();
      expect(absent[0].disabledReason).toBeUndefined();
    });

    it('disables a combo whose snapshot has no non-empty prompt steps', () => {
      const empty = runCombo({
        steps: [
          { id: 's1', label: 'Draft', prompt: '   ' },
          { id: 's2', label: 'Polish', prompt: '' },
        ],
      });
      const presented = present([empty], [], { [REPO]: 'dir' });

      expect(presented[0].disabledReason).toBe('Combo has no valid steps');
    });

    it('overlays the live combo label and disables when the folder is missing', () => {
      const pin: QuickAccessCombo = {
        id: 'c1',
        label: 'Blog Pipeline',
        steps: [{ id: 's1', label: 'Draft', prompt: '/draft' }],
      };
      const presented = present([runCombo()], [project({ combos: [pin] })], {
        [REPO]: 'missing',
      });

      expect(presented[0].action.label).toBe('Start Blog Pipeline');
      expect(presented[0].disabledReason).toBe('Project folder not found');
    });
  });
});
