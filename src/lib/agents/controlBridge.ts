import { z } from 'zod';
import { buildSpawnConfig, NotificationActionError } from '@/lib/notifications/execute';
import type { NotificationAction } from '@/lib/notifications/types';
import type { AgentConfig, AgentInfo, PermissionMode } from '@/lib/tauri/agents';
import { isDir } from '@/lib/tauri/fs';
import { invoke } from '@/lib/tauri/invoke';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { subscribeToTauriEvent } from '@/lib/tauri/subscribe';
import {
  CONTROL_EVENTS,
  ControlError,
  parseControlParams,
  RUN_SOURCES,
  SPAWN_REFUSALS,
  type ControlErrorCode,
  type ControlParams,
} from './agentControl.contract';
import { isFinishedAgent } from './fleet';
import { deriveAgentName } from './naming';
import type { LinkedSupervisorLaunch, LinkedSupervisorSpawn } from '@/lib/store/agent/agentTypes';

/** The control request the supervisor link sends for `supervisors.spawn`. */
export const SPAWN_SUPERVISOR_METHOD = 'spawn_supervisor';

const linkedSupervisorParams = z
  .object({
    task: z.string().nullish(),
    provider: z.string().min(1).nullish(),
    model: z.string().min(1).nullish(),
  })
  .strict();

/**
 * The frontend end of the agent-control socket (`docs/design-agent-control.md`).
 *
 * Rust answers list/read/send itself, but spawn, kill and dismiss have
 * bookkeeping only the store owns (launch defaults, spawn configs for Retry,
 * ticket and goal side effects, the card list), so Rust hands them over as
 * `control-request` and waits for `control_respond`. All go through the exact
 * store actions the UI uses.
 */

export interface ControlRequestEvent {
  reqId: string;
  /** `spawn_supervisor` comes from the supervisor link, the rest from `control.sock`. */
  method: 'spawn' | 'kill' | 'dismiss' | typeof SPAWN_SUPERVISOR_METHOD;
  params: unknown;
  /** Ms since epoch: when Rust stops waiting and answers `frontend_unavailable`. */
  expiresAt: number;
}

interface AgentInputSentEvent {
  agentId: string;
  text: string;
}

/** The slice of the store the bridge acts through. */
export interface ControlHost {
  agents: AgentInfo[];
  providers: ProviderInfo[];
  killRunningAgent: (agentId: string) => Promise<void>;
  dismissFinishedAgent: (agentId: string) => void;
  spawnNewAgent: (config: AgentConfig) => Promise<AgentInfo>;
  spawnLinkedSupervisor?: (launch: LinkedSupervisorLaunch) => Promise<LinkedSupervisorSpawn>;
  recordAgentSentMessage: (agentId: string, text: string) => void;
  showToast?: (message: string, variant?: 'info' | 'success' | 'error') => number;
}

async function killFromControl(params: ControlParams<'kill'>, host: ControlHost) {
  const target = host.agents.find((entry) => entry.id === params.agentId);
  if (!target) {
    throw new ControlError('unknown_agent', `no agent with id '${params.agentId}'`);
  }
  // The store action itself never asks; the confirm lives in the UI buttons,
  // and a remote kill has no one at the screen to answer it.
  await host.killRunningAgent(params.agentId);
  host.showToast?.(`${target.name} stopped by an MCP client`, 'info');
  return { agentId: params.agentId, killed: true as const };
}

/**
 * Rust has checked the agent is not running; the store checks again, because
 * the card is what a person sees. An agent whose card is already gone (the
 * human cleared it) is dismissed all the same: the caller's goal holds.
 */
function dismissFromControl(params: ControlParams<'dismiss'>, host: ControlHost) {
  const target = host.agents.find((entry) => entry.id === params.agentId);
  if (target && !isFinishedAgent(target)) {
    throw new ControlError('invalid_params', `${target.name} is still running`);
  }
  if (target) host.dismissFinishedAgent(params.agentId);
  return { agentId: params.agentId, dismissed: true as const };
}

/**
 * The launch config a custom-agent notification would build: runs in
 * `projectPath` without opening it, defaults from the launch last made in that
 * folder, explicit params on top. The socket's client is the user's own tool,
 * so its permission mode and headless choice are honoured like a user-written
 * reminder's.
 */
function spawnConfigFor(params: ControlParams<'spawn'>, providers: ProviderInfo[]): AgentConfig {
  const action: Extract<NotificationAction, { kind: 'spawn-agent' }> = {
    id: 'control-spawn',
    label: 'Start agent',
    kind: 'spawn-agent',
    task: params.prompt,
    repoPath: params.projectPath,
    provider: params.provider ?? undefined,
    model: params.model ?? undefined,
    permissionMode: (params.permissionMode ?? undefined) as PermissionMode | undefined,
    headless: params.headless ?? undefined,
  };
  try {
    const config = buildSpawnConfig(action, {
      trust: 'user',
      providers: providers.length > 0 ? providers : undefined,
    });
    return params.name ? { ...config, name: params.name } : config;
  } catch (error) {
    if (error instanceof NotificationActionError) {
      throw new ControlError('invalid_params', error.message);
    }
    throw error;
  }
}

