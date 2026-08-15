import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '../config/appConfig';

/** A prompt-backed capability owned by Auric rather than by one agent harness. */
export interface AuricSkillDefinition {
  id: string;
  name: string;
  description?: string;
  prompt: string;
}

export interface AuricSkillReference {
  label: string;
  prompt: string;
  auricSkillId?: string;
}

function isAuricSkill(value: unknown): value is AuricSkillDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AuricSkillDefinition>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.trim().length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.trim().length > 0 &&
    typeof candidate.prompt === 'string' &&
    candidate.prompt.trim().length > 0 &&
    (candidate.description === undefined || typeof candidate.description === 'string')
  );
}

/** Application-wide. Shared prefs mirrors this across Auric's webview origins. */
export function loadAuricSkills(): AuricSkillDefinition[] {
  try {
    const raw = readAppPref(APP_CONFIG_KEYS.auricSkills);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAuricSkill);
  } catch {
    return [];
  }
}

export function saveAuricSkills(skills: AuricSkillDefinition[]): void {
  writeAppPref(APP_CONFIG_KEYS.auricSkills, JSON.stringify(skills));
}

/**
 * A project keeps a snapshot so deletion never breaks an existing launch. While
 * the definition exists, however, its current name and prompt are authoritative.
 */
export function resolveAuricSkillReference<T extends AuricSkillReference>(
  reference: T,
  library: AuricSkillDefinition[] = loadAuricSkills()
): T {
  if (!reference.auricSkillId) return reference;
  const definition = library.find((skill) => skill.id === reference.auricSkillId);
  if (!definition) return reference;
  return { ...reference, label: definition.name, prompt: definition.prompt };
}
