import { z } from 'zod';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { GridCells } from './terminalGrid';
import fixtures from './agentWindow.fixtures.json';

/**
 * The detached agent window, TypeScript half (`docs/design-agent-window.md`).
 *
 * `agentWindow.fixtures.json` is the single source of truth; Rust reads the
 * same file for the window label, the commands and the events it emits. Every
 * message that crosses a window boundary goes through `parseWindowMessage`, so
 * a drift between the two windows — or between a window and Rust — surfaces as
 * an `AgentWindowContractError` naming the message and the field.
 */

export const AGENT_WINDOW_LABELS: Readonly<{ main: string; agents: string }> = {
  main: fixtures.windows.main,
  agents: fixtures.windows.agents,
};

export const AGENT_WINDOW_COMMANDS: Readonly<{ open: string; focus: string; focusMain: string }> =
  fixtures.commands;

/** Global broadcasts from Rust; both windows listen. */
export const AGENT_WINDOW_RUST_EVENTS: Readonly<{
  agentOutput: string;
  ptyResized: string;
  windowState: string;
}> = {
  agentOutput: fixtures.rustEvents.agentOutput,
  ptyResized: fixtures.rustEvents.ptyResized,
  windowState: fixtures.rustEvents.windowState,
};

/** Main window → agent window. */
export const AGENT_WINDOW_HOST_EVENTS: Readonly<{
  hostReady: string;
  welcome: string;
  roster: string;
  snapshot: string;
  show: string;
}> = {
  hostReady: fixtures.hostEvents.hostReady,
  welcome: fixtures.hostEvents.welcome,
  roster: fixtures.hostEvents.roster,
  snapshot: fixtures.hostEvents.snapshot,
  show: fixtures.hostEvents.show,
};

/** Agent window → main window. */
export const AGENT_WINDOW_CLIENT_EVENTS: Readonly<{
  hello: string;
  snapshotRequest: string;
  action: string;
}> = {
  hello: fixtures.clientEvents.hello,
  snapshotRequest: fixtures.clientEvents.snapshotRequest,
  action: fixtures.clientEvents.action,
};

/** The geometry every agent PTY opens at, before any view has fitted it. */
export const DEFAULT_PTY_SIZE: Readonly<{ rows: number; cols: number }> = fixtures.defaultPtySize;

/** How often the main window re-sends the roster at most. */
export const ROSTER_THROTTLE_MS: number = fixtures.rosterThrottleMs;

/** How long the agent window waits for one snapshot before it asks for the next agent's. */
export const SNAPSHOT_TIMEOUT_MS: number = fixtures.snapshotTimeoutMs;

// ── Shapes ──────────────────────────────────────────────────────────────────

const agentId = z.string().min(1, 'agentId must not be empty');
const offset = z.number().int().nonnegative();
const dimension = z.number().int().positive();

/**
 * Only the fields a terminal tab cannot do without are checked; the rest of
 * `AgentInfo` passes through, so a field added to it does not need a contract
 * change to reach the second window.
 */
const agentInfo = z.looseObject({
  id: agentId,
  name: z.string(),
  status: z.enum(['running', 'idle', 'queued', 'error']),
  model: z.string(),
  provider: z.string(),
  startedAt: z.number(),
});

const gridCells = z.tuple([agentId, agentId, agentId, agentId]).nullable();

const rosterShape = {
  agents: z.array(agentInfo),
  /** Last error line per failed agent, derived where the full log lives. */
  errorDigests: z.record(z.string(), z.string()),
};

const schemas = {
  agentOutput: z.object({
    agentId,
    stream: z.enum(['stdout', 'stderr']),
    line: z.string(),
    timestamp: z.number(),
    repoPath: z.string().nullish(),
    /** Raw bytes this agent has emitted up to and including this batch. */
    endOffset: offset,
  }),
  ptyResized: z.object({ agentId, rows: dimension, cols: dimension }),
  windowState: z.object({ open: z.boolean() }),
  welcome: z.object({
    ...rosterShape,
    activeAgentId: agentId.nullable(),
    gridCells,
  }),
  roster: z.object(rosterShape),
  snapshotRequest: z.object({ agentId }),
  snapshot: z.object({
    agentId,
    /** Serialized screen, writable into a fresh terminal of `rows` × `cols`. */
    data: z.string(),
    rows: dimension,
    cols: dimension,
    /** The screen holds every batch up to this offset and none after it. */
    endOffset: offset,
  }),
  show: z.object({ agentId }),
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('kill'), agentId }),
    z.object({ kind: z.literal('dismiss'), agentId }),
    z.object({ kind: z.literal('save-scratch'), agentName: z.string(), screen: z.string() }),
    z.object({ kind: z.literal('dock'), activeAgentId: agentId.nullable(), gridCells }),
  ]),
} as const;

export type AgentWindowMessageKind = keyof typeof schemas;

interface Roster {
  agents: AgentInfo[];
  errorDigests: Record<string, string>;
}

export interface AgentWindowMessages {
  agentOutput: z.infer<typeof schemas.agentOutput>;
  ptyResized: z.infer<typeof schemas.ptyResized>;
  windowState: z.infer<typeof schemas.windowState>;
  welcome: Roster & { activeAgentId: string | null; gridCells: GridCells | null };
  roster: Roster;
  snapshotRequest: z.infer<typeof schemas.snapshotRequest>;
  snapshot: z.infer<typeof schemas.snapshot>;
  show: z.infer<typeof schemas.show>;
  action:
    | { kind: 'kill'; agentId: string }
    | { kind: 'dismiss'; agentId: string }
    | { kind: 'save-scratch'; agentName: string; screen: string }
    | { kind: 'dock'; activeAgentId: string | null; gridCells: GridCells | null };
}

export type AgentWindowAction = AgentWindowMessages['action'];

export class AgentWindowContractError extends Error {
  constructor(
    readonly kind: AgentWindowMessageKind,
    readonly field: string,
    detail: string
  ) {
    super(`agent window: ${kind}.${field || '(root)'} ${detail}`);
    this.name = 'AgentWindowContractError';
  }
}

/** Validate a payload received from the other window or from Rust. */
export function parseWindowMessage<K extends AgentWindowMessageKind>(
  kind: K,
  raw: unknown
): AgentWindowMessages[K] {
  const result = schemas[kind].safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AgentWindowContractError(kind, issue.path.join('.'), issue.message);
  }
  return result.data as AgentWindowMessages[K];
}
