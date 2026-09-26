import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decideLaunch, type LaunchDecision, type LaunchGateInput } from './launchGate';

/**
 * Differential test of `decideLaunch` against the Lean oracle
 * (`verification/lean/AuricIDE/LaunchGate.lean`, REQ-LAUNCH-01..03).
 *
 * The corpus holds generated traces: grant rows saved and replaced, revocations
 * (also with stale ids), requests, goals moved to another mission root,
 * decision attempts that carry the grant id an instance last saw, and the ways
 * a start resolves, interleaved. For every attempt it holds two decisions of
 * the proved model: `decisions` is the native claim (replayed against
 * `claim_launch_impl` in Rust), `gate` is the pure gate this function
 * implements. `claim_start_iff_gate` in the model ties the two together.
 *
 * This replay keeps the books the IDE keeps (grant rows with their revoked
 * flag, the root each goal sits under now, claimed requests, held slots per
 * root, usage per grant id), resolves the grant the way the pre-filter does
 * (in force and for the goal's current root, else none) and asks the
 * production function for every attempt.
 *
 * Mutants: each deliberate loosening of the gate or of the books must disagree
 * with the oracle somewhere in the corpus; a mutant that survives means the
 * corpus cannot tell a broken gate from the real one.
 */

type OracleEvent =
  | { kind: 'grant'; root: number; maxConcurrent: number; launchBudget: number }
  | { kind: 'revoke'; grant: number }
  | { kind: 'request'; uid: number; root: number }
  | { kind: 'move'; uid: number; root: number }
  | { kind: 'attempt'; uid: number; grant: number }
  | { kind: 'running'; uid: number }
  | { kind: 'spawn-failed'; uid: number }
  | { kind: 'finished'; uid: number };

type ClaimDecision = LaunchDecision | 'not-a-request' | 'outside-root';

interface OracleTrace {
  version: 'launch-gate-v1';
  trace: number;
  events: OracleEvent[];
  decisions: Array<ClaimDecision | null>;
  gate: Array<LaunchDecision | null>;
  final: { heldCount: number[]; used: number[] };
}

const ROOTS = 3;
const CORPUS = resolve(__dirname, '../../../verification/contracts/launch-gate-v1.jsonl');
const traces: OracleTrace[] = readFileSync(CORPUS, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as OracleTrace);

/** What only a mutant looks at: when the request and the grant were written. */
interface Timing {
  requestCreatedAt: number;
  grantedAt: number;
}

type Decide = (input: LaunchGateInput, timing: Timing) => LaunchDecision;

interface Books {
  /** Frees a slot on `running` too: a fail-open reading of "started". */
  releaseOnRunning?: boolean;
  /** Treats a revoked or replaced grant row as still in force. */
  acceptRevoked?: boolean;
  /** Ignores where the goal sits now: any row in force counts for any goal. */
  ignoreAncestry?: boolean;
}

interface Row {
  root: number;
  maxConcurrent: number;
  launchBudget: number;
  revoked: boolean;
  grantedAt: number;
}

interface Replay {
  gate: Array<LaunchDecision | null>;
  heldCount: number[];
  used: number[];
}

/** The IDE's books around the gate, one event at a time. */
function replay(trace: OracleTrace, decide: Decide, books: Books = {}): Replay {
  const rows: Row[] = [];
  const used: number[] = [];
  const goalRoot = new Map<number, number>();
  const createdAt = new Map<number, number>();
  const claimed = new Set<number>();
  const holder = new Map<number, number>();
  const heldCount = Array.from({ length: ROOTS }, () => 0);
  const release = (uid: number) => {
    const root = holder.get(uid);
    if (root === undefined) return;
    holder.delete(uid);
    heldCount[root] = Math.max(0, heldCount[root] - 1);
  };
  const inForce = (row: Row) => books.acceptRevoked || !row.revoked;

  const gate = trace.events.map((event, index): LaunchDecision | null => {
    switch (event.kind) {
      case 'grant':
        for (const row of rows) if (row.root === event.root) row.revoked = true;
        rows.push({ ...event, revoked: false, grantedAt: index });
        used.push(0);
        return null;
      case 'revoke': {
        const row = rows[event.grant];
        if (row) row.revoked = true;
        return null;
      }
      case 'request':
        if (!goalRoot.has(event.uid)) {
          goalRoot.set(event.uid, event.root);
          createdAt.set(event.uid, index);
        }
        return null;
      case 'move':
        if (goalRoot.has(event.uid)) goalRoot.set(event.uid, event.root);
        return null;
      case 'attempt': {
        const root = goalRoot.get(event.uid);
        const row = rows[event.grant];
        const resolved =
          root !== undefined &&
          row !== undefined &&
          inForce(row) &&
          (books.ignoreAncestry || row.root === root)
            ? row
            : null;
        const decision = decide(
          {
            grant: resolved,
            alreadyClaimed: claimed.has(event.uid),
            used: used[event.grant] ?? 0,
            held: root === undefined ? 0 : heldCount[root],
          },
          {
            requestCreatedAt: createdAt.get(event.uid) ?? index,
            grantedAt: resolved?.grantedAt ?? 0,
          }
        );
        if (decision === 'start' && root !== undefined) {
          claimed.add(event.uid);
          holder.set(event.uid, root);
          heldCount[root] += 1;
          used[event.grant] += 1;
        }
        return decision;
      }
      case 'running':
        if (books.releaseOnRunning) release(event.uid);
        return null;
      case 'spawn-failed':
      case 'finished':
        release(event.uid);
        return null;
    }
  });

  return { gate, heldCount, used };
}

