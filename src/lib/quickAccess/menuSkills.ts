import type { QuickAccessSkill } from '@/lib/store/starredProjectsSlice';
import type { AuricSkillDefinition } from '@/lib/settings/auricSkills';

/**
 * The right-click menu's "Skills" list: pinned skills first, then any global
 * Auric Skill not already pinned to this project. Authoring a skill in
 * Settings is enough to launch it from here — pinning stays what puts a
 * skill on the wheel, but it is no longer required just to see it.
 */
export function menuSkillEntries(
  pinned: QuickAccessSkill[],
  library: AuricSkillDefinition[]
): QuickAccessSkill[] {
  const pinnedAuricIds = new Set(
    pinned.map((skill) => skill.auricSkillId).filter((id): id is string => !!id)
  );
  const unpinned = library
    .filter((definition) => !pinnedAuricIds.has(definition.id))
    .map((definition) => ({
      id: `auric:${definition.id}`,
      label: definition.name,
      prompt: definition.prompt,
      auricSkillId: definition.id,
    }));
  return [...pinned, ...unpinned];
}

/**
 * A wheel offers the same list as the menu, so a library skill can go on a
 * slot directly. Putting it there is what pins it: the skill joins the tile's
 * own list under the `auric:` id the slot already holds, and the slot keeps
 * resolving. Returns `pinned` itself when nothing new was slotted.
 */
export function pinSlottedLibrarySkills(
  pinned: QuickAccessSkill[],
  slots: (string | null)[],
  library: AuricSkillDefinition[]
): QuickAccessSkill[] {
  const slotted = new Set(slots);
  const picked = menuSkillEntries(pinned, library)
    .slice(pinned.length)
    .filter((skill) => slotted.has(skill.id));
  return picked.length > 0 ? [...pinned, ...picked] : pinned;
}
