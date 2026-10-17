import fixtures from './supervisorPolicy.fixtures.json';
import type { ProviderInfo } from '../tauri/providers';
import { isProviderAllowed, type ProviderPolicy, DEFAULT_PROVIDER_POLICY } from './providerPolicy';
export { supervisorProvidersOf } from './supervisorProviders';

/**
 * What a supervisor agent may start (ADR 0004, `docs/design-agent-control.md`,
 * "Supervisor scope").
 *
 * The file is `<app_data_dir>/supervisor-policy.json`, written and enforced by
 * Rust (`src-tauri/src/supervisor/policy.rs`). This twin decides what Settings
 * and the supervisor's launch prompt offer. Both are tested against
 * `supervisorPolicy.fixtures.json`: if they disagreed, the prompt would offer a
 * model the socket refuses, or the socket would start one nobody was shown.
 *
 * Every error fails closed. Unlike the provider policy, where a corrupt blob
 * opens up, an unreadable supervisor policy allows nothing: it is the one
 * switch that lets an agent start other agents.
 */

export interface SupervisorProjectPolicy {
  allowed: boolean;
  /** `null`: every provider the project's own provider policy permits. */
  providers: string[] | null;
  /** Per provider; absent means every model it offers, an empty list blocks it. */
  models: Record<string, string[]>;
  /** Per provider; absent means the provider's own default. Never `bypassPermissions`. */
  permissionMode: Record<string, string>;
  /**
   * Load balancing: provider id → its share of spawns (0..99), e.g. `{ claude: 2, codex: 1 }`.
   * Advisory: the spawn check never reads it; `list_projects` turns it into a suggestion.
   * `{}` means no balancing.
   */
  providerWeights: Record<string, number>;
  allowInteractive: boolean;
  maxRunning: number;
}

/**
 * A skill the supervisor may load, keyed by its folder (the one holding
 * `SKILL.md`). `bash` are the only shell commands it may run, as Claude Code
 * `Bash(...)` rule patterns; none means no shell.
 */
export interface SupervisorSkillPolicy {
  bash: string[];
  /** Folders besides the run folder its file tools may use (a skill's workspace). */
  dirs: string[];
}

/**
 * A CLI tool the supervisor may run, keyed by a bare command name (found on
 * PATH) or by the absolute path of its binary. Each becomes `Bash(<tool>)`
 * and `Bash(<tool> *)` (`toolPatterns`); nothing else gets a shell.
 */
export interface SupervisorToolPolicy {
  /** Folders besides the run folder its file tools may use (the tool's data). */
  dirs: string[];
}

export interface SupervisorPolicy {
  version: 1;
  /** `chrome`: Claude in Chrome, the user's own logged-in browser; off unless switched on. */
  supervisor: {
    provider: string;
    providers?: string[];
    model: string | null;
    chrome: boolean;
  };
  maxRunningChildren: number;
  projects: Record<string, SupervisorProjectPolicy>;
  skills: Record<string, SupervisorSkillPolicy>;
  tools: Record<string, SupervisorToolPolicy>;
}

export type SupervisorParseReason =
  | 'file_missing'
  | 'malformed'
  | 'unsupported_version'
  | 'invalid_entry'
  | 'path_not_absolute'
  | 'bypass_permissions';

export interface SupervisorPolicyRejection {
  /** The project key as written, or `null` when the whole file was refused. */
  project: string | null;
  /** The skill key as written, for an entry under `skills`. */
  skill?: string;
  /** The tool key as written, for an entry under `tools`. */
  tool?: string;
  reason: SupervisorParseReason;
}

export interface ParsedSupervisorPolicy {
  policy: SupervisorPolicy;
  rejected: SupervisorPolicyRejection[];
}

export type SupervisorDeniedReason =
  | 'project_not_listed'
  | 'project_not_allowed'
  | 'provider_not_installed'
  | 'provider_not_allowed'
  | 'provider_denied_by_project'
  | 'provider_has_no_models'
  | 'model_not_allowed'
  | 'model_not_offered'
  | 'permission_mode_unattended'
  | 'interactive_not_allowed'
  | 'project_limit_reached'
  | 'global_limit_reached';

/** Human sentences for each stable key; the key is the contract, the text may change. */
export const SUPERVISOR_PARSE_REASONS = fixtures.reasons.parse as Record<
  SupervisorParseReason,
  string
