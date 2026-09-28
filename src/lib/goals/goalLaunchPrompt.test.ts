import { describe, expect, it } from 'vitest';
import type { PmGoal } from '@/lib/tauri/goals';
import { buildGoalPlanningPrompt } from './goalLaunchPrompt';

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
