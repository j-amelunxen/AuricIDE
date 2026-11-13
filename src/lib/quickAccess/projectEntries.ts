import { loadAuricSkills, resolveAuricSkillReference } from '@/lib/settings/auricSkills';
import type { QuickAccessCombo, QuickAccessSkill, StarredProject } from './types';

/** A starred project's pinned skills, library references resolved to their current text. */
export function quickAccessSkills(project: StarredProject): QuickAccessSkill[] {
  const library = loadAuricSkills();
  return (project.skills ?? []).map((skill) => resolveAuricSkillReference(skill, library));
}

/** A starred project's combos, each step's library reference resolved like a pinned skill. */
export function quickAccessCombos(project: StarredProject): QuickAccessCombo[] {
  const library = loadAuricSkills();
  return (project.combos ?? []).map((combo) => ({
    ...combo,
    steps: combo.steps.map((step) => resolveAuricSkillReference(step, library)),
  }));
}
