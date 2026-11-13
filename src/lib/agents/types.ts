/** What an agent run was for; the backend derives it from the ticket and goal ids when absent. */
export type UsageRunKind = 'ticket' | 'goal' | 'review' | 'other';

/** One agent a supervisor parked on purpose (`mark_waiting`), as Rust keeps it. */
export interface AgentWaiting {
  agentId: string;
  reason: string;
  /** Unix ms at which the mark ends by itself. */
  untilMs: number;
  /** Unix ms at which it was set. */
  markedAtMs: number;
}

/** Every state an agent process is in, as the backend reports it. */
export const AGENT_STATUSES = ['running', 'idle', 'queued', 'error'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export interface AgentInfo {
  id: string;
  name: string;
  status: AgentStatus;
  model: string;
  provider: string;
  /** The instruction the agent was started with — set once, never changes. */
  currentTask?: string;
  /**
   * What the agent is doing right now, distilled from its newest output.
   * Frontend-only: derived in the store as output streams in, so the backend
   * never sends it.
   */
  currentActivity?: string;
  /**
   * True when the newest output looks like a prompt waiting on the user
   * (permission menu, y/n question). Frontend-only, derived alongside
   * `currentActivity`.
   */
  awaitingInput?: boolean;
  startedAt: number;
  lastActivityAt?: number;
  /**
   * When the agent stopped (done or failed). Frontend-only, stamped once on
   * the first stop signal — the review list sorts by it.
   */
  finishedAt?: number;
  /** Immutable logical project whose Auric MCP/PM database this agent uses. */
  projectPath?: string | null;
  /** Execution directory, which may be a worktree below a different path. */
  repoPath?: string;
  spawnedByTicketId?: string;
  spawnedByGoalId?: string;
  /**
   * True when the CLI runs unattended (`claude -p`, `codex exec`). Such a run
   * may print nothing until it ends, so its silence is not read as a stall.
   */
  headless?: boolean;
  /** Set when this agent was spawned to REVIEW a ticket (conductor judge, agent
   * form). Frontend-only provenance, distinct from spawnedByTicketId so a
   * reviewer is never mistaken for the implementer of the ticket. */
  spawnedForReviewOfTicketId?: string;
  /**
   * Set while a supervisor has parked this agent on purpose (`mark_agent_waiting`):
   * no stall chip, no nudge, the card says why. Frontend-only, stamped from Rust's
   * marks (`useAgentWaiting`).
   */
  waiting?: AgentWaiting;
  /**
   * `supervisor`: the one IDE agent the control socket admits, scoped to its
   * own children (ADR 0004). Absent reads as `worker`.
   */
  role?: AgentRole;
  /** The supervisor that started this agent; `null`/absent for everyone else. */
  spawnedByAgentId?: string | null;
  /**
   * A supervisor only: the address a client chose for it
   * (`^[a-z0-9][a-z0-9-]{0,47}$`), unique among live supervisors and kept
   * across a resume of its run. `null`/absent when none was given.
   */
  supervisorKey?: string | null;
  /**
   * Names of the project's extra MCP servers (from its `.mcp.json`, picked in Settings →
   * Supervisor → Projects) this agent started with, besides the built-in ones. Names only.
   */
  extraMcpServers?: string[];
}

/** What an agent is to the control socket (`agentControl.fixtures.json`, `roles`). */
export type AgentRole = 'worker' | 'supervisor';

export type PermissionMode =
  'bypassPermissions' | 'acceptEdits' | 'plan' | 'auto' | 'default' | 'yolo';

export interface AgentConfig {
  name: string;
  model: string;
  task: string;
  /**
   * Logical AuricIDE project whose PM database is exposed to this agent.
   * This is deliberately separate from `cwd`: a worktree changes where the
   * agent edits files, but must never retarget its MCP session. `null` means
   * an explicitly projectless agent.
   */
  projectPath?: string | null;
  cwd?: string;
  /**
   * A supervisor only: an earlier run's folder under `~/.auric/supervisors/`
   * to work in again. Rust refuses anything that is not one run folder.
   */
  resumeRunDir?: string;
  /**
   * A supervisor only: the address to reach it by (`AgentInfo.supervisorKey`).
   * Rust refuses a malformed key, a key a live supervisor already holds, and
   * any key on a worker.
   */
  supervisorKey?: string;
  permissionMode?: PermissionMode;
  dangerouslyIgnorePermissions?: boolean;
  autoAcceptEdits?: boolean;
  provider?: string;
  headless?: boolean;
  spawnedByTicketId?: string;
  spawnedByGoalId?: string;
  /**
   * Who started the run. Kept with the run's usage row (`pm_agent_usage`), and
   * read by the frontend to tell conductor runs from ones a person started.
   */
  runSource?: 'ui' | 'conductor' | 'schedule' | 'mcp' | 'supervisor';
  /** What the run was for; the backend derives it from the ticket and goal ids when absent. */
  runKind?: UsageRunKind;
  /** The ticket a review run judges — its cost is attributed there, not to the implementer. */
  reviewOfTicketId?: string;
  /**
   * The MCP launch request this agent answers. Its start and finish are
   * recorded against it for `get_agent_run`, and the Rust spawn checks the
   * working directory against the folder stored with the request.
   */
  launchRequestUid?: string;
  /**
   * An agent-written notification whose Start button this spawn answers, and
   * the clicked action. The Rust spawn refuses any `cwd` but the folder the
   * MCP server stamped on that action (sub-goal 09).
   */
  agentNotificationUid?: string;
  agentNotificationActionId?: string;
  /**
   * What to remember in the project's prompt history instead of `task`.
   * Frontend-only. A combo step's task carries the previous session's output
   * appended to it; recall is a list of things a person typed, and a terminal
   * tail in there would bury every real entry.
   */
  historyPrompt?: string;
  /** Frontend-only: the ticket this agent was spawned to review. */
  spawnedForReviewOfTicketId?: string;
  /**
   * Frontend-only: create a linked git worktree and run the agent there.
   * Consumed by `spawnNewAgent` before the Rust spawn — the backend never
   * sees this flag.
   */
  useWorktree?: boolean;
  /**
   * Frontend-only: git repo to create the worktree from when `cwd` itself is
   * not a repository (a workspace with nested checkouts or submodules).
   */
  worktreeRepoPath?: string;
  /** See `AgentInfo.role`. A supervisor caller can never set this on a child. */
  role?: AgentRole;
  /** Set by Rust for a supervisor's child; the frontend only passes it through. */
  spawnedByAgentId?: string | null;
}

export interface SupervisorCandidateInfo {
  id: string;
  name: string;
}

export interface SupervisorProviderChoice {
  candidates: SupervisorCandidateInfo[];
  resolve: (providerId: string | null) => void;
}
