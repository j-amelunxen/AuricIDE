import { comboMenuLabel } from './combo';
import {
  quickAccessCombos,
  quickAccessSkills,
  type QuickAccessCombo,
  type QuickAccessSkill,
  type StarredProject,
} from '@/lib/store/starredProjectsSlice';

export const COMBO_SLOT_PREFIX = 'combo:';

export type WheelLaunchEntry =
  { kind: 'skill'; skill: QuickAccessSkill } | { kind: 'combo'; combo: QuickAccessCombo };

/**
 * What a wheel plus can assign: whole combos first, then pinned skills,
 * then combo steps that are not already pinned. The chain and the single
 * steps are both real Configure objects — hiding one behind the other
 * made the plus look empty.
 */
export function launchEntriesForProject(project: StarredProject): WheelLaunchEntry[] {
  return launchEntries(quickAccessSkills(project), quickAccessCombos(project));
}

/**
 * The same list from loose skills and combos, for the settings dialog: it edits
 * drafts that are not on the project record yet.
 */
export function launchEntries(
  pinned: QuickAccessSkill[],
  combos: QuickAccessCombo[]
): WheelLaunchEntry[] {
  const seen = new Set<string>();
  const skills: QuickAccessSkill[] = [];

  const takeSkill = (skill: QuickAccessSkill) => {
    if (seen.has(skill.id)) return;
    if (skill.invocation && seen.has(`inv:${skill.invocation}`)) return;
    seen.add(skill.id);
    if (skill.invocation) seen.add(`inv:${skill.invocation}`);
    skills.push(skill);
  };

  for (const skill of pinned) takeSkill(skill);
  for (const entry of combos) {
    for (const step of entry.steps) takeSkill(step);
  }

  return [
    ...combos.map((combo) => ({ kind: 'combo' as const, combo })),
    ...skills.map((skill) => ({ kind: 'skill' as const, skill })),
  ];
}

export function wheelSlotId(entry: WheelLaunchEntry): string {
  return entry.kind === 'combo' ? `${COMBO_SLOT_PREFIX}${entry.combo.id}` : entry.skill.id;
}

export function wheelKnownIds(project: StarredProject): string[] {
  return launchEntriesForProject(project).map(wheelSlotId);
}

export function resolveWheelEntry(
  project: StarredProject,
  slotId: string | null
): WheelLaunchEntry | null {
  if (slotId === null) return null;
  return launchEntriesForProject(project).find((entry) => wheelSlotId(entry) === slotId) ?? null;
}

export function wheelEntryLabel(entry: WheelLaunchEntry): string {
  return entry.kind === 'combo' ? comboMenuLabel(entry.combo) : entry.skill.label;
}

export function wheelEntryName(entry: WheelLaunchEntry): string {
  return entry.kind === 'combo' ? entry.combo.label : entry.skill.label;
}
