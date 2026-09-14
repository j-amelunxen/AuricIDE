import { describe, expect, it } from 'vitest';
import { activityClick, leftPanelVisible } from './leftPanel';

describe('leftPanelVisible', () => {
  const available = ['explorer', 'source-control', 'cockpit', 'inbox'];

  it('shows the panel for an available activity that has one', () => {
    expect(
      leftPanelVisible({ activeActivity: 'explorer', availableIds: available, collapsed: false })
    ).toBe(true);
  });

  it('hides it while the user has collapsed it', () => {
    expect(
      leftPanelVisible({ activeActivity: 'explorer', availableIds: available, collapsed: true })
    ).toBe(false);
  });

  it('reserves no column for an activity without a panel', () => {
    expect(
      leftPanelVisible({ activeActivity: 'cockpit', availableIds: available, collapsed: false })
    ).toBe(false);
  });

  it('reserves no column when the active activity is not on the rail (no project open)', () => {
    expect(
      leftPanelVisible({ activeActivity: 'explorer', availableIds: ['inbox'], collapsed: false })
    ).toBe(false);
  });
});

describe('activityClick', () => {
  it('toggles the panel when the active activity is clicked again', () => {
    expect(activityClick({ clicked: 'inbox', activeActivity: 'inbox', workPlaceOpen: false })).toBe(
      'toggle'
    );
  });

  it('selects a different activity', () => {
    expect(
      activityClick({ clicked: 'explorer', activeActivity: 'inbox', workPlaceOpen: false })
    ).toBe('select');
  });

  it('selects rather than toggles while the work place covers the panel', () => {
    expect(activityClick({ clicked: 'inbox', activeActivity: 'inbox', workPlaceOpen: true })).toBe(
      'select'
    );
  });

  it('never toggles an activity that has no panel to collapse', () => {
    expect(
      activityClick({ clicked: 'cockpit', activeActivity: 'cockpit', workPlaceOpen: false })
    ).toBe('select');
  });
});
