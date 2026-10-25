import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { ControlParamsInput } from '../../lib/agents/agentControl.contract';
import { callControl } from '../controlClient';
import {
  agentIdParam,
  awaitAgentResultTool,
  dismissAgentTool,
  readAgentOutputTool,
  removeWorktreeTool,
  runControl,
  sendAgentInputTool,
  worktreeParam,
  type ControlCaller,
} from './agentControl';

/**
 * The supervisor tools, offered only by `auric-mcp --supervisor`
 * (`docs/design-agent-control.md`, "Supervisor scope"; ADR 0004). They run
 * inside the one IDE agent the control socket admits, and the socket — not
 * this file — enforces the scope: own children only, the supervisor policy on
 * every spawn. The descriptions say what is refused so an
 * orchestrating model plans around it instead of discovering it.
 */

const OWN_CHILDREN = ' Only agents you started exist for you; any other id is unknown_agent.';

export function registerSupervisorTools(server: FastMCP, call: ControlCaller = callControl): void {
  server.addTool(listProjectsTool(call));
  server.addTool(spawnAgentTool(call));

  server.addTool({
    name: 'list_my_agents',
    description:
      'List the agents you started, across projects: id, name, provider, model, status ' +
      '(running | idle | queued | done | error), the task, project, repoPath (its working folder; a ' +
      'path containing ".auric-wt" is a worktree you must clean up), headless, and outputBytes (pass ' +
      'it as sinceOffset to read_agent_output for only what is new). Finished agents stay ' +
      'listed (status done or error), with finishedAt and answerPreview (first 300 characters ' +
      'of the ANSWER line, or null), until you clear them with dismiss_agent, so an agent ' +
      'missing here was never yours or was dismissed, not lost. Agents the human or another ' +
      'supervisor started are not listed. idleForMs is the IDE-observed inactivity duration; ' +
      'stalledSinceMs is its stall onset (Unix ms), both nullable. The IDE nudges once and ' +
      'escalates automatically; do not send another stall nudge.',
    parameters: z.object({}),
    execute: async () => runControl(call, 'list_agents', {}),
  });

  server.addTool(readAgentOutputTool(call, OWN_CHILDREN));

  server.addTool(
    awaitAgentResultTool(
      call,
      OWN_CHILDREN +
        ' For an interactive agent, always pass untilInput: true, so you hear about its ' +
        'questions instead of the human having to relay them.'
    )
  );

  server.addTool(
    sendAgentInputTool(
      call,
      OWN_CHILDREN +
        ' Answer only what your instructions let you decide yourself; every other question ' +
        'goes to the human first, and you type their answer in for them.'
    )
  );

  server.addTool({
    name: 'kill_agent',
    description:
      'Stop an agent you started; its work in progress is gone and nobody is asked.' + OWN_CHILDREN,
    parameters: z.object({ agentId: agentIdParam }),
    execute: async (args) => runControl(call, 'kill', args),
  });

  server.addTool(removeWorktreeTool(call, OWN_CHILDREN));
  server.addTool(dismissAgentTool(call, OWN_CHILDREN));
  registerLinkPolicyTools(server, call);
}

/**
 * How a supervisor reads the supervisor link policy and asks for a change
 * (`docs/design-supervisor-link.md`, "Policy proposals"). Proposing changes
 * nothing; the human applies it in the IDE.
 */
