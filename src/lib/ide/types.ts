export type BottomTab = 'terminal' | 'problems';

export interface ActivityItem {
  id: string;
  icon: string;
  label: string;
  badge?: number;
  /**
   * 'tools' demotes an item below the separator with compact styling —
   * means, not destinations. Omitted = primary loop surface.
   */
  section?: 'primary' | 'tools';
  /** Hidden from the rail when no project is open. */
  requiresProject?: boolean;
}
