/**
 * When the left sidebar takes up room, and what a click on the rail does to it.
 *
 * The shell used to reserve the panel's column whenever a panel element was
 * passed — even when `LeftSidebarPanel` rendered nothing — and offered no way
 * to close it again. Both answers live here so the rail and the shell agree.
 */

/** Activities that render something in `LeftSidebarPanel`; its switch is exhaustive over these. */
const LEFT_PANEL_ACTIVITIES = [
  'explorer',
  'source-control',
  'outline',
  'extensions',
  'qa',
  'scratches',
  'supervisor-runs',
  'notifications',
  'inbox',
] as const;
type LeftPanelActivity = (typeof LEFT_PANEL_ACTIVITIES)[number];

export function isLeftPanelActivity(id: string): id is LeftPanelActivity {
  return (LEFT_PANEL_ACTIVITIES as readonly string[]).includes(id);
}

export function leftPanelVisible({
  activeActivity,
  availableIds,
  collapsed,
}: {
  activeActivity: string;
  availableIds: readonly string[];
  collapsed: boolean;
}): boolean {
  if (collapsed) return false;
  return isLeftPanelActivity(activeActivity) && availableIds.includes(activeActivity);
}

/**
 * Clicking the icon of the panel that is already showing folds it away, the
 * way editors people already know behave. While the work place covers the
 * editor area the click means "take me back there", so it selects instead.
 */
export function activityClick({
  clicked,
  activeActivity,
  workPlaceOpen,
}: {
  clicked: string;
  activeActivity: string;
  workPlaceOpen: boolean;
}): 'toggle' | 'select' {
  if (workPlaceOpen) return 'select';
  if (clicked !== activeActivity) return 'select';
  return isLeftPanelActivity(clicked) ? 'toggle' : 'select';
}