function registerLinkPolicyTools(server: FastMCP, call: ControlCaller): void {
  server.addTool({
    name: 'link_policy_get',
    description:
      'Read the Supervisor Control API ("supervisor link") policy: which projects a client ' +
      'of the link may see, their document types and job kinds, and the job limits. stored ' +
      'is the file as the human edits it: defaults { documentTypes, jobKinds } every shared ' +
      'project inherits, projects { path: entry } with what each one changes (own types or ' +
      'kinds, a same name overrides; inherit false; disabledDocumentTypes / ' +
      'disabledJobKinds; dailyLimit), jobs { dailyLimit, perProjectDailyLimit }. effective is ' +
      'what the link acts on per project, with origins (global | project | override). ' +
      'pending lists your proposals still waiting for the human. Read it before proposing.',
    parameters: z.object({}),
    execute: async () => runControl(call, 'link_policy_get', {}),
  });

  server.addTool({
    name: 'link_policy_propose',
    description:
      'Propose a change to the supervisor link policy. Nothing changes: the human gets an ' +
      'inbox notification with the diff and Apply / Discard, and only their Apply in the IDE ' +
      'writes it. Proposals expire after 24 hours and are dropped if the policy changes ' +
      'first. There is no removal; ask the human for that. globalInstructions of a job kind ' +
      "may only be a file name under the IDE's job-kinds folder, never an absolute path. " +
      'A refused change is invalid_params naming the change and the rule. Returns ' +
      '{ proposalId, status: "pending", expiresAt, diff }. Report the diff to the human and ' +
      'do not wait for the decision or propose the same change again.',
    parameters: z.object({
      reason: z
        .string()
        .describe('One or two sentences for the human: why this change, for which task'),
      changes: z.array(policyChange).min(1).describe('Applied in order onto the current policy'),
    }),
    execute: async (args) => runControl(call, 'link_policy_propose', args),
  });
}

const projectPath = z.string().describe('Absolute path of an existing project folder');

const documentType = z
  .object({
    name: z.string().describe('Lowercase, e.g. "scene"; a same name replaces'),
    globs: z.array(z.string()).describe('Project-relative globs of the documents'),
    index: z.object({ path: z.string(), entriesKey: z.string().optional() }).optional(),
    nameField: z.string().optional(),
    descriptionField: z.string().optional(),
    schema: z.string().optional(),
    assets: z.array(z.string()).optional(),
    maxAssetBytes: z.number().int().positive().optional(),
  })
  .strict();

const jobKind = z
  .object({
    kind: z.string().describe('Lowercase, e.g. "scene.draw"; a same name replaces'),
    instructions: z
      .string()
      .optional()
      .describe('Project-relative instructions file; wins when the project has it'),
    globalInstructions: z
      .string()
      .optional()
      .describe('File name under the IDE job-kinds folder, used where the project has none'),
    writes: z.array(z.string()).optional().describe('Globs the job may write; default: documents'),
  })
  .strict();

const limit = z.number().int().nonnegative();

/** One change; the ops are `proposals.ops` in `supervisorLink.fixtures.json`. */
const policyChange = z.discriminatedUnion('op', [
  z.object({ op: z.literal('share_project'), project: projectPath }),
  z.object({ op: z.literal('set_default_document_type'), documentType }),
  z.object({ op: z.literal('set_default_job_kind'), jobKind }),
  z.object({ op: z.literal('set_project_document_type'), project: projectPath, documentType }),
  z.object({ op: z.literal('set_project_job_kind'), project: projectPath, jobKind }),
  z.object({
    op: z.literal('set_project_inherit'),
    project: projectPath,
    inherit: z.boolean(),
    disabledDocumentTypes: z.array(z.string()).optional(),
    disabledJobKinds: z.array(z.string()).optional(),
  }),
  z.object({ op: z.literal('set_daily_limit'), dailyLimit: limit }),
  z.object({
    op: z.literal('set_per_project_daily_limit'),
    perProjectDailyLimit: limit.nullable(),
  }),
  z.object({
    op: z.literal('set_project_daily_limit'),
    project: projectPath,
    dailyLimit: limit.nullable(),
  }),
]);

