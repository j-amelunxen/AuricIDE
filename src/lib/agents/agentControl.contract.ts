import { z } from 'zod';
import fixtures from './agentControl.fixtures.json';
import policyFixtures from '../config/supervisorPolicy.fixtures.json';
import linkFixtures from './supervisorLink.fixtures.json';

/**
 * The agent-control socket protocol, TypeScript half (`docs/design-agent-control.md`).
 *
 * `agentControl.fixtures.json` is the single source of truth; the Rust socket
 * (`src-tauri/src/control_socket`) and this file are both tested against it.
 * The client builds its requests through `buildControlRequest` and validates
 * every answer through `parseControlResponse`, so a drift between the two
 * sides surfaces here as a `contract_violation` naming the field, not as a
 * vague failure further down.
 */

export const CONTROL_METHODS = [
  'list_agents',
  'read_output',
  'send_input',
  'kill',
  'spawn',
  'list_projects',
  'await_result',
  'remove_worktree',
  'dismiss',
  'link_policy_get',
  'link_policy_propose',
] as const;
export type ControlMethod = (typeof CONTROL_METHODS)[number];

/** Codes the socket itself answers with. */
export const CONTROL_ERROR_CODES = [
  'invalid_request',
  'unknown_method',
  'invalid_params',
  'unknown_agent',
  'agent_not_running',
  'headless_no_stdin',
  'provider_denied',
  'frontend_unavailable',
  'forbidden_agent_caller',
  'supervisor_denied',
  'outside_supervisor_scope',
  'unknown_project',
  'internal',
] as const;
export type ControlErrorCode = (typeof CONTROL_ERROR_CODES)[number];

/**
 * Codes only the client produces: no socket to talk to, no answer in time, or
 * an answer that does not match the contract.
 */
export const CLIENT_ERROR_CODES = ['app_not_running', 'timeout', 'contract_violation'] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

export const CONTROL_LIMITS = {
  defaultTailBytes: 16384,
  maxTailBytes: 262144,
  frontendTimeoutMs: 30000,
  defaultAwaitSeconds: 60,
  maxAwaitSeconds: 120,
  /** How much longer than `waitSeconds` the client waits before it reports `timeout`. */
  awaitClientGraceSeconds: 5,
  /** Silence after which `await_result` with `untilInput` reads an agent as waiting. */
  inputQuietSeconds: 20,
} as const;

/**
 * What an agent is to the socket. A `supervisor` may steer its own children
 * (ADR 0004); every other IDE agent is a `worker` and is refused at the socket.
 */
export const AGENT_ROLES = ['worker', 'supervisor'] as const;

/** Who started a run, as booked with its usage row (`docs/design-agent-usage.md`). */
export const RUN_SOURCES = ['ui', 'conductor', 'schedule', 'mcp', 'supervisor', 'other'] as const;

/** Where a finished run's `answer` came from. */
export const RUN_RESULT_SOURCES = ['cli_result', 'console_tail'] as const;

/**
 * The stable keys a `supervisor_denied` refusal names in `error.reason`
 * (`supervisorPolicy.fixtures.json`, `reasons.checkSpawn` and
 * `reasons.modelChoice`).
 */
export const SUPERVISOR_DENIED_REASONS = [
  ...Object.keys(policyFixtures.reasons.checkSpawn),
  ...Object.keys(policyFixtures.reasons.modelChoice),
].filter((key) => key !== '_comment');

/**
 * Set on every agent process the IDE spawns, and so inherited by any MCP
 * server that agent starts. `auric-mcp --control` refuses to start under it.
 */
export const IDE_AGENT_MARKER: string = fixtures.environment.ideAgentMarker;

/** The Tauri event and command names the frontend bridge speaks. */
export const CONTROL_EVENTS: Readonly<{
  controlRequest: string;
  agentInputSent: string;
  respondCommand: string;
  readyCommand: string;
}> = fixtures.events;

