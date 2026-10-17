import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import { callControl } from '../controlClient';
import {
  agentIdParam,
  awaitAgentResultTool,
  readAgentOutputTool,
  removeWorktreeTool,
  runControl,
  worktreeParam,
  type ControlCaller,
} from './agentControl';

/**
 * The supervisor tools, offered only by `auric-mcp --supervisor`
 * (`docs/design-agent-control.md`, "Supervisor scope"; ADR 0004). They run
 * inside the one IDE agent the control socket admits, and the socket — not
 * this file — enforces the scope: own children only, the supervisor policy on
 * every spawn, no typing. The descriptions say what is refused so an
 * orchestrating model plans around it instead of discovering it.
 */

const OWN_CHILDREN = ' Only agents you started exist for you; any other id is unknown_agent.';

export function registerSupervisorTools(server: FastMCP, call: ControlCaller = callControl): void {
  server.addTool({
    name: 'list_projects',
    description:
      'List the projects you may start agents in. Each has path, name, description ' +
      '(descriptionSource "user" is the owner\'s own words; trust it most), initialized, ' +
      'runningAgents, and a supervisor block: providers [{ id, permissionMode, models ' +
      '[{ id, label, rank }] }], allowInteractive, runningChildren, maxRunning. rank is the ' +
      'model size within its provider (1 small … 4 largest, null unknown). balancing is null, ' +
      'or the load balancing the human set: { windowDays, next, providers [{ id, weight, ' +
      'spawns, targetPercent, actualPercent }] }; next is the provider furthest behind its ' +
      'share, take it unless the task needs a model only another provider has. Only these ' +
      'providers and models will spawn; anything else is refused. Call it before spawning, ' +
      'the policy and the counts change.',
    parameters: z.object({}),
    execute: async () => runControl(call, 'list_projects', {}),
  });

  server.addTool({
    name: 'spawn_agent',
    description:
      'Start an agent in one of your projects. provider, model and headless are required and ' +
      'nothing is filled in. headless: true for a question, check or short fix whose answer ' +
      'you need: then loop on await_agent_result. headless: false for long or multi-step work ' +
      'a human may need to answer, only where allowInteractive is true; report its id and do ' +
      'not wait. The permission mode comes from the policy, not from you. A refusal is ' +
      'supervisor_denied with a reason (model_not_allowed, project_limit_reached, …) or ' +
      'provider_denied: report it, never switch provider or model to get around it. The ' +
      'agent cannot see this conversation: the prompt must stand alone. Returns { agentId }.',
    parameters: z.object({
      projectPath: z.string().describe('path of a project from list_projects'),
      prompt: z.string().describe('Self-contained instruction; end it by asking for "ANSWER: …"'),
      provider: z.string().describe("Provider id from that project's supervisor block"),
      model: z.string().describe("Model id from that provider's list"),
      headless: z.boolean().describe('true: runs unattended and returns an answer'),
      name: z.string().optional().describe('Display name in the IDE'),
      worktree: worktreeParam,
    }),
    execute: async (args) => runControl(call, 'spawn', args),
  });

  server.addTool({
    name: 'list_my_agents',
    description:
      'List the agents you started, across projects: id, name, provider, model, status ' +
      '(running | idle | queued | error), the task, project, repoPath (its working folder; a ' +
      'path containing ".auric-wt" is a worktree you must clean up), headless, and outputBytes (pass ' +
      'it as sinceOffset to read_agent_output for only what is new). Agents the human or ' +
      'another supervisor started are not listed.',
    parameters: z.object({}),
    execute: async () => runControl(call, 'list_agents', {}),
  });

  server.addTool(
    readAgentOutputTool(
      call,
      OWN_CHILDREN +
        ' You cannot type into an agent: when one waits on a question, tell the human which ' +
        "agent's window to answer in."
    )
  );

  server.addTool(awaitAgentResultTool(call, OWN_CHILDREN));

  server.addTool({
    name: 'kill_agent',
    description:
      'Stop an agent you started; its work in progress is gone and nobody is asked.' + OWN_CHILDREN,
    parameters: z.object({ agentId: agentIdParam }),
    execute: async (args) => runControl(call, 'kill', args),
  });

  server.addTool(removeWorktreeTool(call, OWN_CHILDREN));
}
