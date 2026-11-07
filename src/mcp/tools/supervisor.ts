import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import {
  externalRegisterParams,
  externalStopParams,
  type ControlParamsInput,
} from '../../lib/agents/agentControl.contract';
import { callControl } from '../controlClient';
import { createPmGateway, type PmGateway } from '../supervisorPm';
import {
  agentIdParam,
  awaitAgentResultTool,
  clearQuotaBlockTool,
  dismissAgentTool,
  listQuotaBlocksTool,
  readAgentOutputTool,
  readAgentReportTool,
  removeWorktreeTool,
  runControl,
  sendAgentInputTool,
  setQuotaBlockTool,
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

export function registerSupervisorTools(
  server: FastMCP,
  call: ControlCaller = callControl,
  gateway: PmGateway = createPmGateway(call)
): void {
  registerPmGatewayTools(server, gateway);
  server.addTool(listProjectsTool(call));
  server.addTool(spawnAgentTool(call));

  // elementuuid=el_sf1eca3c kind=mcp security=docs/security/supervisor-tools.md validation=zod:noParams+agentSummary
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
      'stalledSinceMs is its stall onset (Unix ms), both nullable. questionCount (absent at ' +
      'zero) is how many questions it raised; await_agent_result delivers them. The IDE nudges once and ' +
      'escalates automatically; do not send another stall nudge.',
    parameters: z.object({}),
    execute: async () => runControl(call, 'list_agents', {}),
  });

  server.addTool(readAgentOutputTool(call, OWN_CHILDREN));
  server.addTool(readAgentReportTool(call, OWN_CHILDREN));

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
  server.addTool(listQuotaBlocksTool(call));
  server.addTool(setQuotaBlockTool(call));
  server.addTool(clearQuotaBlockTool(call));
  registerLinkPolicyTools(server, call);
  registerExternalAgentTools(server, call);
}

/**
 * Runs the IDE tracks but has no process for (`docs/design-external-agents.md`).
 * Only here, never in `--control`: an entry belongs to the calling supervisor's
 * run folder, and an outside client has none.
 */
function registerExternalAgentTools(server: FastMCP, call: ControlCaller): void {
  // elementuuid=el_extreg01 kind=mcp security=docs/security/supervisor-tools.md validation=zod:externalRegisterParams
  server.addTool({
    name: 'register_external_agent',
    description:
      'Tell the IDE about a run it has no process for, such as an agent you started in a ' +
      'sandbox or on another machine, so it shows on your timeline and in the usage history. ' +
      'It is tracking only: no console, no input and no kill. state is registered (known, not ' +
      'working now) or running (working now). Safe to call again at any time: the key is ' +
      'externalId + runId, a repeat moves the state, updates what you pass and counts as a sign ' +
      'of life. A stopped key stays stopped (changed: false); use a new runId for a new run. ' +
      'Never put a prompt or a secret in name. When the entry is created it also returns a ' +
      'capability token, shown once: the IDE keeps only its hash. Hand it to the process that ' +
      'will end the run, such as a detached reaper, and never log it or store it in a file ' +
      'others can read. It allows only stop_external_agent for this one run and is revoked ' +
      'when the run ends or the token expires (default 72 h; tokenTtlSeconds to change). ' +
      'newToken: true on a live run issues another one. ' +
      'Returns { agent, created, changed, token? }.',
    parameters: externalRegisterParams,
    execute: async (args: ControlParamsInput<'external_register'>) =>
      runControl(call, 'external_register', args),
  });

  // elementuuid=el_extstp01 kind=mcp security=docs/security/supervisor-tools.md validation=zod:externalStopParams
  server.addTool({
    name: 'stop_external_agent',
    description:
      'End a run you registered and book it in the usage history, with the same externalId + ' +
      'runId. The figures are stored as reported; the IDE cannot check them. Leave out what you ' +
      'do not know: an absent runtime or cost stays unknown, never 0. This records the end; it ' +
      'does not stop anything on the other machine. The first stop wins and a repeat changes ' +
      'nothing. endReason says why it ended (completed, error, timeout, cancelled, reaped, ' +
      'lost). token is for a holder outside your process tree, such as a reaper you handed it ' +
      'to; you do not need to pass it yourself. force is for you as the owner only: close a ' +
      'stale run, or correct the finishedAt, outcome, figures or endReason of a run that is ' +
      'already final with the values you pass. A forced change is audited on the entry and is ' +
      'never accepted with a token. Returns { agent, alreadyStopped, booked }; booked: false ' +
      'means the IDE retries the history write itself.',
    parameters: externalStopParams,
    execute: async (args: ControlParamsInput<'external_stop'>) =>
      runControl(call, 'external_stop', args),
  });

  // elementuuid=el_extlst01 kind=mcp security=docs/security/supervisor-tools.md validation=zod:noParams+externalAgent
  server.addTool({
    name: 'list_external_agents',
    description:
      'List the external runs you registered, also those from before a resume, so you can see ' +
      'what you left open. Each has state (registered | running | stopped | failed) and stale, ' +
      'true when nothing was heard for a long time. Returns { agents }.',
    parameters: z.object({}),
    execute: async () => runControl(call, 'external_list', {}),
  });
}

