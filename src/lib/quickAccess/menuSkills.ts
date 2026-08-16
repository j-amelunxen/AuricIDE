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