const production: Decide = (input) => decideLaunch(input);

/** Number of traces whose replay disagrees with the oracle anywhere. */
function disagreements(decide: Decide, books: Books = {}): number {
  return traces.filter((trace) => {
    const result = replay(trace, decide, books);
    return (
      JSON.stringify(result.gate) !== JSON.stringify(trace.gate) ||
      JSON.stringify(result.heldCount) !== JSON.stringify(trace.final.heldCount) ||
      JSON.stringify(result.used) !== JSON.stringify(trace.final.used)
    );
  }).length;
}

describe('decideLaunch against the Lean oracle (launch-gate-v1)', () => {
  it('reads a corpus of at least 300 generated traces covering every decision', () => {
    expect(traces.length).toBeGreaterThanOrEqual(300);
    expect(traces.every((t) => t.version === 'launch-gate-v1')).toBe(true);
    const gates = new Set(traces.flatMap((t) => t.gate));
    for (const decision of [
      'start',
      'no-grant',
      'already-claimed',
      'budget-spent',
      'at-capacity',
    ] as const) {
      expect(gates, decision).toContain(decision);
    }
    const claims = new Set(traces.flatMap((t) => t.decisions));
    for (const decision of ['not-a-request', 'outside-root'] as const) {
      expect(claims, decision).toContain(decision);
    }
    const kinds = new Set(traces.flatMap((t) => t.events.map((e) => e.kind)));
    for (const kind of ['grant', 'revoke', 'request', 'move', 'attempt', 'spawn-failed']) {
      expect(kinds, kind).toContain(kind);
    }
  });

  it('agrees with the oracle on every step of every trace', () => {
    for (const trace of traces) {
      const result = replay(trace, production);
      expect(result.gate, `trace ${trace.trace}`).toEqual(trace.gate);
      expect(result.heldCount, `trace ${trace.trace}`).toEqual(trace.final.heldCount);
      expect(result.used, `trace ${trace.trace}`).toEqual(trace.final.used);
    }
  });

  it('starts only where the native claim starts (claim_start_iff_gate)', () => {
    for (const trace of traces) {
      trace.gate.forEach((gate, step) => {
        expect(gate === 'start', `trace ${trace.trace} step ${step}`).toBe(
          trace.decisions[step] === 'start'
        );
      });
    }
  });
});

/** Each is `decideLaunch` or the books with one check loosened or reordered. */
const MUTANTS: Record<string, { decide: Decide; books?: Books }> = {
  'reintroduces the time rule: requests older than the grant wait (REQ-01)': {
    decide: (input, timing) =>
      input.grant !== null && timing.requestCreatedAt < timing.grantedAt
        ? 'no-grant'
        : decideLaunch(input),
  },
  'starts without any grant, on default limits (REQ-01)': {
    decide: (input) =>
      decideLaunch({ ...input, grant: input.grant ?? { maxConcurrent: 5, launchBudget: 50 } }),
  },
  'accepts a revoked or replaced grant id (REQ-01)': {
    decide: production,
    books: { acceptRevoked: true },
  },
  'ignores where the goal sits now (REQ-01)': {
    decide: production,
    books: { ignoreAncestry: true },
  },
  'lets one more agent run than the limit (REQ-02)': {
    decide: (input) => decideLaunch({ ...input, held: Math.max(0, input.held - 1) }),
  },
  'frees the slot as soon as the spawn reports running (REQ-02)': {
    decide: production,
    books: { releaseOnRunning: true },
  },
  'allows one start past the budget (REQ-03)': {
    decide: (input) => decideLaunch({ ...input, used: Math.max(0, input.used - 1) }),
  },
  'starts a request someone already took': {
    decide: (input) => decideLaunch({ ...input, alreadyClaimed: false }),
  },
  'checks the slot before the budget': {
    decide: (input) => {
      const decision = decideLaunch(input);
      return decision === 'budget-spent' &&
        input.grant !== null &&
        !(input.held < input.grant.maxConcurrent)
        ? 'at-capacity'
        : decision;
    },
  },
};

const mutantResults: Record<string, number> = {};

describe('mutants of the gate are caught by the oracle', () => {
  it.each(Object.entries(MUTANTS))('%s', (name, mutant) => {
    const caught = disagreements(mutant.decide, mutant.books);
    mutantResults[name] = caught;
    expect(caught).toBeGreaterThan(0);
  });
});

// Evidence for the formal report of the goal-native mission: set
// LAUNCH_GATE_REPORT to a file path to get the counts behind these tests.
afterAll(() => {
  const target = process.env.LAUNCH_GATE_REPORT;
  if (!target) return;
  const steps = traces.reduce((sum, trace) => sum + trace.events.length, 0);
  const count = (values: Array<string | null>) =>
    values.reduce<Record<string, number>>((acc, value) => {
      if (value !== null) acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    }, {});
  writeFileSync(
    target,
    `${JSON.stringify(
      {
        corpus: 'verification/contracts/launch-gate-v1.jsonl',
        traces: traces.length,
        steps,
        events: count(traces.flatMap((trace) => trace.events.map((e) => e.kind))),
        claimDecisions: count(traces.flatMap((trace) => trace.decisions)),
        gateDecisions: count(traces.flatMap((trace) => trace.gate)),
        mismatchedTraces: disagreements(production),
        mutants: mutantResults,
      },
      null,
      2
    )}\n`
  );
});
