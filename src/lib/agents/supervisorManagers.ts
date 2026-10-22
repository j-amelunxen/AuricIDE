import type {
  ManagerMemoryFinding,
  OkfState,
  SupervisorManager,
} from '@/lib/tauri/supervisorManagers';
import type { SupervisorRun } from '@/lib/tauri/supervisorRuns';
import fixtures from './supervisorManagers.fixtures.json';

/**
 * The TypeScript half of `docs/design-project-manager.md`. Name rules, the key
 * derivation and the refusal sentences are twins of `supervisor/managers.rs`;
 * both run `supervisorManagers.fixtures.json`, so change the fixtures first.
 */

export const MANAGER_NAME_MAX_LENGTH = fixtures.names.maxLength;
/** Section folder -> concept type, in the order the prompt lists them. */
export const MANAGER_MEMORY_SECTIONS: Readonly<Record<string, string>> = fixtures.memory.sections;
/** The concept front matter the layout check enforces, as the prompt restates it. */
export const MANAGER_CONCEPT_FIELDS = {
  required: fixtures.memory.requiredFields,
  optional: fixtures.memory.optionalFields,
  statuses: fixtures.memory.statuses,
};
export const MANAGER_OKF_VERSION = fixtures.memory.okfVersion;
export const MANAGER_LOG_FILE = fixtures.memory.logFile;

const KEY_MAX_LENGTH = fixtures.keyFromName.maxLength;
const KEY_FALLBACK = fixtures.keyFromName.fallback;
/** Shaped like an agent id, which `events.subscribe` reads as an id (supervisorLink fixtures). */
const RESERVED_KEY = /^agent-\d+$/;
// Line breaks and every other control character: the menu bar lists names on one line.
const NOT_ONE_LINE = /[\p{Cc}\p{Zl}\p{Zp}]/u;

export const MANAGER_NAME_INVALID_SENTENCE = `A Project Manager name needs 1 to ${MANAGER_NAME_MAX_LENGTH} characters on one line.`;

export type ManagerNameCheck = { ok: true; name: string } | { ok: false; reason: string };

/** What the Promote sheet checks as you type; Rust decides. */
export function validateManagerName(raw: string): ManagerNameCheck {
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1 || length > MANAGER_NAME_MAX_LENGTH || NOT_ONE_LINE.test(name)) {
    return { ok: false, reason: MANAGER_NAME_INVALID_SENTENCE };
  }
  return { ok: true, name };
}

/** Unique among non-archived managers, ignoring case; `exceptKey` lets a rename keep its own. */
export function isManagerNameTaken(
  name: string,
  managers: Pick<SupervisorManager, 'key' | 'name' | 'archivedAt'>[],
  exceptKey?: string
): boolean {
  const wanted = name.trim().toLowerCase();
  return managers.some(
    (m) => m.archivedAt === null && m.key !== exceptKey && m.name.trim().toLowerCase() === wanted
  );
}

function cutKey(base: string, suffix: string): string {
  const room = KEY_MAX_LENGTH - suffix.length;
  return `${base.slice(0, room).replace(/-+$/, '')}${suffix}`;
}

/**
 * The address a new manager gets from its name: fold to ASCII, lowercase, runs
 * of anything else become one dash. `taken` is every registry key (archived
 * included) and every live supervisor's key; a taken or reserved key gets -2,
 * -3, … appended.
 */
export function keyFromName(name: string, taken: readonly string[]): string {
  const folded = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = cutKey(folded, '') || KEY_FALLBACK;
  const unavailable = (key: string) => taken.includes(key) || RESERVED_KEY.test(key);
  if (!unavailable(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = cutKey(base, `-${n}`);
    if (!unavailable(candidate)) return candidate;
  }
}

export type ManagerRefusalCode = Exclude<keyof typeof fixtures.refusals, '$comment'>;

const REFUSALS = Object.entries(fixtures.refusals)
  .filter(([code]) => !code.startsWith('$'))
  .map(([code, pattern]) => [code as ManagerRefusalCode, new RegExp(pattern)] as const);

/** Rust refuses with a sentence; the contract says which code it stands for. */
export function managerRefusalCode(error: unknown): ManagerRefusalCode | null {
  const sentence = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return REFUSALS.find(([, pattern]) => pattern.test(sentence))?.[0] ?? null;
}

const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? '';

/**
 * The non-archived manager a launch is for: the one owning the resumed run
 * folder, else the one holding the key. An archived manager is left out on
 * purpose: Rust refuses that launch with `manager_archived`, and a prompt
 * built for it would only be thrown away.
 */
export function findLaunchManager(
  managers: SupervisorManager[],
  launch: { resumeRunDir?: string; key?: string }
): SupervisorManager | undefined {
  const live = managers.filter((m) => m.archivedAt === null);
  if (launch.resumeRunDir) {
    const folder = basename(launch.resumeRunDir);
    return live.find((m) => m.runDir === folder);
  }
  return launch.key ? live.find((m) => m.key === launch.key) : undefined;
}

/**
 * Why opening this key cannot work, in Rust's sentences (`manager_archived`,
 * `manager_not_found`), so the pre-check and Rust's own refusal read alike.
 */
export function missingManagerError(managers: SupervisorManager[], key: string): Error {
  const archived = managers.find((m) => m.key === key && m.archivedAt !== null);
  return new Error(
    archived
      ? `The Project Manager '${archived.name}' is archived. Restore it before opening it.`
      : `No Project Manager has the key '${key}'.`
  );
}

type ManagedRun = SupervisorRun & { manager: NonNullable<SupervisorRun['manager']> };

export interface SupervisorRunGroups {
  managers: ManagedRun[];
  archived: ManagedRun[];
  /** Ordinary runs, in the order Rust listed them (most recently changed first). */
  recent: SupervisorRun[];
}

const byManagerName = (a: ManagedRun, b: ManagedRun) =>
  a.manager.name.toLowerCase().localeCompare(b.manager.name.toLowerCase()) ||
  a.manager.key.localeCompare(b.manager.key);

/**
 * The runs rail's sections. A manager folder never shows among the runs, and
 * managers sort by name so they do not move when they are used.
 */
export function splitSupervisorRuns(runs: SupervisorRun[]): SupervisorRunGroups {
  const managed = runs.filter((run): run is ManagedRun => !!run.manager).sort(byManagerName);
  return {
    managers: managed.filter((run) => run.manager.archivedAt === null),
    archived: managed.filter((run) => run.manager.archivedAt !== null),
    recent: runs.filter((run) => !run.manager),
  };
}

/** The findings the next start prompt carries, capped at the contract's limit. */
export function memoryFindingLines<F extends Pick<ManagerMemoryFinding, 'path' | 'message'>>(
  findings: F[]
): {
  lines: string[];
  omitted: number;
} {
  const shown = findings.slice(0, fixtures.memory.maxFindingsInPrompt);
  return {
    lines: shown.map((f) => (f.path ? `- ${f.path}: ${f.message}` : `- ${f.message}`)),
    omitted: findings.length - shown.length,
  };
}

/** okf cannot check the bundle here, so only our layout rules are watching. */
export function layoutRulesRunWithoutOkf(state: OkfState): boolean {
  return state === 'missing' || state === 'outdated' || state === 'unrecognised';
}
