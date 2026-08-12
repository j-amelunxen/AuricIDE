import { describe, expect, it } from 'vitest';
import {
  comboMenuLabel,
  comboPreview,
  comboStepForAgent,
  formatComboProgress,
  type SkillComboRun,
} from './combo';
import type { QuickAccessCombo } from '../store/starredProjectsSlice';

const write: QuickAccessCombo = {
  id: 'c1',
  label: 'Draft and polish',
  steps: [
    {
      id: 's1',
      label: 'Draft',
      prompt: '/draft',
      providerId: 'claude',
      model: 'opus',
    },
    {
      id: 's2',
      label: 'Rewrite',
      prompt: 'tighten the wording',
      providerId: 'grok',
    },
  ],
};

describe('combo preview', () => {
  it('marks a combo with a plus so it does not read as a single skill', () => {
    expect(comboMenuLabel(write)).toBe('Draft and polish +');
  });

  it('joins the step names with pluses for the settings preview', () => {
    expect(comboPreview(write)).toBe('Draft + Rewrite');
  });

  it('counts from one so the window reads "1 / 3", not "0 / 3"', () => {
    expect(formatComboProgress(0, 3)).toBe('1 / 3');
    expect(formatComboProgress(2, 3)).toBe('3 / 3');
  });
});

describe('comboStepForAgent', () => {
  const run = (agentId: string, index: number): SkillComboRun => ({
    id: 'r1',
    comboId: write.id,
    label: write.label,
    projectPath: '/a/website',
    steps: write.steps,
    currentIndex: index,
    currentAgentId: agentId,
  });

  it('returns the step this agent is carrying', () => {
    const found = comboStepForAgent([run('a2', 1)], 'a2');
    expect(found).toEqual({
      label: 'Draft and polish',
      stepLabel: 'Rewrite',
      stepIndex: 1,
      total: 2,
    });
  });

  it('returns null for an agent that is not in a combo', () => {
    expect(comboStepForAgent([run('a1', 0)], 'other')).toBeNull();
  });
});
