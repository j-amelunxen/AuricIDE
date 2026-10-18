import { z } from 'zod';
import { UserError, type FastMCP } from 'fastmcp';
import {
  CONTROL_LIMITS,
  ControlError,
  type ControlMethod,
  type ControlParamsInput,
  type ControlResult,
} from '../../lib/agents/agentControl.contract';
import { callControl } from '../controlClient';

/**
 * The agent-control tools, offered only by `auric-mcp --control`
 * (`docs/design-agent-control.md`). They let a client outside the IDE see and
 * steer the IDE's agent fleet across every project. Agents the IDE spawns run
 * the project server and never get these: typing into a console can answer a
 * permission prompt, and one agent must not approve another's.
 */

export type ControlCaller = <M extends ControlMethod>(
  method: M,
  params: ControlParamsInput<M>
) => Promise<ControlResult<M>>;

/** Calls one socket method; the result as JSON text, a refusal as `<code> (<reason>): <message>`. */
export async function runControl<M extends ControlMethod>(
  call: ControlCaller,
  method: M,
  params: ControlParamsInput<M>
): Promise<string> {
  try {
    return JSON.stringify(await call(method, params), null, 2);
  } catch (error) {
    if (error instanceof ControlError) {
      const code = error.reason ? `${error.code} (${error.reason})` : error.code;
      throw new UserError(`${code}: ${error.message}`);
    }
    throw new UserError(`internal: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const agentIdParam = z
  .string()
  .describe('Agent id as list_agents reports it, e.g. "agent-3"');

/** `read_agent_output`, the same for the control and the supervisor server. */
export function readAgentOutputTool(call: ControlCaller, scopeNote = '') {
  return {
    name: 'read_agent_output',
    description:
      "Read an agent's console output. The text is the terminal output cleaned as it arrived " +
      '(ANSI codes and control characters removed, line endings as \\n), not a transcript: ' +
      'expect tool calls, progress lines, prompts and the repeated fragments of a TUI redrawing ' +
      'itself. Offsets and byte counts refer to this cleaned text. ' +
      `Without sinceOffset it returns the last tailBytes (default ${CONTROL_LIMITS.defaultTailBytes}, ` +
      `max ${CONTROL_LIMITS.maxTailBytes}), and truncated: true means older output exists before ` +
      'it. To follow an agent, poll with sinceOffset set to the previous endOffset; there ' +
      'truncated: true means that offset is no longer buffered and the text starts at the ' +
      'oldest byte still kept, so some output was missed.' +
      scopeNote,
    parameters: z.object({
      agentId: agentIdParam,
      tailBytes: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('How many bytes from the end to return when sinceOffset is absent'),
      sinceOffset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Return only output from this byte offset on (a previous endOffset)'),
    }),
    execute: async (args: ControlParamsInput<'read_output'>) =>
      runControl(call, 'read_output', args),
  };
}

/** `worktree` on `spawn_agent`, the same for the control and the supervisor server. */
export const worktreeParam = z
  .boolean()
  .optional()
  .describe(
    'Run in a git worktree of its own (own folder, own branch) instead of the project folder. ' +
      'Use it for code changes in a repository where others may work at the same time. The ' +
      'agent is told to commit there; you remove the worktree afterwards with remove_worktree.'
  );

/** `remove_worktree`, the same for the control and the supervisor server. */
export function removeWorktreeTool(call: ControlCaller, scopeNote = '') {
  return {
    name: 'remove_worktree',
    description:
      'Clean up the worktree a finished agent ran in (spawned with worktree: true). It is ' +
      'removed, branch included, only when nothing would be lost. With uncommitted changes ' +
      '(dirty) or commits the source branch lacks (branchAhead) it stays and the answer is ' +
      'removed: false — the work waits for a person to merge or discard it in the IDE, so ' +
      'report path and branch instead of retrying. Never merges, never forces. A running ' +
      'agent is refused: await or kill it first. Returns { agentId, path, branch, sourceRepo, ' +
      'removed, dirty, branchAhead }.' +
      scopeNote,
    parameters: z.object({ agentId: agentIdParam }),
    execute: async (args: ControlParamsInput<'remove_worktree'>) =>
      runControl(call, 'remove_worktree', args),
  };
}

/** `dismiss`, the same for the control and the supervisor server. */
export function dismissAgentTool(call: ControlCaller, scopeNote = '') {
  return {
    name: 'dismiss_agent',
    description:
      'Clear a finished agent from the IDE, as its Dismiss button does: its card goes and its ' +
      'kept result is forgotten, so read it with await_agent_result and remove its worktree ' +
      'first. A running or queued agent is refused (invalid_params): this does not stop ' +
      'anything. Returns { agentId, dismissed: true }.' +
      scopeNote,
    parameters: z.object({ agentId: agentIdParam }),
    execute: async (args: ControlParamsInput<'dismiss'>) => runControl(call, 'dismiss', args),
  };
}

/** `await_agent_result`, the same for the control and the supervisor server. */
export function awaitAgentResultTool(call: ControlCaller, scopeNote = '') {
  return {
    name: 'await_agent_result',
    description:
      'Look briefly, do not loop waiting. Wait up to waitSeconds ' +
      `(default ${CONTROL_LIMITS.defaultAwaitSeconds}, max ` +
      `${CONTROL_LIMITS.maxAwaitSeconds}) for an agent to finish. Still running when the wait ` +
      'ends: { done: false, status, outputBytes } — end your turn. Supervisors wait for the ' +
      'IDE finish pingback for headless children; use a background timer for interactive ' +
      'children or as a fallback. Finished (now or earlier): ' +
      '{ done: true, result: { status "idle" | "error", exitCode, answer, isError, source, ' +
      "finishedAt, costUsd } }. answer is the CLI's own final text when source is " +
      '"cli_result" (headless Claude), otherwise the last 8 KiB of the cleaned console ' +
      '("console_tail"). waitSeconds 0 only looks. With untilInput: true it also returns, ' +
      'still running, as soon as an interactive agent waits on an answer — a prompt or ' +
      `permission menu in its console, or ${CONTROL_LIMITS.inputQuietSeconds} s of silence ` +
      'after a turn — with waitingForInput: true. Read its output, then answer or hand the ' +
      'question on. Pass the outputBytes you already read as sinceOffset, so a question you ' +
      'have seen does not wake the next call again.' +
      scopeNote,
    parameters: z.object({
      agentId: agentIdParam,
      waitSeconds: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(`Seconds to wait, at most ${CONTROL_LIMITS.maxAwaitSeconds}`),
      untilInput: z
        .boolean()
        .optional()
        .describe('Also return when the agent waits on an answer (interactive agents only)'),
      sinceOffset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('With untilInput: only output after this offset can wake the call'),
    }),
    execute: async (args: ControlParamsInput<'await_result'>) =>
      runControl(call, 'await_result', args),
  };
}

/** `send_agent_input`, the same for the control and the supervisor server. */
export function sendAgentInputTool(call: ControlCaller, scopeNote = '') {
  return {
    name: 'send_agent_input',
    description:
      "Type into a running agent's console, exactly like the composer in the IDE: the text " +
      "followed by Enter (unless enter is false). This can answer the agent's questions and " +
      'permission prompts — "1", "y" or a menu choice approves whatever the prompt asks, so ' +
      'read the output first. Empty text with enter true is a bare Enter nudge. Headless ' +
      'agents do not read input and refuse it.' +
      scopeNote,
    parameters: z.object({
      agentId: agentIdParam,
      text: z.string().describe('What to type; may be empty for a bare Enter'),
      enter: z.boolean().optional().describe('Press Enter after the text (default true)'),
    }),
    execute: async (args: ControlParamsInput<'send_input'>) => runControl(call, 'send_input', args),
  };
}

export function registerAgentControlTools(
  server: FastMCP,
  call: ControlCaller = callControl
): void {
  server.addTool({
    name: 'list_agents',
    description:
      'List every agent the running AuricIDE knows, across all projects: id, name, provider, ' +
      'model, status (running | idle | queued | error), the task it was started with, its ' +
      'project, whether it runs headless, and outputBytes — the byte offset of its console ' +
      'output so far. Pass outputBytes as sinceOffset to read_agent_output to get only what is new.',
    parameters: z.object({}),
    execute: async () => runControl(call, 'list_agents', {}),
  });

  server.addTool(readAgentOutputTool(call));

  server.addTool(sendAgentInputTool(call));

  server.addTool({
    name: 'kill_agent',
    description:
      'Stop an agent, the same as the kill button in the IDE (ticket and goal bookkeeping ' +
      'included). Does not ask for confirmation — the work in progress is gone.',
    parameters: z.object({ agentId: agentIdParam }),
    execute: async (args) => runControl(call, 'kill', args),
  });

  server.addTool({
    name: 'spawn_agent',
    description:
      'Start a new agent in a project folder without switching the project open in the IDE. ' +
      'Provider, model and permission mode default to the last launch in that folder; the ' +
      "project's provider policy still applies (provider_denied). Returns the new agentId. " +
      'Call list_projects first to find the folder: projectPath must be an initialised ' +
      'AuricIDE project (initialized: true there), else the spawn is refused (invalid_params).',
    parameters: z.object({
      projectPath: z.string().describe('Absolute path of the project folder to run in'),
      prompt: z.string().describe('What the agent is told to do'),
      provider: z.string().optional().describe('Agent CLI id, e.g. "claude" or "codex"'),
      model: z.string().optional().describe('Model for that provider'),
      permissionMode: z.string().optional().describe('Permission mode, e.g. "default" or "plan"'),
      headless: z
        .boolean()
        .optional()
        .describe('Run without a console (no input possible, output arrives at the end)'),
      name: z.string().optional().describe('Display name in the IDE'),
      worktree: worktreeParam,
      role: z
        .literal('supervisor')
        .optional()
        .describe(
          'Start a supervisor instead of a worker: Claude, interactive, scoped to the projects ' +
            'its policy (Settings → Supervisor) allows. Leave out for an ordinary agent.'
        ),
    }),
    execute: async (args) => runControl(call, 'spawn', args),
  });

  server.addTool({
    name: 'list_projects',
    description:
      'List the projects AuricIDE knows: starred first, then recently opened, then other ' +
      'watched folders. Each has path, name, starred, isOpen (open in the IDE right now), ' +
      'lastOpenedAt (ms since epoch, or null), runningAgents (agents already working there), ' +
      'initialized, description and descriptionSource. descriptionSource "user" means the ' +
      'owner wrote the description in the IDE, so trust it most; "readme", "package" and ' +
      '"cargo" are derived from those files, and null means no description. Pick the project ' +
      'by description and name; only initialized: true projects can take spawn_agent, and ' +
      'runningAgents > 0 means work is already going on there. Pass path as projectPath.',
    parameters: z.object({}),
    execute: async () => runControl(call, 'list_projects', {}),
  });

  server.addTool(awaitAgentResultTool(call));

  server.addTool(removeWorktreeTool(call));
  server.addTool(dismissAgentTool(call));
}
