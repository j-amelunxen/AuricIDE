import { describe, expect, it } from 'vitest';
import managerFixtures from '@/lib/agents/supervisorManagers.fixtures.json';
import { managerAction } from './managerAction';
import { parseNotificationActions } from './types';

const manager = { key: 'release-desk', name: 'Release Desk' };

describe('managerAction', () => {
  it('labels the button like the session-end notification does', () => {
    expect(managerAction(manager).label).toBe(
      managerFixtures.sessionEnd.action.label.replace('<name>', 'Release Desk')
    );
  });

  it('is an open-manager action addressed by key, with the name as a snapshot', () => {
    expect(managerAction(manager)).toMatchObject({
      kind: managerFixtures.openManagerAction.kind,
      managerKey: 'release-desk',
      managerName: 'Release Desk',
    });
  });

  it('carries a trimmed task and the launch mode', () => {
    expect(managerAction(manager, { task: '  Check tickets \n', launch: 'auto' })).toMatchObject({
      task: 'Check tickets',
      launch: 'auto',
    });
  });

  it.each(['', '   ', '\n\t'])('leaves %j out: blank text is no task', (task) => {
    expect(managerAction(manager, { task })).not.toHaveProperty('task');
  });

  it('has no task and no launch key at all when none is given', () => {
    const action = managerAction(manager);
    expect(action).not.toHaveProperty('task');
    expect(action).not.toHaveProperty('launch');
  });

  it('survives the parser that stands between storage and the buttons', () => {
    const action = managerAction(manager, { task: 'Check tickets', launch: 'direct' });
    expect(parseNotificationActions([action], () => false)).toEqual([action]);
  });
});