const pmProject = z
  .string()
  .describe('Its absolute path or folder name; an older note may say auric-pm-<name>');
const pmToolName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'a tool name is letters, digits, _ and -');
const pmToolsParams = z.object({ project: pmProject.optional(), tool: pmToolName.optional() });
const pmCallParams = z.object({
  project: pmProject,
  tool: pmToolName,
  arguments: z.record(z.string(), z.unknown()).optional(),
});

/**
 * The PM tools of its projects, one door instead of a server per project
 * (`src/mcp/supervisorPm.ts`). Rust decides on every call whether the project may
 * be used.
 */
function registerPmGatewayTools(server: FastMCP, gateway: PmGateway): void {
  // elementuuid=el_d93xrgtp kind=mcp security=docs/security/supervisor-tools.md validation=zod:pmToolsParams+pmTargetParams
  server.addTool({
    name: 'pm_tools',
    description:
      'The PM tools of your projects (epics, tickets, goals, stations, requirements, notify and ' +
      'more). Without tool: every name with its first sentence. With tool: its full description ' +
      'and input schema, which you need before pm_call. The list is the same in every project; ' +
      'project matters only for a refusal, and is the first usable one if left out.',
    parameters: pmToolsParams,
    execute: async (args: { project?: string; tool?: string }) =>
      gateway.describe(args.project, args.tool),
  });

  // elementuuid=el_h6np2qvy kind=mcp security=docs/security/supervisor-tools.md validation=zod:pmCallParams+pmTargetParams
  server.addTool({
    name: 'pm_call',
    description:
      'Run one PM tool in one project and return its result as it is. arguments are that ' +
      "tool's, from pm_tools with tool. A project outside your policy is unknown_project; " +
      'without a project database, or a name two projects share, supervisor_denied with a ' +
      'reason. A name that fits two projects lists their paths. Spawning stays with spawn_agent.',
    parameters: pmCallParams,
    execute: async (args: { project: string; tool: string; arguments?: Record<string, unknown> }) =>
      gateway.call(args.project, args.tool, args.arguments ?? {}),
  });
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
      'useFor, relativeCost, blocked }. rank is the size within its provider (1 small … 4 largest, ' +
      'null unknown), useFor says what work it is enough for, relativeCost is its price ' +
      'against the cheapest model of that provider (1), and blocked ({ reason, until }, when ' +
      'present) marks a model temporarily unavailable due to quota/rate-limit exhaustion or ' +
      'silent fallback until that timestamp — do not pick a blocked model. balancing is null, or the load ' +
      'balancing the human set: { windowDays, next, providers [{ id, weight, spawns, ' +
      'targetPercent, actualPercent }] }; next is the provider furthest behind its share ' +
      'that still has at least one unblocked allowed model, ' +
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
      'you. A refusal is supervisor_denied with a reason (model_not_allowed, quota_blocked ' +
      'with expiresAt, project_limit_reached, …) or provider_denied: report policy refusals ' +
      'instead of switching around them, except on quota_blocked where you should pick another ' +
      'unblocked allowed model or provider from list_projects. The agent cannot see this conversation: the prompt must stand ' +
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