/**
 * How a failed spawn maps onto a code, by the sentence Rust's
 * `resolve_permitted_provider` writes. Matched in order; no match is `internal`.
 */
export const SPAWN_REFUSALS: readonly { code: ControlErrorCode; pattern: string }[] =
  fixtures.spawnRefusals.map(({ code, pattern }) => ({
    code: code as ControlErrorCode,
    pattern,
  }));

export class ControlError extends Error {
  constructor(
    readonly code: ControlErrorCode | ClientErrorCode,
    message: string,
    /** The stable reason key of a `supervisor_denied` refusal. */
    readonly reason?: string
  ) {
    super(message);
    this.name = 'ControlError';
  }
}

// ── Requests ────────────────────────────────────────────────────────────────

const agentId = z.string().min(1, 'agentId must not be empty');
const offset = z.number().int().nonnegative();
const optionalText = z.string().nullish();

const noParams = z.object({}).transform(() => ({}));

/** The changes `link_policy_propose` knows (`supervisorLink.fixtures.json`, `proposals.ops`). */
export const LINK_POLICY_OPS = linkFixtures.proposals.ops as [string, ...string[]];

const PARAMS = {
  list_agents: noParams,
  list_projects: z
    .object({ project: z.string().nullish() })
    .refine((p) => p.project === null || p.project === undefined || p.project.trim() !== '', {
      message: 'project must not be empty; leave it out to list every project',
      path: ['project'],
    })
    .transform((p) => (p.project ? { project: p.project } : {})),
  read_output: z
    .object({
      agentId,
      tailBytes: offset.nullish(),
      sinceOffset: offset.nullish(),
    })
    .transform((p) => ({
      agentId: p.agentId,
      tailBytes: Math.min(
        p.tailBytes ?? CONTROL_LIMITS.defaultTailBytes,
        CONTROL_LIMITS.maxTailBytes
      ),
      sinceOffset: p.sinceOffset ?? null,
    })),
  send_input: z
    .object({ agentId, text: z.string(), enter: z.boolean().nullish() })
    .transform((p) => ({ agentId: p.agentId, text: p.text, enter: p.enter ?? true }))
    .refine((p) => p.text !== '' || p.enter, {
      message: 'empty text with enter: false writes nothing',
      path: ['text'],
    }),
  kill: z.object({ agentId }).transform((p) => ({ agentId: p.agentId })),
  spawn: z
    .object({
      projectPath: z.string().min(1, 'projectPath must not be empty'),
      prompt: z.string().trim().min(1, 'prompt must not be empty'),
      provider: optionalText,
      model: optionalText,
      permissionMode: optionalText,
      headless: z.boolean().nullish(),
      name: optionalText,
      role: z.enum(AGENT_ROLES).nullish(),
      worktree: z.boolean().nullish(),
      modelReason: optionalText,
    })
    .transform((p) => ({
      projectPath: p.projectPath,
      prompt: p.prompt,
      provider: p.provider ?? null,
      model: p.model ?? null,
      permissionMode: p.permissionMode ?? null,
      headless: p.headless ?? null,
      name: p.name ?? null,
      // A worker is what every spawn starts anyway; only a supervisor is news.
      role: p.role === 'supervisor' ? ('supervisor' as const) : null,
      worktree: p.worktree ?? null,
      // Left out when unset, as Rust serialises it.
      ...(p.modelReason ? { modelReason: p.modelReason } : {}),
    })),
  await_result: z
    .object({
      agentId,
      waitSeconds: offset.nullish(),
      untilInput: z.boolean().nullish(),
      sinceOffset: offset.nullish(),
    })
    .transform((p) => ({
      agentId: p.agentId,
      waitSeconds: Math.min(
        p.waitSeconds ?? CONTROL_LIMITS.defaultAwaitSeconds,
        CONTROL_LIMITS.maxAwaitSeconds
      ),
      // Left out when unset, as Rust serialises them, so older requests read the same.
      ...(p.untilInput ? { untilInput: true } : {}),
      ...(p.sinceOffset !== null && p.sinceOffset !== undefined
        ? { sinceOffset: p.sinceOffset }
        : {}),
    })),
  remove_worktree: z.object({ agentId }).transform((p) => ({ agentId: p.agentId })),
  dismiss: z.object({ agentId }).transform((p) => ({ agentId: p.agentId })),
  link_policy_get: noParams,
  /**
   * Only the op is checked here; Rust checks every field against the policy
   * rules and answers `invalid_params` naming the change that broke one.
   */
  link_policy_propose: z.object({
    reason: z.string().trim().min(1, 'reason must not be empty'),
    changes: z
      .array(z.object({ op: z.enum(LINK_POLICY_OPS) }).passthrough())
      .min(1, 'changes must hold at least one change')
      .max(linkFixtures.proposals.maxChanges),
  }),
} satisfies Record<ControlMethod, z.ZodType>;

