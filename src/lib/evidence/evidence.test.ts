import { describe, expect, it } from 'vitest';
import type { PmGoalStation, StationPredicate } from '@/lib/tauri/goals';
import type { CommitInfo } from '@/lib/tauri/git';
import { evaluatePredicate, evidenceClassFor, type EvidenceContext } from './predicates';
import {
  applyCheckResult,
  applyJudgeVerdict,
  buildClaimJudgePrompt,
  globMatch,
  parseVerdictJson,
  reopenStationForRetry,
} from './engine';
import type { PmTicket } from '@/lib/tauri/pm';
import { STATION_STALE_MS, staleStations } from './staleness';
import { detectForks, FORK_MIN_COMMITS } from './forkDetector';

const TS = '2026-01-10 10:00:00';
const NOW = Date.parse('2026-01-10T10:00:00');

function makeCtx(overrides: Partial<EvidenceContext> = {}): EvidenceContext {
  return {
    projectPath: '/p',
    tickets: [],
    requirements: [],
    testCases: [],
    fileExists: async () => false,
    gitLogSince: async () => [],
    now: () => TS,
    ...overrides,
  };
}

function makeStation(overrides: Partial<PmGoalStation> = {}): PmGoalStation {
  return {
    id: 's1',
    goalId: 'g1',
    name: 'Step',
    kind: 'normal',
    status: 'planned',
    evidenceKind: 'claim',
    predicate: { type: 'undefined' },
    evidenceNote: '',
    ticketId: null,
    lane: 0,
    sortOrder: 0,
    lastCheckedAt: null,
    doneAt: null,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function makeCommit(touched: string[], summary = 'change'): CommitInfo {
  return { oid: 'abc', summary, author: 'dev', timestamp: TS, touched };
}

describe('evaluatePredicate', () => {
  it('refuses to machine-check human and undefined predicates', async () => {
    expect(await evaluatePredicate({ type: 'human' }, makeCtx())).toBeNull();
    expect(await evaluatePredicate({ type: 'undefined' }, makeCtx())).toBeNull();
  });

  it('checks ticket_done against live ticket status', async () => {
    const ctx = makeCtx({
      tickets: [
        {
          id: 't1',
          epicId: 'e1',
          name: 'Build it',
          description: '',
          status: 'done',
          statusUpdatedAt: TS,
          sortOrder: 0,
          priority: 'normal',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    });
    const pass = await evaluatePredicate({ type: 'ticket_done', ticketId: 't1' }, ctx);
    expect(pass?.pass).toBe(true);
    const missing = await evaluatePredicate({ type: 'ticket_done', ticketId: 'nope' }, ctx);
    expect(missing?.pass).toBe(false);
    expect(missing?.detail).toContain('not found');
  });

  it('git_touches passes only when commits touch the prefix', async () => {
    const ctx = makeCtx({
      gitLogSince: async (_since, prefix) =>
        prefix === 'src/mcp/' ? [makeCommit(['src/mcp/tools.ts'], 'add tool')] : [],
    });
    const hit = await evaluatePredicate({ type: 'git_touches', pathPrefix: 'src/mcp/' }, ctx);
    expect(hit?.pass).toBe(true);
    expect(hit?.detail).toContain('add tool');
    const miss = await evaluatePredicate({ type: 'git_touches', pathPrefix: 'docs/' }, ctx);
    expect(miss?.pass).toBe(false);
  });

  it('judged fails visibly when no judge is configured or the judge breaks', async () => {
    const noJudge = await evaluatePredicate({ type: 'judged', prompt: 'done?' }, makeCtx());
    expect(noJudge?.pass).toBe(false);
    expect(noJudge?.detail).toContain('no LLM');

    const broken = await evaluatePredicate(
      { type: 'judged', prompt: 'done?' },
      makeCtx({
        llmJudge: async () => {
          throw new Error('returned no JSON');
        },
      })
    );
    expect(broken?.pass).toBe(false);
    expect(broken?.detail).toContain('judge failed');
  });

  it('classifies passing evidence: deterministic checks are proof, judges are judged', () => {
    expect(evidenceClassFor({ type: 'file_exists', glob: 'a' })).toBe('proof');
    expect(evidenceClassFor({ type: 'judged', prompt: 'p' })).toBe('judged');
  });

  it('treats a corrupt/unknown predicate type as a failed check, never a throw', async () => {
    const weird = { type: 'telepathy' } as unknown as StationPredicate;
    const res = await evaluatePredicate(weird, makeCtx());
    expect(res).not.toBeNull();
    expect(res?.pass).toBe(false);
    expect(res?.detail).toMatch(/unknown/i);
  });

  it('turns a throwing fileExists into a failed check, not a thrown sweep', async () => {
    const res = await evaluatePredicate(
      { type: 'file_exists', glob: 'x' },
      makeCtx({
        fileExists: async () => {
          throw new Error('index blew up');
        },
      })
    );
    expect(res?.pass).toBe(false);
    expect(res?.detail).toContain('index blew up');
  });
});

describe('applyCheckResult', () => {
  it('promotes a passing station to done with the earned class', () => {
    const station = makeStation({
      predicate: { type: 'file_exists', glob: 'docs/*.md' } as StationPredicate,
    });
    const updates = applyCheckResult(station, {
      pass: true,
      detail: 'docs/a.md exists',
      checkedAt: TS,
    });
    expect(updates).toMatchObject({ status: 'done', evidenceKind: 'proof', doneAt: TS });
  });

  it('demotes a machine-done station whose proof no longer holds', () => {
    const station = makeStation({
      status: 'done',
      evidenceKind: 'proof',
      doneAt: TS,
      predicate: { type: 'file_exists', glob: 'gone.md' },
    });
    const updates = applyCheckResult(station, {
      pass: false,
      detail: 'gone.md does not exist',
      checkedAt: TS,
    });
    expect(updates).toMatchObject({ status: 'planned', doneAt: null });
  });

  it('never touches a station on a not-checkable result', () => {
    expect(applyCheckResult(makeStation(), null)).toBeNull();
  });
});

describe('parseVerdictJson', () => {
  it('parses a fenced verdict', () => {
    expect(parseVerdictJson('```json\n{"pass":true,"reason":"ok"}\n```')).toEqual({
      pass: true,
      reason: 'ok',
    });
  });

  it('coerces a missing reason to an empty string', () => {
    expect(parseVerdictJson('{"pass":false}')).toEqual({ pass: false, reason: '' });
  });

  it('throws on no JSON or a non-boolean pass — a broken judge never reads as pass', () => {
    expect(() => parseVerdictJson('nope')).toThrow(/no JSON/);
    expect(() => parseVerdictJson('{"reason":"x"}')).toThrow(/no pass boolean/);
  });
});

describe('applyJudgeVerdict', () => {
  it('promotes a passing claim to judged, keeping the original doneAt', () => {
    const st = makeStation({ status: 'done', evidenceKind: 'claim', doneAt: TS });
    const u = applyJudgeVerdict(st, { pass: true, reason: 'criteria met' }, TS);
    expect(u).toMatchObject({
      status: 'done',
      evidenceKind: 'judged',
      evidenceNote: 'criteria met',
      doneAt: TS,
    });
  });

  it('leaves a rejected claim done+claim, blocking, with the reason and a stamp', () => {
    const st = makeStation({ status: 'done', evidenceKind: 'claim' });
    const u = applyJudgeVerdict(st, { pass: false, reason: 'too vague' }, TS);
    expect(u.status).toBeUndefined(); // stays done — not demoted
    expect(u.evidenceKind).toBe('claim');
    expect(u.evidenceNote).toContain('too vague');
    expect(u.lastCheckedAt).toBe(TS); // the "a judge ruled" signal
  });
});

describe('reopenStationForRetry', () => {
  it('resets a station to a fresh, re-judgeable claim', () => {
    expect(reopenStationForRetry()).toMatchObject({
      status: 'planned',
      evidenceKind: 'claim',
      evidenceNote: '',
      doneAt: null,
      lastCheckedAt: null,
    });
  });
});

describe('buildClaimJudgePrompt', () => {
  it('includes the step, the claimed note, and the ticket acceptance criteria', () => {
    const st = makeStation({
      name: 'Parse ISO dates',
      evidenceNote: 'added a date parser in src/dates.ts',
      status: 'done',
      evidenceKind: 'claim',
      ticketId: 't1',
    });
    const ticket = {
      id: 't1',
      epicId: 'e1',
      name: 'Date handling',
      description: 'Parse all supported formats',
      status: 'done',
      statusUpdatedAt: TS,
      sortOrder: 0,
      priority: 'normal',
      createdAt: TS,
      updatedAt: TS,
    } as PmTicket;
    const testCases = [
      {
        id: 'tc1',
        ticketId: 't1',
        title: 'handles ISO 8601',
        body: '',
        sortOrder: 0,
        createdAt: TS,
        updatedAt: TS,
      },
    ];
    const prompt = buildClaimJudgePrompt(st, ticket, undefined, testCases);
    expect(prompt).toContain('Parse ISO dates');
    expect(prompt).toContain('added a date parser');
    expect(prompt).toContain('Date handling');
    expect(prompt).toContain('handles ISO 8601');
    expect(prompt).toContain('pass');
  });
});

describe('globMatch', () => {
  it('matches single-segment and cross-segment globs', () => {
    expect(globMatch('docs/*.md', 'docs/readme.md')).toBe(true);
    expect(globMatch('docs/*.md', 'docs/sub/readme.md')).toBe(false);
    expect(globMatch('docs/**/*.md', 'docs/sub/deep/readme.md')).toBe(true);
    expect(globMatch('a.txt', 'nested/a.txt')).toBe(true);
  });

  it('treats a literal space as a literal, not a wildcard', () => {
    // The old regex staged `**` through a space, so a real space widened into
    // a wildcard. The linear matcher has no such staging.
    expect(globMatch('my notes.md', 'my notes.md')).toBe(true);
    expect(globMatch('my notes.md', 'myXXnotes.md')).toBe(false);
  });

  it('returns fast on an adversarial wildcard glob (no catastrophic backtracking)', () => {
    const evil = '**a'.repeat(20) + 'b';
    const start = Date.now();
    expect(globMatch(evil, 'a'.repeat(200))).toBe(false);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('refuses a non-string or over-long glob instead of throwing', () => {
    expect(globMatch(undefined as unknown as string, 'x')).toBe(false);
    expect(globMatch('a'.repeat(10_000), 'x')).toBe(false);
  });
});

describe('staleStations', () => {
  it('flags machine-done stations past the window, never human ticks', () => {
    const fresh = makeStation({
      id: 'fresh',
      status: 'done',
      evidenceKind: 'proof',
      lastCheckedAt: TS,
    });
    const old = makeStation({
      id: 'old',
      status: 'done',
      evidenceKind: 'proof',
      lastCheckedAt: '2025-12-01 00:00:00',
    });
    const human = makeStation({
      id: 'human',
      status: 'done',
      evidenceKind: 'human',
      lastCheckedAt: '2025-12-01 00:00:00',
    });
    const stale = staleStations([fresh, old, human], NOW + STATION_STALE_MS / 2);
    expect(stale.map((s) => s.id)).toEqual(['old']);
  });
});

describe('detectForks', () => {
  const commits = Array.from({ length: FORK_MIN_COMMITS }, (_, i) =>
    makeCommit(['src/mcp/tools.ts'], `c${i}`)
  );

  it('proposes a cluster no station claims', () => {
    const forks = detectForks(commits, [], []);
    expect(forks).toHaveLength(1);
    expect(forks[0].pathPrefix).toBe('src/mcp/');
    expect(forks[0].commits).toHaveLength(FORK_MIN_COMMITS);
  });

  it('stays quiet below the noise threshold', () => {
    expect(detectForks(commits.slice(0, FORK_MIN_COMMITS - 1), [], [])).toHaveLength(0);
  });

  it('respects station claims and the dismissal memory', () => {
    const claiming = makeStation({
      predicate: { type: 'git_touches', pathPrefix: 'src/mcp/' },
    });
    expect(detectForks(commits, [claiming], [])).toHaveLength(0);
    expect(detectForks(commits, [], ['src/mcp/'])).toHaveLength(0);
  });
});
