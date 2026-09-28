import { z } from 'zod';
import fixtures from './agentControl.fixtures.json';

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
} as const;

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
    message: string
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

const PARAMS = {
  list_agents: noParams,
  list_projects: noParams,
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
    })
    .transform((p) => ({
      projectPath: p.projectPath,
      prompt: p.prompt,
      provider: p.provider ?? null,
      model: p.model ?? null,
      permissionMode: p.permissionMode ?? null,
      headless: p.headless ?? null,
      name: p.name ?? null,
    })),
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
});

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
      })
    ),
  }),
} satisfies Record<ControlMethod, z.ZodType>;

export type ControlResult<M extends ControlMethod> = z.output<(typeof RESULTS)[M]>;

const errorBody = z.object({ code: z.enum(CONTROL_ERROR_CODES), message: z.string() });
const responseId = z.union([z.string(), z.number()]).nullable();

interface ControlResponseError {
  code: ControlErrorCode;
  message: string;
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
