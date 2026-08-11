import type { PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import type { PmTestCase, PmTicket } from '@/lib/tauri/pm';

// Pure, store-free judge-verdict helpers. They live apart from engine.ts (which
// imports the store) so the conductor and the judge backend can use them
// without pulling the store graph into a cycle.

/**
 * Pulls a { pass, reason } verdict out of a judge model's reply, tolerating
 * markdown fences and prose around it. Shared by the station judge and the
 * conductor's ticket judge so both parse a verdict the same way. Throws on no
 * JSON or a non-boolean `pass` — a broken judge must never read as a pass.
 */
export function parseVerdictJson(raw: string): { pass: boolean; reason: string } {
  const cleaned = raw.replace(/```(?:json)?/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('judge returned no JSON');
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
    pass?: unknown;
    reason?: unknown;
  };
  if (typeof parsed.pass !== 'boolean') throw new Error('judge returned no pass boolean');
  return { pass: parsed.pass, reason: String(parsed.reason ?? '') };
}

/**
 * Applies a judge verdict to a claimed station. A pass always earns 'judged'
 * (never 'proof') — the judge is a review, not a machine predicate. A reject
 * keeps the station done+claim so satisfaction keeps blocking; the non-null
 * lastCheckedAt is the "a judge ruled and rejected this" signal (a fresh claim
 * has it null), which stops the sweep from re-judging the same assertion.
 */
export function applyJudgeVerdict(
  station: PmGoalStation,
  verdict: { pass: boolean; reason: string },
  checkedAt: string
): Partial<PmGoalStation> {
  if (verdict.pass) {
    return {
      status: 'done',
      evidenceKind: 'judged',
      evidenceNote: verdict.reason,
      lastCheckedAt: checkedAt,
      doneAt: station.doneAt ?? checkedAt,
    };
  }
  return {
    evidenceKind: 'claim',
    evidenceNote: `rejected: ${verdict.reason}`,
    lastCheckedAt: checkedAt,
  };
}

/**
 * Resets a station to a fresh, re-judgeable claim. Used by the conductor when
 * it reopens a ticket-linked rejected claim for another attempt: back to
 * pending, evidence cleared, lastCheckedAt null so a re-claim is judged anew.
 */
export function reopenStationForRetry(): Partial<PmGoalStation> {
  return {
    status: 'planned',
    evidenceKind: 'claim',
    evidenceNote: '',
    doneAt: null,
    lastCheckedAt: null,
  };
}

/**
 * Builds the judge prompt for a CLAIMED step. A claim has no machine predicate,
 * so the question is synthesised from the step, the agent's stated evidence,
 * the goal's success criteria and the linked ticket's acceptance criteria. The
 * caller passes only the test cases relevant to the ticket.
 */
export function buildClaimJudgePrompt(
  station: PmGoalStation,
  ticket: PmTicket | undefined,
  goal: PmGoal | undefined,
  testCases: PmTestCase[]
): string {
  const parts: string[] = [
    'A step was claimed complete by an implementer. Judge whether the claim is credibly satisfied.',
    `Step: ${station.name}`,
  ];
  if (station.evidenceNote) parts.push(`Claimed evidence: ${station.evidenceNote}`);
  if (goal?.successCriteria?.trim()) {
    parts.push(`Goal success criteria:\n${goal.successCriteria.trim()}`);
  }
  if (ticket) {
    parts.push(`Linked ticket: ${ticket.name}`);
    if (ticket.description?.trim()) parts.push(`Ticket detail:\n${ticket.description.trim()}`);
  }
  if (testCases.length > 0) {
    parts.push(
      `Acceptance criteria:\n${testCases
        .map((tc) => `- ${tc.title}${tc.body ? `: ${tc.body}` : ''}`)
        .join('\n')}`
    );
  }
  parts.push(
    'Pass ONLY if the claimed evidence plausibly satisfies the criteria. If it is vague, generic, or unrelated, fail. Answer with { "pass": boolean, "reason": string }.'
  );
  return parts.join('\n\n');
}
