/**
 * The goal review chain, end to end in the native app (mission goal-native, 08 station 1).
 *
 *   stations goal (work station + review gate) -> review 1 (stub verdict, decision rework)
 *   -> goal not achievable -> rework lands the work station -> review 2 (stub, approve)
 *   -> approval file -> the app's evidence engine closes the gate -> the conductor's
 *   completion rule achieves the goal.
 *
 * How each piece reaches the app, and why:
 *
 * - Reviews go through a real MCP process: `node src-tauri/resources/auric-mcp/server.mjs
 *   --project-root <fixture>`, the bundled runtime and arguments `ensure_agent_mcp_config`
 *   hands every agent. The server the app itself starts (`start_mcp`) drains its stdio
 *   into the void, so nothing outside the app can call a tool on it; an agent reaches
 *   `submit_goal_review` exactly this way, over its own stdio transport to the same
 *   `.auric/project.db`. The goal and its stations are created through the same client,
 *   the way the mission-to-goals skill registers them.
 * - The judge is a stub: two fixed verdicts in the reviewer's output schema
 *   (mission-goal-review's review-schema.json). The decision is not the stub's; the IDE
 *   rule (`decideGoalReview`) and `decide.py` make it.
 * - `decide.py` is the real skill script when it is installed (`AURIC_DECIDE_PY`, else
 *   `~/.claude/skills/mission-goal-review/scripts/decide.py` of the OS user; HOME is the
 *   sandbox here). It builds the tool payload and writes the review record and, on approve,
 *   the approval file. On a machine without the skill the spec builds the same payload and
 *   writes the approval file in decide.py's format itself, and says so in the output.
 * - The project is opened through the UI (Recent tile), so the app's own file watcher,
 *   file index and evidence engine are live. Station status is never written by the test:
 *   files land on disk and the app's `file_exists` checks mark the stations done.
 * - `achieved` comes from the conductor (Start button in the Goals panel), whose tick
 *   achieves a goal only when `getGoalCompletion` says it may. The test never sets it.
 *
 * The runner starts every spec twice (write, then read in a fresh app process); the read
 * phase checks that the closed goal and both reviews survive the restart.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { $, browser } from '@wdio/globals';
import Database from 'better-sqlite3';

type TauriApi = {
  core: {
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  };
};

/** The WebdriverIO browser commands this spec uses; the global typing here lacks them. */
type TauriBrowser = {
  refresh(): Promise<void>;
  waitUntil(
    condition: () => Promise<boolean>,
    options: { timeout: number; interval: number; timeoutMsg: string }
  ): Promise<true>;
  tauri: {
    execute<ReturnValue, Arguments extends unknown[]>(
      script: (tauri: TauriApi, ...args: Arguments) => ReturnValue | Promise<ReturnValue>,
      ...args: Arguments
    ): Promise<Awaited<ReturnValue>>;
  };
};

type Station = {
  id: string;
  name: string;
  kind: string;
  status: string;
  evidenceKind: string;
  evidenceNote: string;
};
type Goal = { id: string; status: string; achievedAt: string | null };
type GoalsWire = { goals: Goal[]; stations: Station[] };
type Verdict = {
  verdict: 'approve' | 'rework' | 'escalate';
  summary: string;
  scores: Record<
    'criteria_met' | 'solves_problem' | 'solution_quality' | 'scope_respected',
    number
  >;
  criteria: Array<{ criterion: string; met: string; evidence: string }>;
  findings: Array<{ severity: string; what: string; where: string; why: string; scope: string }>;
  rework_steps: string[];
};
type ReviewRow = { id: string; decision: string; verdict: string; attempt: number };
type DecideOutput = {
  decision: string;
  approved_marker: string | null;
  record: string;
  rules_agree: boolean | null;
};

declare const describe: (name: string, body: () => void) => void;
declare const it: (name: string, body: () => Promise<void>) => void;
declare const after: (body: () => Promise<void> | void) => void;

