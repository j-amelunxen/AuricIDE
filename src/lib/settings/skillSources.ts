export const SKILL_SOURCES_KEY = 'auric.skill-sources';

/**
 * Where to look for skills, as data rather than as code.
 *
 * Which directory layout applies depends entirely on which agent CLI you run,
 * so the scanner knows no conventions of its own — it is handed these rules and
 * follows them, against the project directory and against your home directory.
 * Adding support for another agent is an entry here, not a change to the
 * backend.
 */
export interface SkillSourceRule {
  id: string;
  label: string;
  /** Markdown files here become `/<name>`; subdirectories namespace as `/dir:name`. */
  commandsDir?: string;
  /** Each subdirectory here holding `manifest` becomes one skill. */
  skillsDir?: string;
  manifest?: string;
  extension: string;
  enabled: boolean;
}

/**
 * The only convention verified against real files. Others are reachable through
 * a custom rule rather than shipped as guesses: a preset that quietly matches
 * nothing is worse than an empty field that says what it wants.
 */
export const CLAUDE_SKILL_SOURCE: SkillSourceRule = {
  id: 'claude',
  label: 'Claude Code',
  commandsDir: '.claude/commands',
  skillsDir: '.claude/skills',
  manifest: 'SKILL.md',
  extension: 'md',
  enabled: true,
};

function isRule(value: unknown): value is SkillSourceRule {
  if (typeof value !== 'object' || value === null) return false;
  const rule = value as Record<string, unknown>;
  const optionalString = (key: string) => rule[key] === undefined || typeof rule[key] === 'string';
  return (
    typeof rule.id === 'string' &&
    rule.id.length > 0 &&
    typeof rule.label === 'string' &&
    typeof rule.extension === 'string' &&
    typeof rule.enabled === 'boolean' &&
    optionalString('commandsDir') &&
    optionalString('skillsDir') &&
    optionalString('manifest')
  );
}

/** Falls back to the Claude convention for anything unreadable. */
export function loadSkillSources(): SkillSourceRule[] {
  if (typeof localStorage === 'undefined') return [CLAUDE_SKILL_SOURCE];
  try {
    const raw = localStorage.getItem(SKILL_SOURCES_KEY);
    if (!raw) return [CLAUDE_SKILL_SOURCE];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [CLAUDE_SKILL_SOURCE];
    const rules = parsed.filter(isRule);
    // An empty result means every stored rule was malformed, not that the user
    // turned everything off — turning them off keeps the rules, disabled.
    return rules.length > 0 ? rules : [CLAUDE_SKILL_SOURCE];
  } catch {
    return [CLAUDE_SKILL_SOURCE];
  }
}

export function saveSkillSources(sources: SkillSourceRule[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SKILL_SOURCES_KEY, JSON.stringify(sources));
  } catch {
    // Storage full or blocked — losing the preference is survivable.
  }
}

export function enabledSkillSources(sources: SkillSourceRule[]): SkillSourceRule[] {
  return sources.filter((source) => source.enabled);
}
