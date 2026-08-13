import { describe, expect, it } from 'vitest';
import { activityItems } from './constants';

describe('activityItems — the rail leads with the loop', () => {
  it('puts Mission Control first', () => {
    expect(activityItems[0].id).toBe('cockpit');
  });

  it('keeps the loop surfaces primary: cockpit, explorer, source control, work', () => {
    const primary = activityItems.filter((i) => i.section !== 'tools').map((i) => i.id);
    expect(primary).toEqual(['cockpit', 'explorer', 'source-control', 'work']);
  });

  it('demotes viewers and toolboxes to the tools section', () => {
    const tools = activityItems.filter((i) => i.section === 'tools').map((i) => i.id);
    expect(tools).toEqual([
      'notifications',
      'outline',
      'scratches',
      'graph',
      'qa',
      'blueprints',
      'extensions',
      'settings',
    ]);
  });

  it('has no dedicated goals, plan, or goal-lines slot — Work owns those views', () => {
    expect(activityItems.find((i) => i.id === 'goals')).toBeUndefined();
    expect(activityItems.find((i) => i.id === 'project-mgmt')).toBeUndefined();
    expect(activityItems.find((i) => i.id === 'requirements')).toBeUndefined();
    expect(activityItems.find((i) => i.id === 'goal-lines')).toBeUndefined();
  });

  it('has no duplicate agent-fleet slot — the fleet panel is the one home', () => {
    expect(activityItems.find((i) => i.id === 'agents')).toBeUndefined();
  });

  it('labels the work place Work', () => {
    expect(activityItems.find((i) => i.id === 'work')?.label).toBe('Work');
  });
});