>;
export const SUPERVISOR_DENIED_REASON_TEXT = fixtures.reasons.checkSpawn as Record<
  SupervisorDeniedReason,
  string
>;

const DEFAULTS = fixtures.defaults;
const CHECK_ORDER = fixtures.checkOrder as SupervisorDeniedReason[];
const REJECTED_PERMISSION_MODES: readonly string[] = fixtures.rejectedPermissionModes;
const UNRESTRICTED_TOOLS: readonly string[] = fixtures.unrestrictedTools;

/** Tools that run any code they are given, so allowing one allows everything (Settings warns). */
export function isUnrestrictedTool(tool: string): boolean {
  return UNRESTRICTED_TOOLS.includes(tool.split('/').pop() ?? tool);
}

export function emptySupervisorPolicy(): SupervisorPolicy {
  return {
    version: 1,
    supervisor: { ...DEFAULTS.supervisor },
    maxRunningChildren: DEFAULTS.maxRunningChildren,
    projects: {},
    skills: {},
    tools: {},
  };
}

/** The entry a project gets when it is first switched on in Settings. */
export function defaultSupervisorProjectPolicy(): SupervisorProjectPolicy {
  return { ...DEFAULTS.project, models: {}, permissionMode: {}, providerWeights: {} };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Provider ids are lowercase in the registry; a hand-typed entry must still match. */
function providerId(value: string): string {
  return value.trim().toLowerCase();
}

/** Absolute, without a trailing slash. Canonicalising (realpath) is Rust's job. */
export function normalizeProjectPath(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return trimmed || '/';
}

class InvalidEntry extends Error {
  constructor(readonly reason: SupervisorParseReason) {
    super(reason);
  }
}

const PM_SERVER_PREFIX = 'auric-pm-';
const PM_SLUG_MAX = 16;

/**
 * `auric-pm-<slug>` per project path, in the order given (fixture
 * `pmServerNames`). Rust starts these servers; the launch prompt names them.
 */
export function pmServerNames(paths: string[]): string[] {
  const names: string[] = [];
  for (const path of paths) {
    const base = (normalizeProjectPath(path).split('/').pop() ?? '').toLowerCase();
    let slug = base
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, PM_SLUG_MAX)
      .replace(/-+$/, '');
    if (!slug) slug = 'project';
    let name = `${PM_SERVER_PREFIX}${slug}`;
    for (let n = 2; names.includes(name); n++) name = `${PM_SERVER_PREFIX}${slug}-${n}`;
    names.push(name);
  }
  return names;
}

/** Project path → its `auric-pm` server, named over every permitted project like Rust. */
export function supervisorPmServers(policy: SupervisorPolicy): Record<string, string> {
  const permitted = Object.keys(policy.projects)
    .filter((path) => policy.projects[path].allowed)
    .sort();
  const names = pmServerNames(permitted);
  return Object.fromEntries(permitted.map((path, i) => [path, names[i]]));
}

/**
 * A pattern becomes `Bash(<pattern>)`: a bracket would end the rule early and
 * a line break or quote would split the launch command (fixture
 * `skillPatternRules`).
 */