const tauriBrowser = browser as typeof browser & TauriBrowser;
const phase = process.env.VFY_TAURI_PHASE;
const sandboxProject = process.env.VFY_TAURI_PROJECT_PATH;
const runId = process.env.VFY_TAURI_RUN_ID;

if ((phase !== 'write' && phase !== 'read') || !sandboxProject || !runId) {
  throw new Error('The goal review chain must be launched by the native Tauri E2E runner.');
}

// Canonical on purpose: the MCP server binds the resolved root, and the app keys its
// database connection by the path it opened. /var is a symlink to /private/var on macOS.
const project = join(realpathSync(sandboxProject), 'goal-review-chain');
const jobDir = join(realpathSync(sandboxProject), 'goal-review-jobs');
const MISSION = 'missions/review-chain';
const GOAL_SLUG = '01-summary';
const reviewsDir = join(project, MISSION, 'shared', 'reviews');
const deliverable = 'deliverables/summary.md';
const approvalFile = `${MISSION}/shared/reviews/${GOAL_SLUG}-approved.md`;
const GOAL_NAME = 'Summary delivered and reviewed';
const WORK_STATION = 'Write the summary';
const GATE_STATION = 'Review passed';

const decidePy =
  process.env.AURIC_DECIDE_PY ??
  join(userInfo().homedir, '.claude/skills/mission-goal-review/scripts/decide.py');
const realDecide = existsSync(decidePy);

const REVIEW_1: Verdict = {
  verdict: 'rework',
  summary: 'The line is planned, but the summary it promises does not exist yet.',
  scores: { criteria_met: 2, solves_problem: 2, solution_quality: 3, scope_respected: 5 },
  criteria: [
    {
      criterion: 'deliverables/summary.md exists and states the result',
      met: 'no',
      evidence: `${deliverable} is missing`,
    },
  ],
  findings: [
    {
      severity: 'major',
      what: 'The summary was never written',
      where: deliverable,
      why: 'The goal promises it; without it there is nothing to review',
      scope: 'in_goal',
    },
  ],
  rework_steps: [`Write ${deliverable} with the result`],
};

const REVIEW_2: Verdict = {
  verdict: 'approve',
  summary: 'The summary exists and states the result; the goal does what it promised.',
  scores: { criteria_met: 5, solves_problem: 4, solution_quality: 4, scope_respected: 5 },
  criteria: [
    {
      criterion: 'deliverables/summary.md exists and states the result',
      met: 'yes',
      evidence: `${deliverable} read, result stated in the first line`,
    },
  ],
  findings: [
    {
      severity: 'minor',
      what: 'The summary could link its sources',
      where: deliverable,
      why: 'Easier to check later',
      scope: 'follow_up',
    },
  ],
  rework_steps: [],
};