type ControlParamsSchemas = typeof PARAMS;
export type ControlParamsInput<M extends ControlMethod> = z.input<ControlParamsSchemas[M]>;
export type ControlParams<M extends ControlMethod> = z.output<ControlParamsSchemas[M]>;

export type ControlRequestId = string | number;

export interface ControlRequest<M extends ControlMethod = ControlMethod> {
  id: ControlRequestId;
  method: M;
  params: ControlParams<M>;
}

export type ParsedControlRequest =
  | { ok: true; request: ControlRequest }
  | { ok: false; id: ControlRequestId | null; code: ControlErrorCode; message: string };

function isControlMethod(value: string): value is ControlMethod {
  return (CONTROL_METHODS as readonly string[]).includes(value);
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
  return `${path}: ${issue.message}`;
}

/**
 * Reads one request as the socket does, defaults filled in. The client uses
 * it to build what it sends and the test socket to check what it receives.
 */
export function normalizeControlRequest(value: unknown): ParsedControlRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, id: null, code: 'invalid_request', message: 'request is not an object' };
  }
  const envelope = value as { id?: unknown; method?: unknown; params?: unknown };
  const id =
    typeof envelope.id === 'string' || typeof envelope.id === 'number' ? envelope.id : null;
  if (id === null) {
    return { ok: false, id, code: 'invalid_request', message: 'id must be a string or number' };
  }
  if (typeof envelope.method !== 'string') {
    return { ok: false, id, code: 'invalid_request', message: 'method must be a string' };
  }
  if (!isControlMethod(envelope.method)) {
    return {
      ok: false,
      id,
      code: 'unknown_method',
      message: `unknown method '${envelope.method}'`,
    };
  }
  try {
    const params = parseControlParams(envelope.method, envelope.params);
    return { ok: true, request: { id, method: envelope.method, params } };
  } catch (error) {
    return { ok: false, id, code: 'invalid_params', message: (error as ControlError).message };
  }
}

export function parseControlRequestLine(line: string): ParsedControlRequest {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, id: null, code: 'invalid_request', message: 'request is not valid JSON' };
  }
  return normalizeControlRequest(value);
}

/** The request the socket will read, or `invalid_params` before anything is sent. */
export function buildControlRequest<M extends ControlMethod>(
  id: ControlRequestId,
  method: M,
  params: ControlParamsInput<M>
): ControlRequest<M> {
  const parsed = normalizeControlRequest({ id, method, params });
  if (!parsed.ok) throw new ControlError(parsed.code, parsed.message);
  return parsed.request as ControlRequest<M>;
}

/** The params of one method with defaults filled in, or `invalid_params`. */
export function parseControlParams<M extends ControlMethod>(
  method: M,
  params: unknown
): ControlParams<M> {
  const parsed = PARAMS[method].safeParse(params ?? {});
  if (!parsed.success) {
    throw new ControlError(
      'invalid_params',
      `${method}: ${parsed.error.issues.map(describeIssue).join('; ')}`
    );
  }
  return parsed.data as ControlParams<M>;
}

