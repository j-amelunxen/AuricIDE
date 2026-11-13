import type { PermissionMode } from '../agents/types';

/**
 * The mark drawn on a tile instead of the generated initials. Absent means
 * "generate one from the path", which is what every tile did before this
 * existed. Narrowed from the backend's deliberately lenient `{kind, value}`:
 * a kind this build does not know falls back to the generated tile rather
 * than breaking the row.
 */
export type ProjectIconOverride =
  | { kind: 'glyph'; value: string }
  | { kind: 'emoji'; value: string }
  | { kind: 'image'; value: string };

export interface QuickAccessSkill {
  id: string;
  label: string;
  prompt: string;
  providerId?: string;
  model?: string;
  permissionMode?: PermissionMode;
  invocation?: string;
  auricSkillId?: string;
  /**
   * Supervisor tile only: a global accelerator (`Control+Alt+KeyV`) that starts
   * this skill from the menu bar. Project tiles neither offer nor store it.
   */
  shortcut?: string;
}

export interface QuickAccessCombo {
  id: string;
  label: string;
  steps: QuickAccessSkill[];
}

/**
 * A lane mark on one checkout. `color` is a key, not a guarantee this build
 * paints it — unknown keys still round-trip. See `src/lib/quickAccess/badge.ts`.
 */
export interface ProjectBadge {
  text: string;
  color: string;
}

export interface StarredProjectSettings {
  icon?: ProjectIconOverride;
  skills: QuickAccessSkill[];
  combos?: QuickAccessCombo[];
  wheelSlots?: (string | null)[];
  /**
   * Omit to leave the stored badge alone. `null` clears it. An icon or skill
   * save must not mention this field, or a lane mark disappears with it.
   */
  badge?: ProjectBadge | null;
  /**
   * Same tri-state as `badge`: omit to keep, `null` clears, a string sets it.
   * Rust trims it and caps it at 300 characters.
   */
  description?: string | null;
  /**
   * Same tri-state again. A number docks the project at that place among the
   * docked ones (or moves it there); `null` takes it out of the dock.
   */
  dockIndex?: number | null;
}

/**
 * A project the user pinned for one-click switching. Unlike {@link RecentProject},
 * a starred entry is INDEPENDENT of recency: it survives even when the project
 * falls off the (capped, recency-ordered) recent list.
 *
 * The array is kept in STAR order — new stars append, nothing reorders — but that
 * is NOT the display order: `QuickAccess` sorts the tiles, by name unless the
 * user switches to badge. Star order still carries weight:
 * `starredAt` means "pinned since", and the Rust store sorts and dedupes on it
 * (`merge_starred_projects`), so both sides agree on which copy of a path wins.
 */
export interface StarredProject {
  path: string;
  name: string;
  starredAt: number;
  icon?: ProjectIconOverride;
  skills?: QuickAccessSkill[];
  combos?: QuickAccessCombo[];
  wheelSlots?: (string | null)[];
  badge?: ProjectBadge;
  /** What the owner says the project is for; see `src/lib/quickAccess/description.ts`. */
  description?: string;
  /** Place in the Quick Access dock; absent means not docked. See `quickAccess/dock.ts`. */
  dockIndex?: number;
}
