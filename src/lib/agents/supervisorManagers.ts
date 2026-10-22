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
/** The one line that installs okf; the inspector offers it to copy, never runs it. */
export const MANAGER_OKF_FIX = fixtures.machine.okf.fix;

const KEY_MAX_LENGTH = fixtures.keyFromName.maxLength;
const KEY_FALLBACK = fixtures.keyFromName.fallback;
/** Shaped like an agent id, which `events.subscribe` reads as an id (supervisorLink fixtures). */
const RESERVED_KEY = /^agent-\d+$/;
// Line breaks, control characters and the invisible or reordering format characters
// (zero-width, bidi), as in `is_invisible_format` in managers.rs: names are shown on one line.
const NOT_ONE_LINE =
  /[\p{Cc}\p{Zl}\p{Zp}\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u;

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
 * Letters that fold to ASCII for a key, exactly `FOLDED_LETTERS` in
 * `supervisor/managers.rs`. Not Unicode normalisation: NFKD would drop ß, Ł, Ø
 * and Đ, and fold ligatures Rust leaves alone, so the sheet would show an
 * address Rust does not assign.
 */
const FOLDED_LETTERS: readonly (readonly [string, string])[] = [
  ['ÀÁÂÃÄÅàáâãäåĀāĂăĄą', 'a'],
  ['ÇçĆćĈĉĊċČč', 'c'],
  ['ĎďĐđ', 'd'],
  ['ÈÉÊËèéêëĒēĔĕĖėĘęĚě', 'e'],
  ['ĜĝĞğĠġĢģ', 'g'],
  ['ÌÍÎÏìíîïĨĩĪīĬĭĮįİı', 'i'],
  ['ĹĺĻļĽľŁł', 'l'],
  ['ÑñŃńŅņŇň', 'n'],
  ['ÒÓÔÕÖØòóôõöøŌōŎŏŐő', 'o'],
  ['ŔŕŖŗŘř', 'r'],
  ['ŚśŜŝŞşŠš', 's'],
  ['ŢţŤť', 't'],
  ['ÙÚÛÜùúûüŨũŪūŬŭŮůŰűŲų', 'u'],
  ['ÝýÿŶŷŸ', 'y'],
  ['ŹźŻżŽž', 'z'],
  ['ß', 'ss'],
  ['Ææ', 'ae'],
  ['Œœ', 'oe'],
  ['ﬀ', 'ff'],
  ['ﬁ', 'fi'],
  ['ﬂ', 'fl'],
];

/** Appends one character of a name to a key under construction; anything else is one dash. */
function foldLetter(key: string, character: string): string {
  if (/^[A-Za-z0-9]$/.test(character)) return key + character.toLowerCase();
  const ascii = FOLDED_LETTERS.find(([letters]) => letters.includes(character))?.[1];
  if (ascii) return key + ascii;
  return key.endsWith('-') ? key : `${key}-`;
}

/**
 * The address a new manager gets from its name: fold to ASCII (the table above), lowercase, runs
 * of anything else become one dash. `taken` is every registry key (archived
 * included) and every live supervisor's key; a taken or reserved key gets -2,
 * -3, … appended.
 */
export function keyFromName(name: string, taken: readonly string[]): string {
  const folded = [...name].reduce(foldLetter, '').replace(/^-+|-+$/g, '');
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

/** Longest finding message or path the prompt carries; a file's own text must not fill it. */
const FINDING_TEXT_MAX_LENGTH = 200;

/** One line, no control characters, cut to length: a finding quotes file content. */
function promptSafe(text: string): string {
  const oneLine = text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim();
  const characters = [...oneLine];
  return characters.length <= FINDING_TEXT_MAX_LENGTH
    ? oneLine
    : `${characters.slice(0, FINDING_TEXT_MAX_LENGTH - 1).join('')}…`;
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
    lines: shown.map((f) =>
      f.path ? `- ${promptSafe(f.path)}: ${promptSafe(f.message)}` : `- ${promptSafe(f.message)}`
    ),
    omitted: findings.length - shown.length,
  };
}

/** okf cannot check the bundle here, so only our layout rules are watching. */
export function layoutRulesRunWithoutOkf(state: OkfState): boolean {
  return state === 'missing' || state === 'outdated' || state === 'unrecognised';
}

/** "mail-triage" -> "Mail Triage": the name the Promote sheet suggests for a run that has a key. */
export function nameFromKey(key: string): string {
  return key
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Lowercase hex SHA-256 of the UTF-8 text, as Rust books it in `lastLaunch`. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether `INSTRUCTIONS.md` differs from what the last start injected. Before
 * the first start there is nothing to differ from; a missing file hashes as the
 * empty text, as in `record_launch`.
 */
export async function instructionsChangedSince(
  lastLaunch: SupervisorManager['lastLaunch'],
  currentText: string | null
): Promise<boolean> {
  if (!lastLaunch) return false;
  return (await sha256Hex(currentText ?? '')) !== lastLaunch.instructionsSha256;
}

const HTML_COMMENT = /<!--[\s\S]*?-->/g;

/** The first line of substance in the instructions, for one line of the inspector. */
export function instructionsPreview(text: string | null): string | null {
  if (text === null) return null;
  const line = text
    .replace(HTML_COMMENT, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('#'));
  return line ? line.replace(/^[-*]\s+/, '') : null;
}