// ── Responses ───────────────────────────────────────────────────────────────

const agentStatus = z.enum(['running', 'idle', 'queued', 'error']);

const agentSummary = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  provider: z.string(),
  status: agentStatus,
  currentTask: z.string().nullable(),
  startedAt: z.number(),
  lastActivityAt: z.number().nullable(),
  projectPath: z.string().nullable(),
  repoPath: z.string().nullable(),
  spawnedByTicketId: z.string().nullable(),
  spawnedByGoalId: z.string().nullable(),
  headless: z.boolean(),
  outputBytes: offset,
  role: z.enum(AGENT_ROLES),
  spawnedByAgentId: z.string().nullable(),
});

/** What a supervisor may use in one project; only a supervisor's `list_projects` carries it. */
const supervisorProjectBlock = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      /** Absent (or null from an older IDE): the provider's own default. */
      permissionMode: z.string().nullish(),
      /** `"all"`: every model the catalog lists for this provider. */
      models: z.union([z.literal('all'), z.array(z.string())]),
    })
  ),
  allowInteractive: z.boolean(),
  runningChildren: offset,
  maxRunning: offset,
  /** Load balancing (`providerWeights`), advisory; `null` when the project has none. */
  balancing: z
    .object({
      windowDays: offset,
      next: z.string().nullable(),
      providers: z.array(
        z.object({
          id: z.string(),
          weight: offset,
          spawns: offset,
          targetPercent: offset,
          actualPercent: offset.nullable(),
        })
      ),
    })
    .nullable(),
});

/** One model of a supervisor's `list_projects` catalog, described once. */
const catalogModel = z.object({
  id: z.string(),
  label: z.string(),
  rank: z.number().int().nullable(),
  useFor: z.string().optional(),
  relativeCost: z.number().positive().optional(),
});

const runResult = z.object({
  agentId: z.string(),
  status: z.enum(['idle', 'error']),
  exitCode: z.number().int().nullable(),
  answer: z.string().nullable(),
  isError: z.boolean(),
  source: z.enum(RUN_RESULT_SOURCES),
  finishedAt: z.number(),
  costUsd: z.number().nullable(),
});

const linkJobLimits = z.object({ dailyLimit: offset, perProjectDailyLimit: offset.nullable() });
const linkOrigin = z.enum(['global', 'project', 'override']);

const RESULTS = {
  list_agents: z.object({ agents: z.array(agentSummary) }),
  read_output: z.object({
    agentId: z.string(),
    status: agentStatus,
    text: z.string(),
    startOffset: offset,
    endOffset: offset,
    truncated: z.boolean(),
  }),
  send_input: z.object({ agentId: z.string(), bytesWritten: offset }),
  kill: z.object({ agentId: z.string(), killed: z.literal(true) }),
  dismiss: z.object({ agentId: z.string(), dismissed: z.literal(true) }),
  spawn: z.object({ agentId: z.string() }),
  list_projects: z.object({
    projects: z.array(
      z.object({
        path: z.string(),
        name: z.string(),
        starred: z.boolean(),
        isOpen: z.boolean(),
        initialized: z.boolean(),
        lastOpenedAt: z.number().nullable(),
        runningAgents: offset,
        description: z.string().nullable(),
        descriptionSource: z.enum(['user', 'readme', 'package', 'cargo']).nullable(),
        supervisor: supervisorProjectBlock.optional(),
      })
    ),
    /** Only a supervisor's answer carries it: provider id → the models its projects allow. */
    catalog: z.record(z.string(), z.array(catalogModel)).optional(),
  }),
  await_result: z.discriminatedUnion('done', [
    z.object({
      done: z.literal(false),
      agentId: z.string(),
      status: agentStatus,
      outputBytes: offset,
      /** Only `untilInput` sets it; an IDE from before it existed sends nothing. */
      waitingForInput: z.boolean().default(false),
    }),
    z.object({ done: z.literal(true), result: runResult }),
  ]),
  link_policy_get: z.object({
    stored: z.object({
      defaults: z.object({ documentTypes: z.array(z.unknown()), jobKinds: z.array(z.unknown()) }),
      projects: z.record(z.string(), z.unknown()),
      jobs: linkJobLimits,
    }),
    effective: z.object({
      projects: z.record(z.string(), z.unknown()),
      origins: z.record(
        z.string(),
        z.object({
          documentTypes: z.record(z.string(), linkOrigin),
          jobKinds: z.record(z.string(), linkOrigin),
        })
      ),
      projectDailyLimits: z.record(z.string(), offset),
      jobs: linkJobLimits,
    }),
    pending: z.array(
      z.object({ id: z.string(), reason: z.string(), diff: z.array(z.string()), expiresAt: offset })
    ),
  }),
  /** `pending` always: proposing applies nothing; a person decides in the IDE. */
  link_policy_propose: z.object({
    proposalId: z.string(),
    status: z.literal('pending'),
    expiresAt: offset,
    diff: z.array(z.string()),
  }),
  /** `removed: false` is an answer: the worktree holds work and stays for a person. */
  remove_worktree: z.object({
    agentId: z.string(),
    path: z.string(),
    branch: z.string().nullable(),
    sourceRepo: z.string(),
    removed: z.boolean(),
    dirty: z.boolean(),
    branchAhead: z.boolean(),
  }),
} satisfies Record<ControlMethod, z.ZodType>;

