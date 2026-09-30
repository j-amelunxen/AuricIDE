import { useStore } from '@/lib/store';
import { gitLogSince } from '@/lib/tauri/git';
import { llmCall } from '@/lib/tauri/llm';
import type { PmGoal, PmGoalStation } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import { orderedStations } from '@/lib/goals/stationOrder';
import {
  evaluatePredicate,
  evidenceClassFor,
  isMachinePredicate,
  type EvidenceContext,
  type EvidenceResult,
} from './predicates';
import {
  applyJudgeVerdict,
  buildClaimJudgePrompt,
  parseVerdictJson,
  reopenStationForRetry,
} from './verdict';
import { globMatch } from './globMatch';

// The pure verdict helpers live in verdict.ts (store-free, to avoid a cycle);
// re-exported here so existing importers keep working.
export { applyJudgeVerdict, buildClaimJudgePrompt, parseVerdictJson, reopenStationForRetry };
export { globMatch };

function nowTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
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

/** True when the updates change what the station says, not only when it was
 * last looked at. */
function changesStation(station: PmGoalStation, updates: Partial<PmGoalStation>): boolean {
  return (Object.keys(updates) as (keyof PmGoalStation)[]).some(
    (key) => key !== 'lastCheckedAt' && updates[key] !== station[key]
  );
}

/**
 * Evaluates one station and applies the outcome to the store, without saving.
 * With `onlyIfChanged`, a result that merely repeats the last one leaves the
 * station alone — `lastCheckedAt` included.
 */
async function applyStationCheck(
  stationId: string,
  onlyIfChanged: boolean
): Promise<{ outcome: CheckOutcome; written: boolean }> {
  const station = useStore
    .getState()
    .goalStationsDraft.find((s: PmGoalStation) => s.id === stationId);
  if (!station) return { outcome: 'not-checkable', written: false };
  const result = await evaluatePredicate(station.predicate, buildEvidenceContext());
  const updates = applyCheckResult(station, result);
  if (updates === null) return { outcome: 'not-checkable', written: false };
  const outcome: CheckOutcome = result!.pass ? 'passed' : 'failed';
  if (onlyIfChanged && !changesStation(station, updates)) return { outcome, written: false };
  useStore.getState().updateStation(stationId, updates);
  return { outcome, written: true };
}

/** Runs the check for one station and writes the outcome to the store. A
 * person asked for this check, so it is recorded even when nothing changed. */
export async function checkStation(stationId: string): Promise<CheckOutcome> {
  const { outcome, written } = await applyStationCheck(stationId, false);
  const { rootPath } = useStore.getState();
  if (written && rootPath) void useStore.getState().saveGoals(rootPath);
  return outcome;
}

/**
 * Lazy sweep: for each goal (or one), check only the frontmost pending
 * stations with machine predicates — the front and its successor. Evidence
 * appears where work happens; checking the whole line on every event would
 * be noise and cost for nothing.
 *
 * The sweep runs after every burst of file changes, and a save writes
 * project.db, which the watcher reports back as a full data reload. So it
 * writes only results that differ from the last one, and saves once at the
 * end. `skipJudged` leaves LLM-judged stations out: a file change is no reason
 * to ask the judge again, and the sweep after an agent finishes still does.
 */
export async function checkFrontStations(
  goalId?: string,
  { skipJudged = false }: { skipJudged?: boolean } = {}
): Promise<void> {
  const { goalStationsDraft, rootPath } = useStore.getState();
  let touched = false;
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
        !(skipJudged && s.predicate.type === 'judged') &&
        s.status !== 'fog'
    );
    for (const station of pending.slice(0, 2)) {
      // One station that throws must never blind the rest of the sweep. The
      // check itself already turns a failure into a failed result; this is the
      // belt to that suspenders — a store write or an unforeseen error here
      // stops at this station, not at every goal ordered after it.
      try {
        const { written } = await applyStationCheck(station.id, true);
        touched ||= written;
      } catch {
        // Deliberately swallowed: a broken check is not a reason to stop
        // checking everything else. The station keeps its prior state.
      }
    }
  }
  if (touched && rootPath) void useStore.getState().saveGoals(rootPath);
}

/**
 * Settles agent-claimed stations that carry a machine predicate by running the
 * predicate, whatever the judge said before: a claim on "docs/x.md exists" is
 * proof the moment the file is there, and a judge's rejection must not outlive
 * that. A failing check leaves the claim blocking with the check's reason and
 * is written only when the reason changes — never demoted, because a sweep
 * that runs before the file list has loaded would otherwise undo real work.
 * Returns whether anything was written.
 */
async function checkMachineClaims(goalId: string | undefined): Promise<boolean> {
  const claims = useStore
    .getState()
    .goalStationsDraft.filter(
      (s: PmGoalStation) =>
        s.status === 'done' &&
        s.evidenceKind === 'claim' &&
        isMachinePredicate(s.predicate) &&
        (!goalId || s.goalId === goalId)
    );
  let touched = false;
  for (const st of claims) {
    const result = await evaluatePredicate(st.predicate, buildEvidenceContext());
    if (result === null) continue;
    const updates = result.pass
      ? applyCheckResult(st, result)!
      : { evidenceNote: result.detail, lastCheckedAt: result.checkedAt };
    if (!changesStation(st, updates)) continue;
    useStore.getState().updateStation(st.id, updates);
    touched = true;
  }
  return touched;
}

/**
 * Settles the agent-CLAIMED stations. Machine-predicate claims go through
 * their predicate first (`checkMachineClaims`); the rest — judged stations and
 * those with no predicate — run each fresh claim (done + claim + never judged)
 * exactly once through the judge model, promoting it to 'judged' or leaving it
 * a blocking claim with the reason. The lastCheckedAt==null filter is the
 * anti-thrash guard: a claim is judged once per assertion, not on every event.
 * No judge model → left as a retryable blocking claim, never passed.
 */
export async function checkClaimedStations(goalId?: string): Promise<void> {
  let touched = await checkMachineClaims(goalId);
  const state = useStore.getState();
  const ctx = buildEvidenceContext();
  const save = () => {
    if (touched && state.rootPath) void useStore.getState().saveGoals(state.rootPath);
  };
  if (!ctx.llmJudge) return save(); // no judge model: claims stay blocking, retryable once configured
  const claims = state.goalStationsDraft.filter(
    (s: PmGoalStation) =>
      s.status === 'done' &&
      s.evidenceKind === 'claim' &&
      s.lastCheckedAt === null &&
      !isMachinePredicate(s.predicate) &&
      (!goalId || s.goalId === goalId)
  );
  for (const st of claims) {
    const ticket = st.ticketId
      ? state.pmDraftTickets.find((t: PmTicket) => t.id === st.ticketId)
      : undefined;
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
  save();
}
