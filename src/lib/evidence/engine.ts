import { useStore } from '@/lib/store';
import { gitLogSince } from '@/lib/tauri/git';
import { llmCall } from '@/lib/tauri/llm';
import type { PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import { orderedStations } from '@/lib/goals/stationOrder';
import {
  evaluatePredicate,
  evidenceClassFor,
  type EvidenceContext,
  type EvidenceResult,
} from './predicates';
import {
  applyJudgeVerdict,
  buildClaimJudgePrompt,
  parseVerdictJson,
  reopenStationForRetry,
} from './verdict';

// The pure verdict helpers live in verdict.ts (store-free, to avoid a cycle);
// re-exported here so existing importers keep working.
export { applyJudgeVerdict, buildClaimJudgePrompt, parseVerdictJson, reopenStationForRetry };

function nowTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** Longest glob we will even look at. A predicate glob is a path pattern, not
 * a program; anything past this is either a mistake or an attack. */
const GLOB_MAX_LEN = 512;

/**
 * Segment-aware glob match with no regex, so a hostile pattern cannot trigger
 * catastrophic backtracking. `**a**a…b` compiled to `.*a.*a…` once froze the
 * renderer for tens of seconds against a long non-matching path; this runs in
 * O(|glob|·|path|) via a memo table instead. Semantics match the old regex:
 * `*` within a segment, `**` across segments, `?` one non-slash char, anchored
 * to the end and allowed to begin at any segment boundary. A non-string or
 * over-long glob is a non-match, never a throw.
 */
export function globMatch(glob: string, path: string): boolean {
  if (typeof glob !== 'string' || typeof path !== 'string') return false;
  if (glob.length > GLOB_MAX_LEN) return false;
  // Candidate starts: index 0 and every index just past a '/', mirroring the
  // old `(^|/)` anchor.
  const starts = [0];
  for (let i = 0; i < path.length; i++) {
    if (path[i] === '/') starts.push(i + 1);
  }
  return starts.some((s) => anchoredGlobMatch(glob, path.slice(s)));
}

/** True if `glob` matches the whole of `text` (end-anchored), computed with a
 * memo table so no (glob, text) position pair is explored more than once. */
function anchoredGlobMatch(glob: string, text: string): boolean {
  const g = glob.length;
  const t = text.length;
  const memo: (boolean | undefined)[][] = Array.from({ length: g + 1 }, () =>
    new Array<boolean | undefined>(t + 1).fill(undefined)
  );
  const solve = (gi: number, ti: number): boolean => {
    const cached = memo[gi][ti];
    if (cached !== undefined) return cached;
    let res: boolean;
    if (gi === g) {
      res = ti === t;
    } else if (glob[gi] === '*' && glob[gi + 1] === '*') {
      // ** : consume any char including '/', or nothing.
      res = solve(gi + 2, ti) || (ti < t && solve(gi, ti + 1));
    } else if (glob[gi] === '*') {
      // * : consume any non-'/' char, or nothing.
      res = solve(gi + 1, ti) || (ti < t && text[ti] !== '/' && solve(gi, ti + 1));
    } else if (glob[gi] === '?') {
      res = ti < t && text[ti] !== '/' && solve(gi + 1, ti + 1);
    } else {
      res = ti < t && glob[gi] === text[ti] && solve(gi + 1, ti + 1);
    }
    memo[gi][ti] = res;
    return res;
  };
  return solve(0, 0);
}

/**
 * What actually happened to a station after a check ran — surfaced so
 * callers (and tests) never have to re-read the store to find out.
 */
export type CheckOutcome = 'passed' | 'failed' | 'not-checkable';

/** Builds the evidence context from live store state. Exported for tests. */
export function buildEvidenceContext(): EvidenceContext {
  const state = useStore.getState();
  const projectPath = state.rootPath ?? '';
  return {
    projectPath,
    tickets: state.pmDraftTickets,
    requirements: state.requirementsDraft,
    testCases: state.pmDraftTestCases,
    fileExists: async (glob: string) => state.allFilePaths.some((p: string) => globMatch(glob, p)),
    gitLogSince: (sinceIso?: string, pathPrefix?: string) =>
      gitLogSince(projectPath, sinceIso, pathPrefix),
    // The judge runs on the SEPARATE judge model (role:'judge'), gated on its
    // own config — not the implementer's. No judge configured → undefined, and
    // every caller treats that as "cannot verify", never as a pass.
    llmJudge: state.judgeLlmConfigured
      ? async (prompt: string) => {
          const response = await llmCall({
            projectPath,
            role: 'judge',
            messages: [
              {
                role: 'system',
                content:
                  'You judge whether a step is done based on the stated evidence question. Respond with a SINGLE JSON object: { "pass": boolean, "reason": string }. No prose, no fences.',
              },
              { role: 'user', content: prompt },
            ],
          });
          return parseVerdictJson(response.content);
        }
      : undefined,
    now: nowTimestamp,
  };
}

/** Applies one evidence result to one station via the store. Pure-ish core
 * of the engine, exported for direct testing. */
export function applyCheckResult(
  station: PmGoalStation,
  result: EvidenceResult | null
): Partial<PmGoalStation> | null {
  if (result === null) return null; // human/undefined: machines keep out
  if (result.pass) {
    return {
      status: 'done',
      evidenceKind: evidenceClassFor(station.predicate),
      evidenceNote: result.detail,
      lastCheckedAt: result.checkedAt,
      doneAt: station.doneAt ?? result.checkedAt,
    };
  }
  // A failed check on a machine-done station demotes it: a proof that no
  // longer holds is not a proof. Pending stations just record the reason.
  const demote =
    station.status === 'done' &&
    (station.evidenceKind === 'proof' || station.evidenceKind === 'judged');
  return {
    ...(demote ? { status: 'planned' as const, doneAt: null } : {}),
    evidenceNote: result.detail,
    lastCheckedAt: result.checkedAt,
  };
}

/** Runs the check for one station and writes the outcome to the store. */
export async function checkStation(stationId: string): Promise<CheckOutcome> {
  const state = useStore.getState();
  const station = state.goalStationsDraft.find((s: PmGoalStation) => s.id === stationId);
  if (!station) return 'not-checkable';
  const result = await evaluatePredicate(station.predicate, buildEvidenceContext());
  const updates = applyCheckResult(station, result);
  if (updates === null) return 'not-checkable';
  useStore.getState().updateStation(stationId, updates);
  if (state.rootPath) void useStore.getState().saveGoals(state.rootPath);
  return result!.pass ? 'passed' : 'failed';
}

/**
 * Lazy sweep: for each goal (or one), check only the frontmost pending
 * stations with machine predicates — the front and its successor. Evidence
 * appears where work happens; checking the whole line on every event would
 * be noise and cost for nothing.
 */
export async function checkFrontStations(goalId?: string): Promise<void> {
  const { goalStationsDraft } = useStore.getState();
  const goalIds = goalId
    ? [goalId]
    : [...new Set(goalStationsDraft.map((s: PmGoalStation) => s.goalId))];
  for (const gid of goalIds) {
    const pending = orderedStations(goalStationsDraft, gid).filter(
      (s) =>
        s.status !== 'done' &&
        s.kind !== 'human' &&
        s.predicate.type !== 'human' &&
        s.predicate.type !== 'undefined' &&
        s.status !== 'fog'
    );
    for (const station of pending.slice(0, 2)) {
      // One station that throws must never blind the rest of the sweep. The
      // check itself already turns a failure into a failed result; this is the
      // belt to that suspenders — a store write or an unforeseen error here
      // stops at this station, not at every goal ordered after it.
      try {
        await checkStation(station.id);
      } catch {
        // Deliberately swallowed: a broken check is not a reason to stop
        // checking everything else. The station keeps its prior state.
      }
    }
  }
}

/**
 * Judges the agent-CLAIMED stations that no machine predicate can settle. Runs
 * each fresh claim (done + claim + never judged) exactly once through the judge
 * model, promoting it to 'judged' or leaving it a blocking claim with the
 * reason. The lastCheckedAt==null filter is the anti-thrash guard: a claim is
 * judged once per assertion, not on every event. No judge model → left as a
 * retryable blocking claim, never passed.
 */
export async function checkClaimedStations(goalId?: string): Promise<void> {
  const state = useStore.getState();
  const ctx = buildEvidenceContext();
  if (!ctx.llmJudge) return; // no judge model: claims stay blocking, retryable once configured
  const claims = state.goalStationsDraft.filter(
    (s: PmGoalStation) =>
      s.status === 'done' &&
      s.evidenceKind === 'claim' &&
      s.lastCheckedAt === null &&
      (!goalId || s.goalId === goalId)
  );
  let touched = false;
  for (const st of claims) {
    const ticket = st.ticketId ? ctx.tickets.find((t) => t.id === st.ticketId) : undefined;
    const goal = state.goalsDraft.find((g: PmGoal) => g.id === st.goalId);
    const tcs = ticket ? ctx.testCases.filter((tc) => tc.ticketId === ticket.id) : [];
    let verdict: { pass: boolean; reason: string };
    try {
      verdict = await ctx.llmJudge(buildClaimJudgePrompt(st, ticket, goal, tcs));
    } catch (e) {
      // A broken judge is a rejection, not a pass — and stamping lastCheckedAt
      // stops us hammering it on every sweep. Reopen (a fresh claim) re-judges.
      verdict = { pass: false, reason: `judge unavailable: ${(e as Error).message}` };
    }
    useStore.getState().updateStation(st.id, applyJudgeVerdict(st, verdict, ctx.now()));
    touched = true;
  }
  if (touched && state.rootPath) void useStore.getState().saveGoals(state.rootPath);
}
