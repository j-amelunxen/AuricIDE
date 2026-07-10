import { describe, expect, it } from 'vitest';
import { activityItems } from './constants';

describe('activityItems — the rail leads with the loop', () => {
  it('puts Mission Control first', () => {
    expect(activityItems[0].id).toBe('cockpit');
  });

  it('keeps the loop surfaces primary: cockpit, explorer, source control, plan, requirements', () => {
    const primary = activityItems.filter((i) => i.section !== 'tools').map((i) => i.id);
    expect(primary).toEqual([
      'cockpit',
      'explorer',
      'source-control',
      'project-mgmt',
      'requirements',
    ]);
  });

  it('demotes viewers and toolboxes to the tools section', () => {
    const tools = activityItems.filter((i) => i.section === 'tools').map((i) => i.id);
    expect(tools).toEqual(['outline', 'graph', 'qa', 'blueprints', 'extensions', 'settings']);
  });

  it('has no dedicated goals slot — the conductor pulse and cockpit own that path', () => {
    expect(activityItems.find((i) => i.id === 'goals')).toBeUndefined();
  });

  it('has no duplicate agent-fleet slot — the fleet panel is the one home', () => {
    expect(activityItems.find((i) => i.id === 'agents')).toBeUndefined();
  });

  it('labels project management as Plan', () => {
    expect(activityItems.find((i) => i.id === 'project-mgmt')?.label).toBe('Plan');
  });
});
