import { llmCall } from '@/lib/tauri/llm';
import { parseVerdictJson } from '@/lib/evidence/verdict';
import type { PmGoal } from '@/lib/tauri/goals';
import type { PmTestCase, PmTicket } from '@/lib/tauri/pm';

export interface JudgeVerdict {
  pass: boolean;
  reason: string;
}

export interface JudgeInput {
  ticket: PmTicket;
  goal?: PmGoal;
  testCases: PmTestCase[];
  projectPath: string;
}

/**
 * How a judge run begins. The LLM form resolves a verdict inline; the
 * review-agent form spawns a process and collects the verdict via IPC when it exits.
 * One abstraction, two verdict channels.
 */
export type JudgeStart =
  { kind: 'verdict'; verdict: JudgeVerdict } | { kind: 'delegated'; reviewAgentId: string };

export interface JudgeBackend {
  readonly form: 'llm' | 'agent';
  start(input: JudgeInput): Promise<JudgeStart>;
  /** Only the review-agent form implements this — reads the verdict a spawned
   * reviewer wrote when its process exits. */
  collectVerdict?(reviewAgentId: string, ticketId: string): Promise<JudgeVerdict | null>;
}

/**
 * The store-side capabilities the review-agent form needs, injected so this
 * module stays store-free. `spawnReviewAgent` launches a reviewer and returns
 * its id; `latestReview` reads the verdict it wrote for a ticket (null if none
 * yet), scoped by the caller to this review's start time.
 */
export interface AgentJudgeDeps {
  spawnReviewAgent: (input: JudgeInput) => Promise<string>;
  latestReview: (ticketId: string) => Promise<JudgeVerdict | null>;
}

const REVIEW_AGENT_SYSTEM =
  'You are an independent reviewer. Inspect the actual code and changes for the ticket below and ' +
  'judge whether it was completed to its acceptance criteria. Be skeptical: pass only if the ' +
  'criteria are credibly met.';

/** The task prompt for a spawned review agent (Codex/Grok/…). It must end by
 * calling the submit_ticket_review MCP tool with its verdict. */
export function buildReviewAgentPrompt(input: JudgeInput): string {
  return [
    REVIEW_AGENT_SYSTEM,
    buildTicketJudgePrompt(input),
    `When done, call the MCP tool submit_ticket_review with { ticketId: "${input.ticket.id}", pass: boolean, reason: string }. ` +
      'A rejection MUST include a concrete reason. Do not change the ticket status yourself.',
  ].join('\n\n');
}

const TICKET_JUDGE_SYSTEM =
  'You review whether an implementer actually completed a ticket to its acceptance criteria. ' +
  'Be skeptical: pass only if the criteria are credibly met by the work described. Respond with ' +
  'a SINGLE JSON object: { "pass": boolean, "reason": string }. No prose, no fences.';

/**
 * The judge prompt for a completed TICKET — a different question than the
 * station-claim judge (buildClaimJudgePrompt): here we weigh the ticket's
 * acceptance criteria, not a single step's evidence note.
 */
export function buildTicketJudgePrompt(input: JudgeInput): string {
  const { ticket, goal, testCases } = input;
  const parts: string[] = [`Ticket: ${ticket.name}`];
  if (ticket.description?.trim()) parts.push(`Description:\n${ticket.description.trim()}`);
  if (goal?.successCriteria?.trim()) {
    parts.push(`Goal success criteria:\n${goal.successCriteria.trim()}`);
  }
  const tcs = testCases.filter((tc) => tc.ticketId === ticket.id);
  if (tcs.length > 0) {
    parts.push(
      `Acceptance criteria:\n${tcs
        .map((tc) => `- ${tc.title}${tc.body ? `: ${tc.body}` : ''}`)
        .join('\n')}`
    );
  }
  parts.push(
    'Judge whether the ticket is credibly complete. Pass only if the acceptance criteria are met. Answer with { "pass": boolean, "reason": string }.'
  );
  return parts.join('\n\n');
}

/** The LLM-call judge: same judge model as the station judge (role:'judge'),
 * same parser, its own ticket-level question. */
async function llmJudgeTicket(input: JudgeInput): Promise<JudgeVerdict> {
  const response = await llmCall({
    projectPath: input.projectPath,
    role: 'judge',
    messages: [
      { role: 'system', content: TICKET_JUDGE_SYSTEM },
      { role: 'user', content: buildTicketJudgePrompt(input) },
    ],
  });
  return parseVerdictJson(response.content);
}

/**
 * Builds the judge backend for the chosen form. Supports both the inline LLM form
 * and the review-agent form (backed by the pm_ticket_reviews database table and IPC).
 */
export function createJudgeBackend(form: 'llm' | 'agent', deps?: AgentJudgeDeps): JudgeBackend {
  if (form === 'agent') {
    if (!deps) {
      throw new Error('The review-agent judge form needs spawn/read dependencies.');
    }
    return {
      form: 'agent',
      async start(input: JudgeInput): Promise<JudgeStart> {
        return { kind: 'delegated', reviewAgentId: await deps.spawnReviewAgent(input) };
      },
      async collectVerdict(_reviewAgentId: string, ticketId: string) {
        return deps.latestReview(ticketId);
      },
    };
  }
  return {
    form: 'llm',
    async start(input: JudgeInput): Promise<JudgeStart> {
      return { kind: 'verdict', verdict: await llmJudgeTicket(input) };
    },
  };
}