export function isBashPattern(pattern: string): boolean {
  return !/[()"`\\\u0000-\u001f\u007f-\u009f]/.test(pattern);
}

function parseSkillEntry(value: unknown): SupervisorSkillPolicy {
  if (!isObject(value)) throw new InvalidEntry('invalid_entry');
  const raw = value.bash ?? [];
  if (!Array.isArray(raw) || !raw.every((entry) => typeof entry === 'string')) {
    throw new InvalidEntry('invalid_entry');
  }
  const bash: string[] = [];
  for (const pattern of (raw as string[]).map((entry) => entry.trim())) {
    if (!pattern || bash.includes(pattern)) continue;
    if (!isBashPattern(pattern)) throw new InvalidEntry('invalid_entry');
    bash.push(pattern);
  }
  return { bash, dirs: parseDirs(value.dirs) };
}

/** Extra folders: absolute, not the root, trimmed and without repeats. */
function parseDirs(value: unknown): string[] {
  const raw = value ?? [];
  if (!Array.isArray(raw) || !raw.every((entry) => typeof entry === 'string')) {
    throw new InvalidEntry('invalid_entry');
  }
  const dirs: string[] = [];
  for (const listed of (raw as string[]).map((entry) => entry.trim())) {
    if (!listed) continue;
    if (!listed.startsWith('/') || !isBashPattern(listed)) throw new InvalidEntry('invalid_entry');
    const dir = normalizeProjectPath(listed);
    if (dir === '/') throw new InvalidEntry('invalid_entry');
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  return dirs;
}

const BARE_TOOL_NAME = /^[A-Za-z0-9._+-]+$/;

/**
 * A tool key is a bare command name or the absolute path of a binary
 * (fixture `toolRules`). `.` alone would be `Bash(. *)`, the `source` builtin,
 * hence a name needs a letter or digit; `*` in a path would widen the rule.
 * `null`: the key is fine; otherwise the reason it is refused.
 */
export function toolKeyProblem(key: string): SupervisorParseReason | null {
  if (BARE_TOOL_NAME.test(key)) return /[A-Za-z0-9]/.test(key) ? null : 'invalid_entry';
  if (!key.startsWith('/')) return key.includes('/') ? 'path_not_absolute' : 'invalid_entry';
  const unsafe = !isBashPattern(key) || /[\s*]/.test(key);
  return unsafe || normalizeProjectPath(key) === '/' ? 'invalid_entry' : null;
}

/** The two Claude Code Bash patterns a tool is allowed under. */
export function toolPatterns(tool: string): [string, string] {
  return [tool, `${tool} *`];
}

function parseTools(
  tools: Record<string, unknown>,
  policy: SupervisorPolicy,
  rejected: SupervisorPolicyRejection[]
): void {
  for (const key of Object.keys(tools).sort()) {
    try {
      const problem = toolKeyProblem(key);
      if (problem) throw new InvalidEntry(problem);
      const entry = tools[key];
      if (!isObject(entry)) throw new InvalidEntry('invalid_entry');
      const dirs = parseDirs(entry.dirs);
      const name = key.startsWith('/') ? normalizeProjectPath(key) : key;
      const earlier = policy.tools[name];
      policy.tools[name] = {
        dirs: earlier ? earlier.dirs.filter((dir) => dirs.includes(dir)) : dirs,
      };
    } catch (error) {
      if (!(error instanceof InvalidEntry)) throw error;
      rejected.push({ project: null, tool: key, reason: error.reason });
    }
  }
}

function parseSkills(
  skills: Record<string, unknown>,
  policy: SupervisorPolicy,
  rejected: SupervisorPolicyRejection[]
): void {
  // Sorted like Rust's map, so both sides list rejections in one order.
  for (const key of Object.keys(skills).sort()) {
    if (!key.startsWith('/')) {
      rejected.push({ project: null, skill: key, reason: 'path_not_absolute' });
      continue;
    }
    try {
      const path = normalizeProjectPath(key);
      const entry = parseSkillEntry(skills[key]);
      const earlier = policy.skills[path];
      policy.skills[path] = earlier
        ? {
            bash: earlier.bash.filter((pattern) => entry.bash.includes(pattern)),
            dirs: earlier.dirs.filter((dir) => entry.dirs.includes(dir)),
          }
        : entry;
    } catch (error) {
      if (!(error instanceof InvalidEntry)) throw error;
      rejected.push({ project: null, skill: key, reason: error.reason });
    }
  }
}

function parseProviders(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new InvalidEntry('invalid_entry');
  }
  const seen = new Set<string>();
  for (const entry of value as string[]) {
    const id = providerId(entry);
    if (id) seen.add(id);
  }
  return [...seen];
}

/**
 * A per-provider map. Keys normalise like provider ids; a key that normalises
 * to nothing drops the project. Two keys for the same provider (`codex`,
 * `Codex`) are combined by `merge`.
 */
function parseProviderMap<T>(
  value: unknown,
  readValue: (entry: unknown) => T,
  merge: (previous: T, next: T) => T = (_, next) => next
): Record<string, T> {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new InvalidEntry('invalid_entry');
  const result: Record<string, T> = {};
  for (const [key, entry] of Object.entries(value)) {
    const id = providerId(key);
    if (!id) throw new InvalidEntry('invalid_entry');
    const next = readValue(entry);
    result[id] = id in result ? merge(result[id], next) : next;
  }
  return result;
}

const mergeModelLists = (previous: string[], next: string[]) => [
  ...new Set([...previous, ...next]),
];

function readModelList(entry: unknown): string[] {
  if (!Array.isArray(entry) || !entry.every((model) => typeof model === 'string')) {
    throw new InvalidEntry('invalid_entry');
  }
  // Model ids are compared exactly: `gpt-6-Luna` is not `gpt-6-luna`.
  return [...new Set(entry as string[])];
}

export const MAX_PROVIDER_WEIGHT = 99;

function readWeight(entry: unknown): number {
  if (!isLimit(entry) || entry > MAX_PROVIDER_WEIGHT) throw new InvalidEntry('invalid_entry');
  return entry;
}

function readPermissionMode(entry: unknown): string {
  if (typeof entry !== 'string') throw new InvalidEntry('invalid_entry');
  return entry;
}

function optionalOf<T>(value: unknown, check: (v: unknown) => v is T, fallback: T): T {
  if (value === undefined) return fallback;
  if (!check(value)) throw new InvalidEntry('invalid_entry');
  return value;
}

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

function parseProjectEntry(value: unknown): SupervisorProjectPolicy {
  if (!isObject(value)) throw new InvalidEntry('invalid_entry');
  const entry: SupervisorProjectPolicy = {
    allowed: optionalOf(value.allowed, isBoolean, DEFAULTS.project.allowed),
    providers: parseProviders(value.providers),
    models: parseProviderMap(value.models, readModelList, mergeModelLists),
    permissionMode: parseProviderMap(value.permissionMode, readPermissionMode),
    providerWeights: sortedKeys(parseProviderMap(value.providerWeights, readWeight, Math.min)),
    allowInteractive: optionalOf(
      value.allowInteractive,
      isBoolean,
      DEFAULTS.project.allowInteractive
    ),
    maxRunning: optionalOf(value.maxRunning, isLimit, DEFAULTS.project.maxRunning),
  };
  if (
    Object.values(entry.permissionMode).some((mode) =>
      REJECTED_PERMISSION_MODES.includes(mode.trim())
    )
  ) {
    throw new InvalidEntry('bypass_permissions');
  }
  return entry;
}

function parseSupervisorBlock(value: unknown): SupervisorPolicy['supervisor'] {
  const fallback = { ...DEFAULTS.supervisor };
  if (!isObject(value)) return fallback;
  const providers = parseProviders(value.providers);
  return {
    provider:
      typeof value.provider === 'string' && value.provider.trim()
        ? providerId(value.provider)
        : fallback.provider,
    ...(providers && providers.length > 0 ? { providers } : {}),
    model: typeof value.model === 'string' && value.model ? value.model : fallback.model,
    chrome: value.chrome === true,
  };
}

function intersectProviders(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.filter((id) => b.includes(id));
}

function intersectModels(
  a: Record<string, string[]>,
  b: Record<string, string[]>
): Record<string, string[]> {
  const merged: Record<string, string[]> = { ...a };
  for (const [id, models] of Object.entries(b)) {
    merged[id] = merged[id] ? merged[id].filter((model) => models.includes(model)) : models;
  }
  return merged;
}

/**
 * Two keys that name one project (`/a` and `/a/`) merge to the stricter
 * entry (the fixtures' `parseMergeRules`). Two different modes for one
 * provider have no stricter one, so the project then allows nothing.
 */
/** Keys in code-point order, as Rust's `BTreeMap` serialises them. */
function sortedKeys<T>(map: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function sameWeights(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((id) => a[id] === b[id]);
}

function stricterEntry(
  a: SupervisorProjectPolicy,
  b: SupervisorProjectPolicy
): SupervisorProjectPolicy {
  const modesClash = Object.entries(b.permissionMode).some(
    ([id, mode]) => a.permissionMode[id] !== undefined && a.permissionMode[id] !== mode
  );
  return {
    allowed: a.allowed && b.allowed && !modesClash,
    providers: intersectProviders(a.providers, b.providers),
    models: intersectModels(a.models, b.models),
    permissionMode: modesClash ? {} : { ...a.permissionMode, ...b.permissionMode },
    // A hint, not a permission: two spellings that disagree balance nothing.
    providerWeights: sameWeights(a.providerWeights, b.providerWeights) ? a.providerWeights : {},
    allowInteractive: a.allowInteractive && b.allowInteractive,
    maxRunning: Math.min(a.maxRunning, b.maxRunning),
  };
}

/**
 * Reads `supervisor-policy.json` as Rust does. A file-level problem allows
 * nothing at all; a bad project entry drops only that project. Each drop is
 * named in `rejected`, so Settings can say why a project vanished.
 */
export function parseSupervisorPolicy(raw: string | null | undefined): ParsedSupervisorPolicy {
  const refuse = (reason: SupervisorParseReason): ParsedSupervisorPolicy => ({
    policy: emptySupervisorPolicy(),
    rejected: [{ project: null, reason }],
  });
  if (raw === null || raw === undefined) return refuse('file_missing');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse('malformed');
  }
  if (!isObject(parsed)) return refuse('malformed');
  if (parsed.version !== 1) return refuse('unsupported_version');

  const policy = emptySupervisorPolicy();
  policy.supervisor = parseSupervisorBlock(parsed.supervisor);
  if (isLimit(parsed.maxRunningChildren)) policy.maxRunningChildren = parsed.maxRunningChildren;

  const rejected: SupervisorPolicyRejection[] = [];
  if (parsed.projects !== undefined && parsed.projects !== null && !isObject(parsed.projects)) {
    return refuse('malformed');
  }
  if (parsed.skills !== undefined && parsed.skills !== null && !isObject(parsed.skills)) {
    return refuse('malformed');
  }
  if (parsed.tools !== undefined && parsed.tools !== null && !isObject(parsed.tools)) {
    return refuse('malformed');
  }
  const projects = isObject(parsed.projects) ? parsed.projects : {};
  for (const [key, value] of Object.entries(projects)) {
    if (!key.startsWith('/')) {
      rejected.push({ project: key, reason: 'path_not_absolute' });
      continue;
    }
    try {
      const path = normalizeProjectPath(key);
      const entry = parseProjectEntry(value);
      const earlier = policy.projects[path];
      policy.projects[path] = earlier ? stricterEntry(earlier, entry) : entry;
    } catch (error) {
      if (!(error instanceof InvalidEntry)) throw error;
      rejected.push({ project: key, reason: error.reason });
    }
  }
  parseSkills(isObject(parsed.skills) ? parsed.skills : {}, policy, rejected);
  parseTools(isObject(parsed.tools) ? parsed.tools : {}, policy, rejected);
  return { policy, rejected };
}

/** Provider id → the model ids it offers on this machine now, in its own order. */
export type OfferedModels = Record<string, string[]>;

export interface VisibleProvider {
  id: string;
  models: string[];
  /** `null`: the provider's own default, never the launch defaults. */
  permissionMode: string | null;
  /** Its load-balancing weight; `null` where `providerWeights` does not name it. */
  weight: number | null;
}

export interface VisibleProject {
  path: string;
  providers: VisibleProvider[];
  allowInteractive: boolean;
  maxRunning: number;
}

function modelsFor(entry: SupervisorProjectPolicy, provider: string, offered: string[]): string[] {
  const listed = entry.models[provider];
  return listed === undefined ? [...offered] : offered.filter((model) => listed.includes(model));
}

/**
 * What a supervisor is shown: every allowed project, each with the providers
 * that survive the supervisor list, the project's own provider policy and the
 * models actually offered. A project whose providers all fall away stays
 * visible with none, so the prompt can say why nothing runs there.
 */
/**
 * Per provider: its default permission mode and the modes that skip
 * permission prompts. Rust derives `unattended` from the provider config
 * (`ProviderInfo.permissionModes[].unattended`). A provider missing here has
 * no default and nothing unattended.
 */
export type ProviderPermissionModes = Record<
  string,
  { default: string | null; unattended: string[] }
>;

/** `ProviderPermissionModes` from the provider registry, as Settings and the prompt have it. */
export function permissionModesOf(providers: ProviderInfo[]): ProviderPermissionModes {
  return Object.fromEntries(
    providers.map((provider) => [
      provider.id,
      {
        default: provider.defaultPermissionMode || null,
        unattended: provider.permissionModes
          .filter((mode) => mode.unattended)
          .map((mode) => mode.value),
      },
    ])
  );
}

/**
 * Would this provider run in this project without asking? A supervisor's
 * child must never: nobody watches it, so a mode that skips prompts would let
 * it act on its own (the fixtures' `permissionModesRules`).
 */
export function runsUnattended(
  entry: Pick<SupervisorProjectPolicy, 'permissionMode'>,
  provider: string,
  permissionModes: ProviderPermissionModes
): boolean {
  const effective = effectivePermissionMode(entry, provider, permissionModes);
  return effective !== null && (permissionModes[provider]?.unattended ?? []).includes(effective);
}

/** The mode a child of this provider would run under: the policy's, else the provider's default. */
export function effectivePermissionMode(
  entry: Pick<SupervisorProjectPolicy, 'permissionMode'>,
  provider: string,
  permissionModes: ProviderPermissionModes
): string | null {
  return entry.permissionMode[provider] ?? permissionModes[provider]?.default ?? null;
}

export function visibleProjects(
  policy: SupervisorPolicy,
  projectPolicies: Record<string, ProviderPolicy>,
  offeredModels: OfferedModels,
  permissionModes: ProviderPermissionModes = {}
): VisibleProject[] {
  return Object.entries(policy.projects)
    .filter(([, entry]) => entry.allowed)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, entry]) => {
      const projectPolicy = projectPolicies[path] ?? DEFAULT_PROVIDER_POLICY;
      const candidates = entry.providers ?? Object.keys(offeredModels);
      const providers = candidates
        .filter(
          (id) =>
            offeredModels[id] !== undefined &&
            isProviderAllowed(id, projectPolicy) &&
            !runsUnattended(entry, id, permissionModes)
        )
        .map((id) => ({
          id,
          models: modelsFor(entry, id, offeredModels[id]),
          permissionMode: entry.permissionMode[id] ?? null,
          weight: entry.providerWeights[id] ?? null,
        }))
        .filter((provider) => provider.models.length > 0)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return {
        path,
        providers,
        allowInteractive: entry.allowInteractive,
        maxRunning: entry.maxRunning,
      };
    });
}

