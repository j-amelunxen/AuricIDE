import { describe, expect, it } from 'vitest';
import {
  initialQuickAccessSelection,
  sortQuickAccessProjects,
  spawnCwdTargets,
  ticketAndGoalForCwd,
} from './spawnTargets';

const website = { path: '/a/website', name: 'website' };
const shop = { path: '/b/shop', name: 'shop' };
const api = { path: '/c/api', name: 'api' };

describe('sortQuickAccessProjects', () => {
  it('sorts by name the way the Quick Access tiles do', () => {
    expect(sortQuickAccessProjects([website, shop, api]).map((p) => p.name)).toEqual([
      'api',
      'shop',
      'website',
    ]);
  });
});

describe('initialQuickAccessSelection', () => {
  it('pre-selects the opening path when it is a Quick Access pin', () => {
    expect(initialQuickAccessSelection([website, shop], '/a/website')).toEqual(['/a/website']);
  });

  it('selects nothing when the opening path is not pinned', () => {
    expect(initialQuickAccessSelection([website], '/elsewhere')).toEqual([]);
  });

  it('selects nothing when there is no opening path', () => {
    expect(initialQuickAccessSelection([website], '')).toEqual([]);
  });
});

describe('spawnCwdTargets', () => {
  it('uses the typed path when nothing is selected', () => {
    expect(spawnCwdTargets([], [website, shop], '/typed')).toEqual(['/typed']);
  });

  it('keeps a blank typed path as the sole target so a no-cwd launch still works', () => {
    expect(spawnCwdTargets([], [website], '  ')).toEqual(['']);
  });

  it('ignores the typed path once any Quick Access pin is selected', () => {
    expect(spawnCwdTargets(['/b/shop'], [website, shop], '/typed')).toEqual(['/b/shop']);
  });

  it('returns selected pins in Quick Access order, not click order', () => {
    expect(spawnCwdTargets(['/a/website', '/c/api', '/b/shop'], [website, shop, api], '')).toEqual([
      '/c/api',
      '/b/shop',
      '/a/website',
    ]);
  });

  it('drops selected paths that are no longer pinned', () => {
    expect(spawnCwdTargets(['/gone', '/b/shop'], [shop], '')).toEqual(['/b/shop']);
  });
});

describe('ticketAndGoalForCwd', () => {
  it('keeps the binding on a single launch even if the directory changed', () => {
    expect(ticketAndGoalForCwd('/elsewhere', '/a/website', 't1', 'g1', false)).toEqual({
      spawnedByTicketId: 't1',
      spawnedByGoalId: 'g1',
    });
  });

  it('keeps the binding only for the home working directory in a fan-out', () => {
    expect(ticketAndGoalForCwd('/a/website', '/a/website', 't1', 'g1', true)).toEqual({
      spawnedByTicketId: 't1',
      spawnedByGoalId: 'g1',
    });
  });

  it('drops the binding for every other project in a fan-out', () => {
    expect(ticketAndGoalForCwd('/b/shop', '/a/website', 't1', 'g1', true)).toEqual({});
  });

  it('drops the binding when a fan-out has no home path', () => {
    expect(ticketAndGoalForCwd('/a/website', '', 't1', 'g1', true)).toEqual({});
  });
});
