/**
 * When the left sidebar takes up room, and what a click on the rail does to it.
 *
 * The shell used to reserve the panel's column whenever a panel element was
 * passed — even when `LeftSidebarPanel` rendered nothing — and offered no way
 * to close it again. Both answers live here so the rail and the shell agree.
 */

/** Activities that render something in `LeftSidebarPanel`. Keep in step with its switch. */
const LEFT_PANEL_ACTIVITIES: ReadonlySet<string> = new Set([
  'explorer',
  'source-control',
  'outline',
  'extensions',
  'qa',
  'scratches',
  'notifications',
  'inbox',
]);

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
  return LEFT_PANEL_ACTIVITIES.has(activeActivity) && availableIds.includes(activeActivity);
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
  return LEFT_PANEL_ACTIVITIES.has(clicked) ? 'toggle' : 'select';
}
