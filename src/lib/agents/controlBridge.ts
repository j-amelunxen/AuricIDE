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
  SPAWN_REFUSALS,
  type ControlErrorCode,
  type ControlParams,
} from './agentControl.contract';

/**
 * The frontend end of the agent-control socket (`docs/design-agent-control.md`).
 *
 * Rust answers list/read/send itself, but spawn and kill have bookkeeping only
 * the store owns (launch defaults, spawn configs for Retry, ticket and goal
 * side effects), so Rust hands them over as `control-request` and waits for
 * `control_respond`. Both go through the exact store actions the UI uses.
 */

export interface ControlRequestEvent {
  reqId: string;
  method: 'spawn' | 'kill';
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
  spawnNewAgent: (config: AgentConfig) => Promise<AgentInfo>;
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

function spawnFailureCode(message: string): ControlErrorCode {
  return SPAWN_REFUSALS.find(({ pattern }) => message.includes(pattern))?.code ?? 'internal';
}

async function spawnFromControl(params: ControlParams<'spawn'>, host: ControlHost) {
  if (!(await isDir(params.projectPath))) {
    throw new ControlError(
      'invalid_params',
      `projectPath is not an existing directory: ${params.projectPath}`
    );
  }
  const config = spawnConfigFor(params, host.providers);
  let spawned: AgentInfo;
  try {
    spawned = await host.spawnNewAgent(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ControlError(spawnFailureCode(message), message);
  }
  // Not selected: nobody clicked, and the user may be looking at something else.
  host.showToast?.(`${spawned.name} started by an MCP client`, 'success');
  return { agentId: spawned.id };
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
    const result =
      event.method === 'kill'
        ? await killFromControl(parseControlParams('kill', event.params), host)
        : await spawnFromControl(parseControlParams('spawn', event.params), host);
    await respond(event.reqId, { ok: true, result });
  } catch (error) {
    const failure =
      error instanceof ControlError
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