export interface SupervisorSpawnRequest {
  projectPath: string;
  provider: string;
  model: string;
  headless: boolean;
}

export interface SupervisorSpawnContext {
  projectPolicy: ProviderPolicy;
  offeredModels: OfferedModels;
  /** The calling supervisor's running (or queued) children. */
  running: { total: number; byProject: Record<string, number> };
  /** Absent: no provider has a default mode or an unattended one. */
  permissionModes?: ProviderPermissionModes;
}

export type SupervisorSpawnDecision =
  | { ok: true; permissionMode: string | null }
  | { ok: false; code: 'supervisor_denied'; reason: SupervisorDeniedReason };

/**
 * Would the socket start this child? Checks run in the fixtures' `checkOrder`
 * (read from the file, not copied) and the first that fails is the reason. Rust is the gate; this answers the
 * same question for the UI so it never offers what would be refused.
 */
export function checkSupervisorSpawn(
  policy: SupervisorPolicy,
  request: SupervisorSpawnRequest,
  context: SupervisorSpawnContext
): SupervisorSpawnDecision {
  const path = normalizeProjectPath(request.projectPath);
  const provider = providerId(request.provider);
  const entry = policy.projects[path];
  const offered = context.offeredModels[provider];
  const listedModels = entry?.models[provider];

  // Each check may assume every check before it passed (an entry exists, the
  // provider is installed), which is why the order is part of the contract.
  const fails: Record<SupervisorDeniedReason, () => boolean> = {
    project_not_listed: () => entry === undefined,
    project_not_allowed: () => !entry.allowed,
    provider_not_installed: () => offered === undefined,
    provider_not_allowed: () => entry.providers !== null && !entry.providers.includes(provider),
    provider_denied_by_project: () => !isProviderAllowed(provider, context.projectPolicy),
    provider_has_no_models: () => listedModels !== undefined && listedModels.length === 0,
    model_not_allowed: () => listedModels !== undefined && !listedModels.includes(request.model),
    model_not_offered: () => !offered.includes(request.model),
    permission_mode_unattended: () =>
      runsUnattended(entry, provider, context.permissionModes ?? {}),
    interactive_not_allowed: () => !request.headless && !entry.allowInteractive,
    project_limit_reached: () => (context.running.byProject[path] ?? 0) >= entry.maxRunning,
    global_limit_reached: () => context.running.total >= policy.maxRunningChildren,
  };
  const failed = CHECK_ORDER.find((reason) => fails[reason]());
  if (failed) return { ok: false, code: 'supervisor_denied', reason: failed };
  return { ok: true, permissionMode: entry.permissionMode[provider] ?? null };
}
