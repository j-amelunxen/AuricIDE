import { describe, expect, it } from 'vitest';
import { WORK_TABS } from './tabs';

describe('Work tabs', () => {
  it('is four views of one place, in loop order', () => {
    expect(WORK_TABS.map((tab) => tab.id)).toEqual(['goals', 'tickets', 'requirements', 'lines']);
    expect(WORK_TABS.map((tab) => tab.label)).toEqual([
      'Goals',
      'Tickets',
      'Requirements',
      'Lines',
    ]);
  });
});