export type ControlResult<M extends ControlMethod> = z.output<(typeof RESULTS)[M]>;

const errorBody = z
  .object({
    code: z.enum(CONTROL_ERROR_CODES),
    message: z.string(),
    reason: z.string().optional(),
  })
  .refine(
    (body) =>
      body.code !== 'supervisor_denied' ||
      (body.reason !== undefined && SUPERVISOR_DENIED_REASONS.includes(body.reason)),
    { message: 'supervisor_denied must carry a known reason key', path: ['reason'] }
  );
const responseId = z.union([z.string(), z.number()]).nullable();

interface ControlResponseError {
  code: ControlErrorCode;
  message: string;
  reason?: string;
}

export type ControlResponse<M extends ControlMethod> =
  { ok: true; result: ControlResult<M> } | { ok: false; error: ControlResponseError };

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current = root;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function shown(value: unknown): string {
  if (value === undefined) return 'nothing';
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function violation(method: ControlMethod, path: string, detail: string): ControlError {
  return new ControlError(
    'contract_violation',
    `AuricIDE control contract violation in '${method}' response at ${path}: ${detail}`
  );
}

/**
 * Validates one answer from the socket. Throws a `contract_violation` that
 * names the method, the field, what was expected and what arrived; a
 * well-formed error answer is returned, not thrown, so the caller decides.
 */
export function parseControlResponse<M extends ControlMethod>(
  method: M,
  value: unknown,
  expectedId?: ControlRequestId
): ControlResponse<M> {
  const envelope = z.discriminatedUnion('ok', [
    z.object({ id: responseId, ok: z.literal(true), result: RESULTS[method] }),
    z.object({ id: responseId, ok: z.literal(false), error: errorBody }),
  ]);
  const parsed = envelope.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    throw violation(method, path, `${issue.message} (got ${shown(valueAt(value, issue.path))})`);
  }
  // The union over a method-dependent schema does not narrow on `ok` by itself.
  const response = parsed.data as
    | { id: ControlRequestId | null; ok: true; result: unknown }
    | { id: ControlRequestId | null; ok: false; error: ControlResponseError };
  // An answer to a line the socket could not read carries no id to echo.
  const idMatches =
    expectedId === undefined ||
    response.id === expectedId ||
    (!response.ok && response.id === null);
  if (!idMatches) {
    throw violation(method, 'id', `expected ${shown(expectedId)} (got ${shown(response.id)})`);
  }
  return response.ok
    ? { ok: true, result: response.result as ControlResult<M> }
    : { ok: false, error: response.error };
}
