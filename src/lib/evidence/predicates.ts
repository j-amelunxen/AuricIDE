import type { StationPredicate } from '@/lib/tauri/goals';
import type { PmTestCase, PmTicket } from '@/lib/tauri/pm';
import type { PmRequirement } from '@/lib/tauri/requirements';
import type { CommitInfo } from '@/lib/tauri/git';

export interface EvidenceResult {
  pass: boolean;
  /** Precise, human-readable: which check, what it saw, why it decided. */
  detail: string;
  checkedAt: string;
}

/**
 * Everything a predicate may look at, injected so the evaluators stay pure
 * and testable. The judge is optional — without an LLM configured, judged
 * predicates simply cannot run.
 */
export interface EvidenceContext {
  projectPath: string;
  tickets: PmTicket[];
  requirements: PmRequirement[];
  /** Acceptance criteria, used to build the judge prompt for a claimed step. */
  testCases: PmTestCase[];
  fileExists(glob: string): Promise<boolean>;
  gitLogSince(sinceIso?: string, pathPrefix?: string): Promise<CommitInfo[]>;
  llmJudge?(prompt: string): Promise<{ pass: boolean; reason: string }>;
  now(): string;
}

/**
 * Runs one predicate. Returns null for predicates machines cannot check
 * (`human`, `undefined`) — the UI keeps saying so instead of pretending.
 * A failing check is a normal result with a visible reason, never a throw.
 */
export async function evaluatePredicate(
  predicate: StationPredicate,
  ctx: EvidenceContext
): Promise<EvidenceResult | null> {
  const checkedAt = ctx.now();
  if (predicate.type === 'human' || predicate.type === 'undefined') return null;
  try {
    return await evaluateCheckable(predicate, ctx, checkedAt);
  } catch (e) {
    // Any unforeseen throw — a corrupt glob, an IPC failure, a malformed row
    // that slipped past the boundary — is a failed check with a visible
    // reason, never an exception that aborts the sweep for every later goal.
    return { pass: false, detail: `check failed: ${(e as Error).message}`, checkedAt };
  }
}

/** The checkable predicate types. `human`/`undefined` are handled before this
 * is reached; a type not in the union (a corrupt row) fails visibly. */
async function evaluateCheckable(
  predicate: Exclude<StationPredicate, { type: 'human' } | { type: 'undefined' }>,
  ctx: EvidenceContext,
  checkedAt: string
): Promise<EvidenceResult> {
  switch (predicate.type) {
    case 'ticket_done': {
      const ticket = ctx.tickets.find((t) => t.id === predicate.ticketId);
      if (!ticket) {
        return { pass: false, detail: `ticket ${predicate.ticketId} not found`, checkedAt };
      }
      return {
        pass: ticket.status === 'done',
        detail: `ticket "${ticket.name}" is ${ticket.status}`,
        checkedAt,
      };
    }

    case 'requirement_verified': {
      const req = ctx.requirements.find((r) => r.id === predicate.requirementId);
      if (!req) {
        return {
          pass: false,
          detail: `requirement ${predicate.requirementId} not found`,
          checkedAt,
        };
      }
      return {
        pass: req.status === 'verified',
        detail: `requirement ${req.reqId} is ${req.status}`,
        checkedAt,
      };
    }

    case 'file_exists': {
      const exists = await ctx.fileExists(predicate.glob);
      return {
        pass: exists,
        detail: exists ? `${predicate.glob} exists` : `${predicate.glob} does not exist`,
        checkedAt,
      };
    }

    case 'git_touches': {
      const commits = await ctx.gitLogSince(predicate.sinceIso, predicate.pathPrefix);
      return {
        pass: commits.length > 0,
        detail:
          commits.length > 0
            ? `${commits.length} commit${commits.length === 1 ? '' : 's'} touch ${predicate.pathPrefix} (newest: "${commits[0].summary}")`
            : `no commits touch ${predicate.pathPrefix}${predicate.sinceIso ? ` since ${predicate.sinceIso}` : ''}`,
        checkedAt,
      };
    }

    case 'judged': {
      if (!ctx.llmJudge) {
        return { pass: false, detail: 'no LLM configured to judge this', checkedAt };
      }
      try {
        const verdict = await ctx.llmJudge(predicate.prompt);
        return { pass: verdict.pass, detail: verdict.reason, checkedAt };
      } catch (e) {
        // A judge that cannot answer is a failed check with a visible
        // reason — a station must never go done on a broken judge.
        return { pass: false, detail: `judge failed: ${(e as Error).message}`, checkedAt };
      }
    }

    default:
      // A predicate type the union does not know about only reaches here from a
      // corrupt stored row. Fail visibly rather than throw or silently pass.
      return {
        pass: false,
        detail: `unknown predicate type "${(predicate as { type: string }).type}"`,
        checkedAt,
      };
  }
}

/** The evidence class a passing check of this predicate earns. */
export function evidenceClassFor(predicate: StationPredicate): 'proof' | 'judged' {
  return predicate.type === 'judged' ? 'judged' : 'proof';
}