/** `list_projects`: small enough to read whole, one project at a time before a spawn. */
function listProjectsTool(call: ControlCaller) {
  return {
    name: 'list_projects',
    description:
      'List the projects you may start agents in. Pass project (its path or name) before ' +
      'every spawn to get just that one, small and current; leave it out only to find a ' +
      'project. Each has path, name, description (descriptionSource "user" is the owner\'s ' +
      'own words; trust it most), initialized, runningAgents, and a supervisor block: ' +
      'balancing, providers [{ id, permissionMode (absent: the provider default), models, ' +
      'note }], ' +
      'allowInteractive, runningChildren, maxRunning. models is "all" or a list of model ids; ' +
      'the top-level catalog describes each model once per provider: { id, label, rank, ' +
      'useFor, relativeCost }. rank is the size within its provider (1 small … 4 largest, ' +
      'null unknown), useFor says what work it is enough for, relativeCost is its price ' +
      'against the cheapest model of that provider (1). balancing is null, or the load ' +
      'balancing the human set: { windowDays, next, providers [{ id, weight, spawns, ' +
      'targetPercent, actualPercent }] }; next is the provider furthest behind its share, ' +
      'take it unless the task needs a model only another provider has. note (absent when ' +
      "none is set) is the human's routing rule for this provider in this project; read it " +
      'before choosing a provider: a task the note excludes goes to another provider even ' +
      'when balancing.next names it, and a note that allows something is a reason to choose ' +
      'it. Notes come before balancing. Notes add to the size of the answer, so narrow it ' +
      'with project. Only these providers ' +
      'and models will spawn; anything else is refused. A project you may not use is ' +
      'unknown_project.',
    parameters: z.object({
      project: z
        .string()
        .optional()
        .describe('Path or name of one project; leave it out to list all of them'),
    }),
    execute: async (args: { project?: string }) =>
      runControl(call, 'list_projects', args.project ? { project: args.project } : {}, {
        compact: true,
      }),
  };
}

/** `spawn_agent`: provider and model default in Rust; a large model needs a reason. */
function spawnAgentTool(call: ControlCaller) {
  return {
    name: 'spawn_agent',
    description:
      'Start an agent in one of your projects. headless is required. provider may be left ' +
      "out: the project's balancing.next is taken, so pass it whenever a provider's note in " +
      'list_projects excludes the task for balancing.next. model may be left out: the smallest ' +
      'allowed model with a rank is taken, which fits most work. A model of rank 3 or more ' +
      'needs modelReason, one sentence on why the task cannot be done by a smaller one; ' +
      'without it the spawn is refused (supervisor_denied, model_reason_required) and the ' +
      'refusal names the smaller models. headless: true for a question, check or short fix ' +
      'whose answer you need: end your turn and wait for the IDE finish pingback. ' +
      'headless: false for long or ' +
      'multi-step work a human may need to answer, only where allowInteractive is true; ' +
      'report its id and do not wait. The permission mode comes from the policy, not from ' +
      'you. A refusal is supervisor_denied with a reason (model_not_allowed, ' +
      'project_limit_reached, …) or provider_denied: report it, never switch provider or ' +
      'model to get around it. The agent cannot see this conversation: the prompt must stand ' +
      'alone. Returns { agentId }.',
    parameters: z.object({
      projectPath: z.string().describe('path of a project from list_projects'),
      prompt: z.string().describe('Self-contained instruction; end it by asking for "ANSWER: …"'),
      provider: z
        .string()
        .optional()
        .describe(
          "Provider id from that project's supervisor block; default balancing.next. The " +
            "providers' notes come first: never a provider whose note excludes the task"
        ),
      model: z
        .string()
        .optional()
        .describe("Model id from that provider's list; default the smallest ranked one"),
      modelReason: z
        .string()
        .optional()
        .describe('Why the task needs this model; required from rank 3 on'),
      headless: z.boolean().describe('true: runs unattended and returns an answer'),
      name: z.string().optional().describe('Display name in the IDE'),
      worktree: worktreeParam,
    }),
    execute: async (args: ControlParamsInput<'spawn'>) => runControl(call, 'spawn', args),
  };
}