/** A minimal MCP stdio client: line-delimited JSON-RPC, one pending map. */
class McpStdioClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (message: Record<string, unknown>) => void>();
  private nextId = 1;
  private stderr = '';

  constructor(projectRoot: string) {
    const runtime = resolve(process.cwd(), 'src-tauri/resources/auric-mcp/server.mjs');
    assert.ok(existsSync(runtime), `bundled MCP runtime missing at ${runtime}`);
    this.child = spawn(process.execPath, [runtime, '--project-root', projectRoot], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, AURIC_NOTIFICATIONS_DB: join(jobDir, 'notifications.db') },
    });
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString();
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return; // not protocol traffic; diagnostics are read from stderr on timeout
      }
      if (typeof message.id === 'number') this.pending.get(message.id)?.(message);
    });
  }

  private send(method: string, params: Record<string, unknown>) {
    const id = this.nextId++;
    return new Promise<Record<string, unknown>>((done, fail) => {
      const timer = setTimeout(
        () => fail(new Error(`MCP ${method} timed out. stderr: ${this.stderr}`)),
        15_000
      );
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        this.pending.delete(id);
        done(message);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async initialize(): Promise<void> {
    const reply = await this.send('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'goal-review-chain-e2e', version: '1' },
    });
    const info = (reply.result as { serverInfo?: { name?: string } } | undefined)?.serverInfo;
    assert.equal(info?.name, 'auric-pm', `unexpected MCP server: ${JSON.stringify(reply)}`);
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`
    );
  }

  /** Calls a tool and returns its parsed JSON text; a tool error throws with its message. */
  async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const reply = await this.send('tools/call', { name, arguments: args });
    const result = reply.result as
      { isError?: boolean; content?: Array<{ type: string; text?: string }> } | undefined;
    const text = result?.content?.find((part) => part.type === 'text')?.text;
    if (!result || result.isError || text === undefined) {
      throw new Error(`MCP ${name} failed: ${JSON.stringify(reply)}`);
    }
    return JSON.parse(text) as T;
  }

  close(): void {
    this.child.kill('SIGTERM');
  }
}

async function loadGoals(): Promise<GoalsWire> {
  return (await tauriBrowser.tauri.execute(
    async (tauri, path) => await tauri.core.invoke('goals_load', { projectPath: path }),
    project
  )) as GoalsWire;
}

async function stationNamed(name: string): Promise<Station> {
  const station = (await loadGoals()).stations.find((s) => s.name === name);
  assert.ok(station, `station "${name}" not in the app's database`);
  return station;
}

/** Waits until the app has marked a station done by its own evidence check. */
async function waitForStationDone(name: string): Promise<Station> {
  let last: Station | undefined;
  await tauriBrowser.waitUntil(
    async () => {
      last = await stationNamed(name);
      return last.status === 'done';
    },
    {
      timeout: 20_000,
      interval: 500,
      timeoutMsg: `station "${name}" never went done by the app's evidence check`,
    }
  );
  return last!;
}

function readReviews(goalId: string): ReviewRow[] {
  const db = new Database(join(project, '.auric', 'project.db'), { readonly: true });
  try {
    return db
      .prepare(
        'SELECT id, decision, verdict, attempt FROM pm_goal_reviews WHERE goal_id = ? ORDER BY attempt'
      )
      .all(goalId) as ReviewRow[];
  } finally {
    db.close();
  }
}

function runDecide(args: string[]): string {
  const result = spawnSync('python3', [decidePy, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `decide.py ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** The tool arguments for one review: decide.py's own builder, or its mapping when absent. */
function reviewPayload(verdict: Verdict, attempt: number, goalId: string) {
  const resultFile = join(jobDir, `review-r${attempt}.result.md`);
  writeFileSync(resultFile, JSON.stringify(verdict, null, 2));
  if (realDecide) {
    return JSON.parse(
      runDecide([
        ...['--result', resultFile, '--reviews-dir', reviewsDir, '--goal', GOAL_SLUG],
        ...['--attempt', String(attempt), '--ide-payload', goalId, '--reviewer', 'judge-stub'],
      ])
    ) as Record<string, unknown>;
  }
  return {
    goalId,
    verdict: verdict.verdict,
    scores: verdict.scores,
    reason: verdict.summary,
    criteria: verdict.criteria,
    findings: verdict.findings,
    reworkSteps: verdict.rework_steps,
    reviewer: 'judge-stub',
  };
}

/** Writes the record (and on approve the approval file) with the IDE's decision. */
function recordDecision(attempt: number, row: ReviewRow): DecideOutput {
  const resultFile = join(jobDir, `review-r${attempt}.result.md`);
  if (realDecide) {
    return JSON.parse(
      runDecide([
        ...['--result', resultFile, '--reviews-dir', reviewsDir, '--goal', GOAL_SLUG],
        ...['--attempt', String(attempt), '--max-attempts', '3'],
        ...['--ide-decision', row.decision, '--ide-review-id', row.id],
        ...['--ide-attempt', String(row.attempt)],
      ])
    ) as DecideOutput;
  }
  const record = join(reviewsDir, `${GOAL_SLUG}-r${attempt}.md`);
  writeFileSync(record, `# Review r${attempt}\n\nDecision: ${row.decision}\n`);
  let marker: string | null = null;
  if (row.decision === 'approve') {
    marker = join(project, approvalFile);
    writeFileSync(
      marker,
      `---\nkind: review-approval\ngoal: ${GOAL_SLUG}\nreview: ${GOAL_SLUG}-r${attempt}.md\n---\n`
    );
  }
  return { decision: row.decision, approved_marker: marker, record, rules_agree: null };
}

async function click(testId: string): Promise<void> {
  const element = await $(`[data-testid="${testId}"]`);
  await element.waitForClickable({ timeout: 15_000 });
  await element.click();
}

describe(`goal review chain (${phase})`, () => {
  if (phase === 'write') {
    const state: { mcp?: McpStdioClient; goalId?: string } = {};

    after(() => state.mcp?.close());

    it('registers a stations goal over MCP and opens the project through the UI', async () => {
      process.stdout.write(
        realDecide
          ? `decide.py: the real skill script at ${decidePy}\n`
          : `decide.py: not installed at ${decidePy}; payload and approval file are built by the spec\n`
      );
      mkdirSync(reviewsDir, { recursive: true });
      mkdirSync(jobDir, { recursive: true });
      writeFileSync(
        join(project, MISSION, '00-mission.md'),
        '---\ntype: mission\nlanguage: en\n---\n\n# Review chain fixture\n'
      );
      await tauriBrowser.tauri.execute(async (tauri, path) => {
        await tauri.core.invoke('init_project_db', { projectPath: path });
        await tauri.core.invoke('recent_projects_add', { path });
      }, project);

      state.mcp = new McpStdioClient(project);
      await state.mcp.initialize();
      const goal = await state.mcp.call<{ id: string }>('create_goal', {
        name: GOAL_NAME,
        successCriteria: `- [ ] ${deliverable} exists and states the result`,
        status: 'active',
        workMode: 'stations',
      });
      state.goalId = goal.id;
      await state.mcp.call('create_stations', {
        goalId: goal.id,
        stations: [
          {
            name: WORK_STATION,
            predicate: JSON.stringify({ type: 'file_exists', glob: deliverable }),
          },
          {
            name: GATE_STATION,
            kind: 'gate',
            predicate: JSON.stringify({ type: 'file_exists', glob: approvalFile }),
          },
        ],
      });

      // The recent list is read when the start screen mounts.
      await tauriBrowser.refresh();
      await click('project-switcher-tab-recent');
      await click(`recent-tile-${project}`);
      await click('activity-item-work');
      await click('work-tab-goals');
      await click(`goal-node-${goal.id}`);
      await (await $('[data-testid="goal-satisfaction"]')).waitForDisplayed({ timeout: 15_000 });
    });

    it('stores review 1 through submit_goal_review and the rule decides rework', async () => {
      const mcp = state.mcp!;
      const goalId = state.goalId!;
      const row = await mcp.call<ReviewRow>(
        'submit_goal_review',
        reviewPayload(REVIEW_1, 1, goalId)
      );
      assert.equal(row.decision, 'rework');
      assert.equal(row.attempt, 1);

      const outcome = recordDecision(1, row);
      assert.equal(outcome.decision, 'rework');
      assert.equal(outcome.approved_marker, null);
      if (realDecide) assert.equal(outcome.rules_agree, true, 'IDE rule and decide.py disagree');
      assert.ok(existsSync(outcome.record), 'review record not written');
      assert.equal(existsSync(join(project, approvalFile)), false);
    });

    it('leaves the goal not achievable after a rework decision', async () => {
      const evaluation = await state.mcp!.call<{
        completion: { achievable: boolean; blockers: string[] };
      }>('evaluate_goal', { id: state.goalId! });
      assert.equal(evaluation.completion.achievable, false);
      assert.ok(
        evaluation.completion.blockers.some((b) => b.includes(GATE_STATION)),
        `gate station missing from blockers: ${evaluation.completion.blockers.join(' | ')}`
      );

      const gate = await stationNamed(GATE_STATION);
      assert.notEqual(gate.status, 'done');
      const goal = (await loadGoals()).goals.find((g) => g.id === state.goalId);
      assert.notEqual(goal?.status, 'achieved');
      // The app's own reading of the same rule: no "Mark achieved" offered.
      assert.equal(await (await $('[data-testid="goal-achieve-btn"]')).isExisting(), false);
    });

    it('rework: the summary lands on disk and the app marks the work station done', async () => {
      mkdirSync(join(project, 'deliverables'), { recursive: true });
      writeFileSync(join(project, deliverable), '# Summary\n\nResult: the chain holds.\n');
      const work = await waitForStationDone(WORK_STATION);
      assert.equal(work.evidenceKind, 'proof');
      assert.match(work.evidenceNote, /exists/);
      const gate = await stationNamed(GATE_STATION);
      assert.notEqual(gate.status, 'done', 'gate must stay open until a review approves');
    });

    it('stores review 2, the rule approves and the approval file is written', async () => {
      const row = await state.mcp!.call<ReviewRow>(
        'submit_goal_review',
        reviewPayload(REVIEW_2, 2, state.goalId!)
      );
      assert.equal(row.decision, 'approve');
      assert.equal(row.attempt, 2);

      const outcome = recordDecision(2, row);
      assert.equal(outcome.decision, 'approve');
      if (realDecide) assert.equal(outcome.rules_agree, true, 'IDE rule and decide.py disagree');
      assert.equal(outcome.approved_marker, join(project, approvalFile));
      assert.match(readFileSync(join(project, approvalFile), 'utf8'), /kind: review-approval/);
    });

    it("closes the gate by the app's evidence check and achieves the goal via the conductor", async () => {
      const gate = await waitForStationDone(GATE_STATION);
      assert.equal(gate.evidenceKind, 'proof');

      const before = (await loadGoals()).goals.find((g) => g.id === state.goalId);
      assert.notEqual(before?.status, 'achieved', 'nothing may achieve the goal before the run');

      await click('conductor-start-btn');
      let goal: Goal | undefined;
      await tauriBrowser.waitUntil(
        async () => {
          goal = (await loadGoals()).goals.find((g) => g.id === state.goalId);
          return goal?.status === 'achieved';
        },
        {
          timeout: 20_000,
          interval: 500,
          timeoutMsg: 'goal never reached achieved: the conductor tick did not close it',
        }
      );
      assert.ok(goal?.achievedAt, 'achieved without a timestamp');
      assert.deepEqual(
        readReviews(state.goalId!).map((r) => [r.attempt, r.verdict, r.decision]),
        [
          [1, 'rework', 'rework'],
          [2, 'approve', 'approve'],
        ]
      );
    });
  } else {
    it('keeps the achieved goal, both stations and both reviews across a restart', async () => {
      await tauriBrowser.tauri.execute(
        async (tauri, path) => await tauri.core.invoke('init_project_db', { projectPath: path }),
        project
      );
      const { goals, stations } = await loadGoals();
      const goal = goals.find((g) => g.status === 'achieved');
      assert.ok(goal, `no achieved goal after restart: ${JSON.stringify(goals)}`);
      for (const name of [WORK_STATION, GATE_STATION]) {
        const station = stations.find((s) => s.name === name);
        assert.equal(station?.status, 'done', `${name} not done after restart`);
        assert.equal(station?.evidenceKind, 'proof');
      }
      assert.deepEqual(
        readReviews(goal.id).map((r) => r.decision),
        ['rework', 'approve']
      );
    });
  }
});