/**
 * What Rust adds to a spawn it hands over, beyond the socket's own params: for
 * a supervisor's child the supervisor's id and `runSource: "supervisor"` (the
 * dispatcher sets both; a caller cannot). Absent for every other spawn.
 */
const spawnProvenance = z.object({
  spawnedByAgentId: z.string().min(1).nullish(),
  runSource: z.enum(RUN_SOURCES).exclude(['other']).nullish(),
});

type SpawnRequest = ControlParams<'spawn'> & z.output<typeof spawnProvenance>;

function parseSpawnRequest(raw: unknown): SpawnRequest {
  const params = parseControlParams('spawn', raw);
  const provenance = spawnProvenance.safeParse(raw ?? {});
  if (!provenance.success) {
    throw new ControlError('invalid_params', `spawn: ${provenance.error.issues[0].message}`);
  }
  return { ...params, ...provenance.data };
}

const SUPERVISOR_PROVIDER = 'claude';

/**
 * A supervisor, a supervisor's child, or a supervisor link job's agent
 * (`runSource: "supervisor"` without a supervisor id, which only Rust sets):
 * what Rust decided is what runs.
 */
function isVerbatimSpawn(request: SpawnRequest): boolean {
  return (
    Boolean(request.spawnedByAgentId) ||
    request.role === 'supervisor' ||
    request.runSource === 'supervisor'
  );
}

/**
 * The launch config for a supervisor spawn, without the launch-default
 * fill-in `spawnConfigFor` does. For a child, Rust has already checked
 * provider, model and permission mode against the supervisor policy; filling a
 * gap from whatever was last launched in that folder would run something the
 * policy never saw. A `null` permission mode stays the provider's own default.
 */
// code-gate: complexity-cyclomatic - one `??` per launch field, each with the same "nothing filled in for a child" rule
function verbatimSpawnConfig(request: SpawnRequest, providers: ProviderInfo[]): AgentConfig {
  const child = Boolean(request.spawnedByAgentId) || request.role !== 'supervisor';
  // A supervisor itself runs on Claude in v1 (ADR 0004), at that provider's
  // own default model unless the caller named one. A child gets nothing.
  const providerId = request.provider ?? (child ? null : SUPERVISOR_PROVIDER);
  const provider = providers.find((entry) => entry.id === providerId);
  const model = request.model ?? (child ? null : provider?.defaultModel);
  if (!providerId || !model) {
    throw new ControlError(
      'invalid_params',
      "a supervisor's child names its provider and model; nothing is filled in"
    );
  }
  const folder = request.projectPath.split('/').filter(Boolean).pop();
  return {
    name: request.name ?? deriveAgentName(request.prompt, folder),
    model,
    task: request.prompt,
    projectPath: request.projectPath,
    cwd: request.projectPath,
    provider: providerId,
    permissionMode: (request.permissionMode ?? undefined) as PermissionMode | undefined,
    headless: request.headless ?? false,
    runSource: request.runSource ?? (request.spawnedByAgentId ? 'supervisor' : 'mcp'),
    role: request.role ?? 'worker',
    spawnedByAgentId: request.spawnedByAgentId ?? null,
  };
}

/**
 * Appended to the task of an agent started in a worktree. Said by the IDE, not
 * left to whoever asked for the spawn: uncommitted work cannot be told apart
 * from leftovers, and `remove_worktree` keeps a worktree that holds any, so a
 * child that never commits leaves its caller nothing to clean up or hand over.
 */
export const WORKTREE_CHILD_NOTE =
  'You work in a git worktree of your own, on its own branch. Commit all your work on that ' +
  'branch before you finish. Do not merge it and do not remove the worktree: whoever started ' +
  'you takes care of that.';

function inWorktree(config: AgentConfig, worktree: boolean | null): AgentConfig {
  if (!worktree) return config;
  return {
    ...config,
    task: `${config.task}\n\n${WORKTREE_CHILD_NOTE}`,
    historyPrompt: config.historyPrompt ?? config.task,
    useWorktree: true,
  };
}

function spawnFailureCode(message: string): ControlErrorCode {
  return SPAWN_REFUSALS.find(({ pattern }) => message.includes(pattern))?.code ?? 'internal';
}

