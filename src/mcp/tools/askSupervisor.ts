import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import { CONTROL_LIMITS } from '../../lib/agents/agentControl.contract';
import { callControl } from '../controlClient';
import { runControl, type ControlCaller } from './agentControl';

/**
 * Whether this `auric-pm` runs for an agent a supervisor started. Rust sets it
 * at spawn, and only then, so nobody else sees a tool with no one behind it;
 * the control socket checks the same thing against the agent it finds by PID.
 */
export function offersAskSupervisor(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return env.AURIC_ASK_SUPERVISOR === '1';
}

/**
 * `ask_supervisor`: a question for whoever started this agent, on its own lane
 * instead of in the console (`docs/design-agent-control.md`, "Questions"). It
 * names no agent: the socket books it on the caller's process.
 */
export function registerAskSupervisorTool(
  server: FastMCP,
  call: ControlCaller = callControl
): void {
  // elementuuid=el_vdqm4hcv kind=mcp security=docs/security/supervisor-tools.md validation=zod:raiseQuestionParams+raisedQuestion
  server.addTool({
    name: 'ask_supervisor',
    description:
      'Ask the supervisor that started you a question, and keep working. It reaches them even ' +
      'while you are busy or your own sub-agents run, which text at the end of a report does ' +
      'not. Does not block and does not wait: go on with whatever does not depend on the ' +
      'answer. Interactive agents get the answer typed in as their next message; a headless ' +
      'agent reads no input, so state your assumption and carry on. Use it for a decision you ' +
      'cannot make from your instructions, not for progress. Returns { agentId, seq }. ' +
      `At most ${CONTROL_LIMITS.questionsPerAgentKept} questions per run.`,
    parameters: z.object({
      question: z.string().describe('The question, on its own understandable'),
      context: z.string().optional().describe('What they need to decide, briefly'),
      options: z
        .array(z.string())
        .optional()
        .describe(`Up to ${CONTROL_LIMITS.questionOptionsMax} answers you can work with`),
    }),
    execute: async (args) => runControl(call, 'raise_question', args),
  });
}
