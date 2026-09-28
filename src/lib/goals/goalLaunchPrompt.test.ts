import { describe, expect, it } from 'vitest';
import type { PmGoal } from '@/lib/tauri/goals';
import { buildGoalLaunchPrompt, buildGoalPlanningPrompt } from './goalLaunchPrompt';

function goal(overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id: 'g1',
    parentId: null,
    name: 'Publish the guide',
    description: '',
    successCriteria: '',
    status: 'active',
    priority: 'normal',
    goalPrompt: '',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

describe('buildGoalPlanningPrompt', () => {
  it('asks for a line of stations and nothing more', () => {
    const prompt = buildGoalPlanningPrompt(goal());
    expect(prompt).toContain('get_goal (id: "g1")');
    expect(prompt).toContain('create_stations (goalId: "g1")');
    expect(prompt).not.toContain('create_ticket');
    expect(prompt).not.toContain('mark_station_done');
    expect(prompt).toContain('do not carry it out');
  });

  it('asks for tickets when the goal is set to ticket mode', () => {
    const prompt = buildGoalPlanningPrompt(goal({ workMode: 'tickets' }));
    expect(prompt).toContain('create_ticket (goalId: "g1")');
    expect(prompt).not.toContain('create_stations');
  });

  it('carries the goal prompt whole', () => {
    const prompt = buildGoalPlanningPrompt(goal({ goalPrompt: 'Write in German.' }));
    expect(prompt).toContain('## Goal instructions\nWrite in German.');
  });
});

describe('buildGoalLaunchPrompt', () => {
  it('starts a launch someone watches with the /goal command', () => {
    const prompt = buildGoalLaunchPrompt(goal(), [], 'stations');
    expect(prompt.startsWith('/goal\n\n')).toBe(true);
    expect(prompt).toContain('Human stations belong to a person');
    expect(prompt).not.toContain('request_human_check');
  });

  // /goal's stop hook refuses to let the agent end while the goal is unmet,
  // and a human station keeps it unmet: an unattended agent would never exit.
  it('leaves /goal out when nobody is watching', () => {
    const prompt = buildGoalLaunchPrompt(goal(), [], 'stations', { unattended: true });
    expect(prompt).not.toContain('/goal');
    expect(prompt.startsWith('# Goal: Publish the guide')).toBe(true);
  });

  it('hands human stations over and keeps working when nobody is watching', () => {
    const prompt = buildGoalLaunchPrompt(goal(), [], 'stations', { unattended: true });
    expect(prompt).toContain('request_human_check');
    expect(prompt).toContain('continue with the next station');
    expect(prompt).toContain('only human stations are left');
    expect(prompt).not.toContain('say what to check');
  });

  it('lets the hand-over rule outrank a goal prompt that says to wait', () => {
    const prompt = buildGoalLaunchPrompt(
      goal({ goalPrompt: 'Once the test is confirmed, run the review.' }),
      [],
      'stations',
      { unattended: true }
    );
    const agreement = prompt.indexOf('## Working agreement');
    expect(agreement).toBeGreaterThan(prompt.indexOf('## Goal instructions'));
    expect(prompt.slice(agreement)).toContain('overrides');
  });
});