async function spawnFromControl(params: SpawnRequest, host: ControlHost) {
  if (!(await isDir(params.projectPath))) {
    throw new ControlError(
      'invalid_params',
      `projectPath is not an existing directory: ${params.projectPath}`
    );
  }
  const config = inWorktree(
    isVerbatimSpawn(params)
      ? verbatimSpawnConfig(params, host.providers)
      : spawnConfigFor(params, host.providers),
    params.worktree
  );
  let spawned: AgentInfo;
  try {
    spawned = await host.spawnNewAgent(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ControlError(spawnFailureCode(message), message);
  }
  // Not selected: nobody clicked, and the user may be looking at something else.
  host.showToast?.(`${spawned.name} started by ${starterName(params, host)}`, 'success');
  return { agentId: spawned.id };
}

function starterName(params: SpawnRequest, host: ControlHost): string {
  if (!params.spawnedByAgentId) {
    return params.runSource === 'supervisor' ? 'a supervisor link job' : 'an MCP client';
  }
  const supervisor = host.agents.find((entry) => entry.id === params.spawnedByAgentId);
  return supervisor?.name ?? 'a supervisor';
}

/**
 * `supervisors.spawn` over the supervisor link (`docs/design-supervisor-link.md`).
 * The codes are the link's own; Rust passes them on unchanged.
 */
async function spawnSupervisorFromLink(raw: unknown, host: ControlHost) {
  const parsed = linkedSupervisorParams.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new ControlError(
      'invalid_params',
      `supervisors.spawn: ${parsed.error.issues[0].message}`
    );
  }
  if (!host.spawnLinkedSupervisor) {
    throw new ControlError('internal', 'this window cannot start supervisors');
  }
  const outcome = await host.spawnLinkedSupervisor(parsed.data);
  if (outcome.kind === 'nothing-visible') {
    throw new LinkSpawnRefusal(
      'supervisor_unavailable',
      'the supervisor policy allows no project yet; allow one in Settings → Supervisor'
    );
  }
  if (outcome.kind === 'provider-not-allowed') {
    throw new ControlError(
      'invalid_params',
      `provider '${outcome.provider}' is not one the supervisor policy lists ` +
        `(${outcome.allowed.join(', ') || 'none'})`
    );
  }
  if (outcome.kind === 'provider-unsupported') {
    throw new LinkSpawnRefusal(
      'provider_unsupported',
      `the supervisor cannot run on '${outcome.provider}' in this version ` +
        `(supported: ${outcome.supported.join(', ')})`
    );
  }
  host.showToast?.(`${outcome.agent.name} started over the supervisor link`, 'success');
  return { agentId: outcome.agent.id };
}

/** A refusal with a code only the supervisor link knows. */
class LinkSpawnRefusal extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function respond(
  reqId: string,
  outcome: { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } }
) {
  try {
    await invoke(CONTROL_EVENTS.respondCommand, { reqId, ...outcome });
  } catch (error) {
    // Rust gave up waiting (and answered frontend_unavailable) or there is no
    // backend at all; either way nobody is left to tell.
    console.warn(`[control] could not answer ${reqId}: ${String(error)}`);
  }
}

function answerControlRequest(event: ControlRequestEvent, host: ControlHost) {
  if (event.method === SPAWN_SUPERVISOR_METHOD) {
    return spawnSupervisorFromLink(event.params, host);
  }
  if (event.method === 'dismiss') {
    return dismissFromControl(parseControlParams('dismiss', event.params), host);
  }
  return event.method === 'kill'
    ? killFromControl(parseControlParams('kill', event.params), host)
    : spawnFromControl(parseSpawnRequest(event.params), host);
}

export async function handleControlRequest(
  event: ControlRequestEvent,
  host: ControlHost,
  now: () => number = Date.now
): Promise<void> {
  // Rust has already told the caller `frontend_unavailable`; acting now would
  // hand a retrying caller a second agent.
  if (now() > event.expiresAt) {
    await respond(event.reqId, {
      ok: false,
      error: { code: 'frontend_unavailable', message: `request ${event.reqId} arrived too late` },
    });
    return;
  }
  try {
    const result = await answerControlRequest(event, host);
    await respond(event.reqId, { ok: true, result });
  } catch (error) {
    const failure =
      error instanceof ControlError || error instanceof LinkSpawnRefusal
        ? { code: error.code, message: error.message }
        : { code: 'internal', message: error instanceof Error ? error.message : String(error) };
    await respond(event.reqId, { ok: false, error: failure });
  }
}

/**
 * Listens for the two control events for as long as the IDE is mounted, and
 * tells Rust once both listeners are in place: until then it holds spawn and
 * kill requests, because an event emitted before anyone listens is lost.
 * `control_ready` is idempotent, so a remount simply reports again.
 * `getHost` is read per event, so every request sees the current store.
 */
export function installControlBridge(getHost: () => ControlHost): () => void {
  let listening = 0;
  const reportReady = () => {
    listening += 1;
    if (listening < 2) return;
    invoke(CONTROL_EVENTS.readyCommand).catch((error: unknown) => {
      console.warn(`[control] could not report ready: ${String(error)}`);
    });
  };
  const stopRequests = subscribeToTauriEvent<ControlRequestEvent>(
    CONTROL_EVENTS.controlRequest,
    (event) => void handleControlRequest(event, getHost()),
    'Control requests unavailable (not in Tauri)',
    reportReady
  );
  // Input typed through the socket reaches the PTY in Rust; this only puts it
  // in the feed, exactly as the composer's own sends are recorded.
  const stopInput = subscribeToTauriEvent<AgentInputSentEvent>(
    CONTROL_EVENTS.agentInputSent,
    ({ agentId, text }) => getHost().recordAgentSentMessage(agentId, text),
    'Agent input events unavailable (not in Tauri)',
    reportReady
  );
  return () => {
    stopRequests();
    stopInput();
  };
}
