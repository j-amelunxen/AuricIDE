import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '@/lib/config/appConfig';
import type { QuickAccessSkill } from '@/lib/store/starredProjectsSlice';

/**
 * What the supervisor tile can launch: its skills and the wheel slots they
 * sit on. Application-wide, because the supervisor belongs to no project.
 *
 * A skill here is a prompt, never a `/skill` invocation: the supervisor runs
 * Claude Code with `--restricted`, which loads no skills from disk, so a
 * typed `/name` reaches it as an unknown command (checked against the real
 * CLI on 2026-10-16). Provider and permission mode are left out because Rust
 * fixes both for a supervisor; the model is the one launch option it keeps.
 */
export interface SupervisorPresets {
  skills: QuickAccessSkill[];
  wheelSlots: (string | null)[];
}

export const EMPTY_SUPERVISOR_PRESETS: SupervisorPresets = { skills: [], wheelSlots: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function parseSkill(value: unknown): QuickAccessSkill | null {
  if (!isRecord(value)) return null;
  const { id, label, prompt } = value;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof label !== 'string' || typeof prompt !== 'string') return null;
  const model = optionalString(value.model);
  const auricSkillId = optionalString(value.auricSkillId);
  return {
    id,
    label,
    prompt,
    ...(model ? { model } : {}),
    ...(auricSkillId ? { auricSkillId } : {}),
  };
}

/** Reads a stored value; anything it cannot use is dropped, never thrown. */
export function parseSupervisorPresets(raw: string | null): SupervisorPresets {
  if (!raw) return EMPTY_SUPERVISOR_PRESETS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_SUPERVISOR_PRESETS;
  }
  if (!isRecord(parsed)) return EMPTY_SUPERVISOR_PRESETS;
  const skills = Array.isArray(parsed.skills)
    ? parsed.skills.map(parseSkill).filter((skill): skill is QuickAccessSkill => skill !== null)
    : [];
  const wheelSlots = Array.isArray(parsed.wheelSlots)
    ? parsed.wheelSlots.map((slot) => (typeof slot === 'string' ? slot : null))
    : [];
  return { skills, wheelSlots };
}

export function loadSupervisorPresets(): SupervisorPresets {
  return parseSupervisorPresets(readAppPref(APP_CONFIG_KEYS.supervisorQuickAccess));
}

export function saveSupervisorPresets(presets: SupervisorPresets): void {
  const clean = parseSupervisorPresets(JSON.stringify(presets));
  writeAppPref(APP_CONFIG_KEYS.supervisorQuickAccess, JSON.stringify(clean));
}
