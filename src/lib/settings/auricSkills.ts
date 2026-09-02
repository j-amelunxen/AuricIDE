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

/** Discriminator so a theme or provider JSON is not read as a skill library. */
export const AURIC_SKILLS_KIND = 'auric-skills';
export const AURIC_SKILLS_SCHEMA_VERSION = 1;

export type ParseAuricSkillsResult =
  { ok: true; skills: AuricSkillDefinition[] } | { ok: false; error: string };

export interface MergeAuricSkillsResult {
  skills: AuricSkillDefinition[];
  added: number;
  updated: number;
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

function normalizeAuricSkill(value: unknown): AuricSkillDefinition | null {
  if (!isAuricSkill(value)) return null;
  const description = value.description?.trim();
  return {
    id: value.id.trim(),
    name: value.name.trim(),
    prompt: value.prompt.trim(),
    ...(description ? { description } : {}),
  };
}

function skillsFromUnknownList(list: unknown[]): ParseAuricSkillsResult {
  const skills = list
    .map(normalizeAuricSkill)
    .filter((skill): skill is AuricSkillDefinition => skill !== null);
  if (list.length > 0 && skills.length === 0) {
    return { ok: false, error: 'No valid skills in this file' };
  }
  return { ok: true, skills };
}

function looksLikeEnvelope(value: object): boolean {
  return 'kind' in value || 'schemaVersion' in value || 'skills' in value;
}

/** JSON a machine can re-import, and a person can edit. Incomplete drafts are dropped. */
export function serializeAuricSkills(skills: AuricSkillDefinition[]): string {
  const normalized = skills
    .map(normalizeAuricSkill)
    .filter((skill): skill is AuricSkillDefinition => skill !== null);
  return JSON.stringify(
    {
      kind: AURIC_SKILLS_KIND,
      schemaVersion: AURIC_SKILLS_SCHEMA_VERSION,
      skills: normalized,
    },
    null,
    2
  );
}

/**
 * Accepts the versioned envelope, a bare array, or one skill object. Anything
 * else — including a theme JSON that happens to have a name — is refused.
 */
export function parseAuricSkillsJson(json: string): ParseAuricSkillsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }

  if (Array.isArray(parsed)) return skillsFromUnknownList(parsed);

  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, error: 'Not an Auric skills file' };
  }

  if (looksLikeEnvelope(parsed)) {
    const envelope = parsed as Record<string, unknown>;
    if (envelope.kind !== AURIC_SKILLS_KIND) {
      return { ok: false, error: 'Not an Auric skills file' };
    }
    if (envelope.schemaVersion !== AURIC_SKILLS_SCHEMA_VERSION) {
      return {
        ok: false,
        error: `Unsupported schema version ${String(envelope.schemaVersion)}`,
      };
    }
    if (!Array.isArray(envelope.skills)) {
      return { ok: false, error: 'skills must be an array' };
    }
    return skillsFromUnknownList(envelope.skills);
  }

  const single = normalizeAuricSkill(parsed);
  if (!single) return { ok: false, error: 'Not an Auric skills file' };
  return { ok: true, skills: [single] };
}

/** Same id overwrites in place so project references keep resolving. New ids append. */
export function mergeAuricSkills(
  current: AuricSkillDefinition[],
  incoming: AuricSkillDefinition[]
): MergeAuricSkillsResult {
  const indexById = new Map(current.map((skill, index) => [skill.id, index]));
  const skills = current.map((skill) => ({ ...skill }));
  let added = 0;
  let updated = 0;
  for (const incomingSkill of incoming) {
    const index = indexById.get(incomingSkill.id);
    if (index === undefined) {
      indexById.set(incomingSkill.id, skills.length);
      skills.push(incomingSkill);
      added += 1;
    } else {
      skills[index] = incomingSkill;
      updated += 1;
    }
  }
  return { skills, added, updated };
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
